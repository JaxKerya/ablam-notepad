import { NextResponse } from "next/server";
import { chatJsonOlculu } from "@/lib/ai";
import {
  GERI_BILDIRIM_EN_AZ,
  hukumOneksizAciklama,
  sikSetiniDogrula,
  type Segment,
} from "@/lib/ders";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { cevresindekiBolum } from "@/lib/youtube";
import { GERI_BILDIRIM_DENETIMI, SIK_SAYISI, soruDuzeltPrompt } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 120;

// Ablamın soru itirazı.
//
// Eskiden "bu soru saçma" düğmesi yalnızca bir bayrak koyuyordu: soru havuzda
// kalıyor, tekrar tekrar karşısına çıkıyordu ve itirazın hiçbir sonucu olmuyordu.
// Artık itiraz gerekçesiyle birlikte alınıyor ve iki sonuçtan biri oluyor:
//
//   haklı  -> soru DÜZELTİLİYOR, ablam düzeltilmiş hâlini çözüyor
//   haksız -> soru HAVUZDAN ÇIKIYOR, bir daha karşısına çıkmıyor
//
// İkinci durumda soru silinmiyor: flagged=true kalıyor, /ders/aiview'de itirazla
// ve kararla birlikte duruyor. Silmek, prompt'u iyileştirmek için gereken tek
// gerçek örneği yok etmek olurdu.
//
// MALİYET: gerekçe yazılmışsa en fazla iki model çağrısı — karar (ucuz denetim
// modeli) ve düzeltme (üretim modeli). Toplam ~$0,02. Gerekçe yazılmamışsa
// hiç çağrı yapılmıyor, soru doğrudan çıkarılıyor.

interface DenetimYaniti {
  hakli?: unknown;
  gerekce?: unknown;
  sorun?: unknown;
}

interface DuzeltmeYaniti {
  soru?: unknown;
  secenekler?: unknown;
  dogru?: unknown;
  aciklama?: unknown;
  anahtar?: unknown;
  kilit_kavramlar?: unknown;
}

const metin = (d: unknown): string => (typeof d === "string" ? d.trim() : "");
const dizi = (d: unknown): string[] =>
  Array.isArray(d) ? d.map((x) => metin(x)).filter(Boolean) : [];

/** Sorunun ve düzeltilmiş hâlinin ortak alanları */
interface SoruIcerigi {
  question: string;
  answer_key: string | null;
  key_points: string[];
  choices: string[] | null;
  correct_index: number | null;
  explanation: string | null;
}

/** Gövde: { questionId, metin } */
export async function POST(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    let govde: Record<string, unknown>;
    try {
      govde = await request.json();
    } catch {
      return NextResponse.json({ hata: "Geçersiz istek gövdesi." }, { status: 400 });
    }
    const questionId = typeof govde.questionId === "string" ? govde.questionId : "";
    const gerekcem = typeof govde.metin === "string" ? govde.metin.trim().slice(0, 1000) : "";

    if (!questionId) {
      return NextResponse.json({ hata: "questionId gerekli." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    const { data: soru, error: soruHatasi } = await supabase
      .from("ders_questions")
      .select(
        "id, session_id, video_id, kaynak_soru_id, kind, question, answer_key, key_points, choices, correct_index, explanation, topic, start_seconds"
      )
      .eq("id", questionId)
      .maybeSingle();

    if (soruHatasi) throw new Error(soruHatasi.message);
    if (!soru) return NextResponse.json({ hata: "Soru bulunamadı." }, { status: 404 });

    // Tekrar kopyasına itiraz edilmişse asıl hedef KAYNAK sorudur: pratik
    // havuzu ders sorularından besleniyor, kopyayı düzeltmek kaynağı bırakırsa
    // aynı bozuk soru bir sonraki pratikte yeni bir kopya olarak geri gelir.
    const hedefIdler = [soru.id, soru.kaynak_soru_id].filter(Boolean) as string[];

    /** İtiraz kaydı — kolonlar yoksa özellik yine çalışsın diye hatası yutuluyor */
    const kaydet = async (karar: string, gerekce: string) => {
      const { error } = await supabase
        .from("ders_questions")
        .update({
          geri_bildirim: gerekcem || null,
          geri_bildirim_karari: karar,
          geri_bildirim_gerekce: gerekce || null,
        })
        .in("id", hedefIdler);
      if (error) console.warn("[ders] itiraz kaydı yazılamadı:", error.message);
    };

    /** Soruyu havuzdan çıkarır ve varsa cevabını siler */
    const havuzdanCikar = async (karar: string, gerekce: string) => {
      const { error } = await supabase
        .from("ders_questions")
        .update({ flagged: true })
        .in("id", hedefIdler);
      if (error) throw new Error(`Soru işaretlenemedi: ${error.message}`);
      await kaydet(karar, gerekce);
      // Çıkarılan sorunun cevabı puanı ve "kaç doğru" sayacını kirletirdi:
      // ablam o soruyu artık görmüyor ama yanlışı istatistikte duruyordu.
      await supabase.from("ders_answers").delete().in("question_id", hedefIdler);
    };

    // --- Gerekçe yoksa: model çağrısı yok, soru doğrudan çıkıyor -------------
    if (gerekcem.length < GERI_BILDIRIM_EN_AZ) {
      await havuzdanCikar(
        "gerekcesiz",
        "Bu soru bir daha karşına çıkmayacak. Nesi bozuk olduğunu yazarsan düzeltmeyi deneyebilirim."
      );
      return NextResponse.json({
        karar: "gerekcesiz",
        gerekce:
          "Bu soru bir daha karşına çıkmayacak. Nesi bozuk olduğunu yazarsan düzeltmeyi deneyebilirim.",
        yenilendi: false,
      });
    }

    // --- Dersin ilgili bölümü ------------------------------------------------
    const { data: video } = await supabase
      .from("ders_videos")
      .select("segments")
      .eq("video_id", soru.video_id ?? "")
      .maybeSingle();
    const segments = (Array.isArray(video?.segments) ? video?.segments : []) as Segment[];
    const bolum = segments.length ? cevresindekiBolum(segments, soru.start_seconds ?? 0) : "";

    const secenekler = Array.isArray(soru.choices) ? (soru.choices as string[]) : [];
    const soruMetni = [
      `SORU: ${soru.question}`,
      soru.kind === "coktan"
        ? [
            "TÜR: çoktan seçmeli",
            ...secenekler.map((s, i) => `  ${"ABCDE"[i] ?? i + 1}) ${s}`),
            `İŞARETLİ DOĞRU CEVAP: ${"ABCDE"[soru.correct_index ?? -1] ?? "?"}`,
            soru.explanation ? `AÇIKLAMA: ${soru.explanation}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : ["TÜR: açık uçlu", soru.answer_key ? `BEKLENEN CEVAP: ${soru.answer_key}` : ""]
            .filter(Boolean)
            .join("\n"),
      soru.topic ? `KONU: ${soru.topic}` : "",
      "",
      `ÖĞRENCİNİN İTİRAZI: ${gerekcem}`,
      "",
      bolum ? `DERSİN İLGİLİ BÖLÜMÜ:\n${bolum}` : "DERSİN İLGİLİ BÖLÜMÜ: (transkript bulunamadı)",
    ]
      .filter(Boolean)
      .join("\n");

    // --- 1. çağrı: haklı mı? -------------------------------------------------
    let karar: DenetimYaniti;
    try {
      const cevap = await chatJsonOlculu<DenetimYaniti>({
        mesajlar: [
          { role: "system", content: GERI_BILDIRIM_DENETIMI },
          { role: "user", content: soruMetni },
        ],
        maxTokens: 4000,
        rol: "denetim",
      });
      karar = cevap.veri;
    } catch (err) {
      // Denetim düşerse soru havuzda KALIYOR: itirazı değerlendiremeden soruyu
      // çıkarmak, sağlam bir soruyu sessizce kaybetmek olurdu. Ablam tekrar
      // deneyebilir.
      console.warn("[ders] itiraz denetimi düştü:", (err as Error).message);
      return NextResponse.json(
        { hata: "Değerlendirme şu an yapılamadı, birazdan tekrar dener misin?" },
        { status: 503 }
      );
    }

    const hakli = karar.hakli === true;
    const gerekce = metin(karar.gerekce);

    if (!hakli) {
      const mesaj =
        gerekce ||
        "Denetim bu soruda bir hata bulamadı. Yine de bir daha karşına çıkmayacak.";
      await havuzdanCikar("haksiz", mesaj);
      return NextResponse.json({ karar: "haksiz", gerekce: mesaj, yenilendi: false });
    }

    // --- 2. çağrı: soruyu düzelt --------------------------------------------
    const tur = soru.kind === "coktan" ? "coktan" : "acik";
    let duzeltme: DuzeltmeYaniti | null = null;
    try {
      const cevap = await chatJsonOlculu<DuzeltmeYaniti>({
        mesajlar: [
          { role: "system", content: soruDuzeltPrompt(tur, SIK_SAYISI) },
          {
            role: "user",
            content: `${soruMetni}\n\nDENETİMİN BULDUĞU SORUN: ${metin(karar.sorun) || gerekcem}`,
          },
        ],
        maxTokens: 8000,
      });
      duzeltme = cevap.veri;
    } catch (err) {
      console.warn("[ders] soru düzeltme düştü:", (err as Error).message);
    }

    const yeni = duzeltme ? icerikCikar(duzeltme, tur) : null;

    if (!yeni) {
      // Haklıydı ama düzeltilemedi. Bozuk olduğu belli olan soruyu havuzda
      // bırakmak, itirazı yok saymak olurdu.
      const mesaj = `${gerekce} Soruyu düzeltemedim, bu yüzden havuzdan çıkardım.`;
      await havuzdanCikar("yazilamadi", mesaj);
      return NextResponse.json({ karar: "yazilamadi", gerekce: mesaj, yenilendi: false });
    }

    // Düzeltilmiş soru hem kopyaya hem kaynağa yazılıyor; işaret kalkıyor.
    const { error: yazmaHatasi } = await supabase
      .from("ders_questions")
      .update({ ...yeni, flagged: false })
      .in("id", hedefIdler);
    if (yazmaHatasi) throw new Error(`Soru güncellenemedi: ${yazmaHatasi.message}`);

    await kaydet("hakli", gerekce);
    // Eski cevap eski soruya aitti; kalsaydı ablam düzeltilmiş soruyu
    // cevaplayamaz, kilitli ve yanlış bir sonuç görürdü.
    await supabase.from("ders_answers").delete().in("question_id", hedefIdler);

    return NextResponse.json({
      karar: "hakli",
      gerekce: gerekce || "Haklıymışsın, soruyu düzelttim.",
      yenilendi: true,
      soru: { id: soru.id, ...yeni, flagged: false },
    });
  } catch (err) {
    return hataCevabi(err);
  }
}

/** Model çıktısını doğrular; geçersizse null döner (o zaman soru çıkarılır) */
function icerikCikar(d: DuzeltmeYaniti, tur: "acik" | "coktan"): SoruIcerigi | null {
  const soru = metin(d.soru);
  if (!soru) return null;

  if (tur === "coktan") {
    // Şık kuralı üretimle AYNI kapıdan geçiyor: tam 5 şık, tekrar yok,
    // doğru indeks geçerli (lib/ders.ts sikSetiniDogrula).
    const k = sikSetiniDogrula(d.secenekler, d.dogru, SIK_SAYISI);
    if (!k) return null;
    const aciklama = metin(d.aciklama);
    return {
      question: soru,
      answer_key: null,
      key_points: [],
      choices: k.secenekler,
      correct_index: k.dogruIndeks,
      explanation: aciklama ? hukumOneksizAciklama(aciklama) : null,
    };
  }

  const anahtar = metin(d.anahtar);
  if (!anahtar) return null;
  return {
    question: soru,
    answer_key: anahtar,
    key_points: dizi(d.kilit_kavramlar),
    choices: null,
    correct_index: null,
    explanation: null,
  };
}
