import { NextResponse } from "next/server";
import { chatJson } from "@/lib/ai";
import type { Segment, Verdict } from "@/lib/ders";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { cevresindekiBolum } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 120;

// Bu prompt ölçülerek yazıldı. Önceki sürümde model "eksik" kademesini hiç
// kullanmıyor, yarım doğru cevaplara "yanlis" veriyordu. Ayırt etme ölçütünün
// tek soruya indirgenmesi ("yanlış mı söyledi, eksik mi bıraktı") 5 vakalık
// testte isabeti 5/5'e çıkardı.
const SISTEM = `Sen KPSS'ye hazırlanan bir öğrencinin açık uçlu cevabını değerlendiren bir öğretmensin.

Sana dersin ilgili bölümü, soru, beklenen cevap ve kilit kavramlar veriliyor.

Temel kurallar:
- ANLAM doğruysa doğrudur; cevabın kelimesi kelimesine aynı olması gerekmez.
- Yazım ve imla hatalarını asla cezalandırma.

Üç kademe var ve "eksik" kademesini gerçekten kullan:
- "dogru"  : Beklenen cevabın ANA FİKRİNİ veriyor. Örnek vermemiş olması ya da daha kısa
             anlatmış olması doğruluğu bozmaz.
- "eksik"  : Söyledikleri DOĞRU ama yetersiz. Beklenen cevabın istediği parçalardan birini
             atlamış, ya da iki yönlü bir soruda tek yönü cevaplamış.
- "yanlis" : Yanlış bilgi veriyor, kavramları birbirine karıştırıyor, konuyla ilgisiz,
             ya da boş / "bilmiyorum" türünde.

Ayırt etme ölçütü şu tek soru: öğrenci YANLIŞ bir şey mi söyledi, yoksa EKSİK mi bıraktı?
Yanlış bir şey söylemediyse ve ana fikir doğruysa asla "yanlis" verme — "eksik" ya da "dogru" ver.

Geri bildirimi öğrenciye doğrudan hitap ederek yaz (sen dili), 2-3 cümle, dürüst ama cesaret
kırmayan bir tonda. Eksik ya da yanlışsa doğrusunu kısaca söyle.

SADECE geçerli JSON döndür, kod bloğu işareti kullanma:
{"sonuc": "dogru | eksik | yanlis", "geri_bildirim": "...", "eksik_kavramlar": ["..."]}`;

interface Degerlendirme {
  sonuc?: string;
  geri_bildirim?: string;
  eksik_kavramlar?: string[];
}

const GECERLI: Verdict[] = ["dogru", "eksik", "yanlis"];

/**
 * Gövde: { questionId, cevap?: string, secim?: number, pas?: boolean }
 *
 * Çoktan seçmeli sorular ve pas geçmeler yerel değerlendirilir — AI çağrısı
 * yapılmaz, anında ve bedava sonuçlanır.
 */
export async function POST(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    const govde = await request.json();
    const questionId: string = govde?.questionId ?? "";
    const cevap: string = typeof govde?.cevap === "string" ? govde.cevap.trim() : "";
    const secim: number | null = typeof govde?.secim === "number" ? govde.secim : null;
    const pas: boolean = govde?.pas === true;

    if (!questionId) {
      return NextResponse.json({ hata: "questionId gerekli." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    const { data: soru, error: soruHatasi } = await supabase
      .from("ders_questions")
      .select(
        "id, session_id, kind, question, answer_key, key_points, choices, correct_index, explanation, start_seconds"
      )
      .eq("id", questionId)
      .maybeSingle();

    if (soruHatasi) throw new Error(soruHatasi.message);
    if (!soru) return NextResponse.json({ hata: "Soru bulunamadı." }, { status: 404 });

    let verdict: Verdict;
    let feedback: string;
    let missing: string[] = [];

    // Çoktan seçmeli ve pas geçmeler yerel değerlendirilir. Buradaki metin de
    // ablamın okuduğu geri bildirim olduğu için ham cevap anahtarını olduğu gibi
    // basmıyoruz — hitap eden bir cümleyle çerçeveliyoruz.
    const sikMetni = (i: number | null) => {
      const secenekler = Array.isArray(soru.choices) ? (soru.choices as string[]) : [];
      return i !== null && secenekler[i] ? `${"ABCDE"[i]}) ${secenekler[i]}` : null;
    };

    if (pas) {
      verdict = "pas";
      if (soru.kind === "coktan") {
        const dogruSik = sikMetni(soru.correct_index);
        feedback = [
          dogruSik ? `Bu soruyu pas geçtin. Doğru cevap ${dogruSik}.` : "Bu soruyu pas geçtin.",
          soru.explanation,
        ]
          .filter(Boolean)
          .join(" ");
      } else {
        feedback = "Bu soruyu pas geçtin. Beklenen cevabı aşağıda görebilirsin.";
      }
    } else if (soru.kind === "coktan") {
      const dogruMu = secim !== null && secim === soru.correct_index;
      verdict = dogruMu ? "dogru" : "yanlis";
      const dogruSik = sikMetni(soru.correct_index);
      feedback = [
        dogruMu
          ? "Doğru bildin."
          : dogruSik
            ? `Doğru cevap ${dogruSik}.`
            : "Doğru şıkkı işaretlemedin.",
        soru.explanation,
      ]
        .filter(Boolean)
        .join(" ");
    } else if (!cevap) {
      verdict = "yanlis";
      feedback = "Cevap boş bırakıldı.";
    } else {
      // Açık uçlu — transkriptin sadece ilgili bölümü gönderiliyor
      const { data: oturum } = await supabase
        .from("ders_sessions")
        .select("video_id, summary")
        .eq("id", soru.session_id)
        .maybeSingle();

      let bolum = "";
      if (oturum?.video_id) {
        const { data: video } = await supabase
          .from("ders_videos")
          .select("segments")
          .eq("video_id", oturum.video_id)
          .maybeSingle();

        if (video && Array.isArray(video.segments)) {
          bolum = cevresindekiBolum(video.segments as Segment[], soru.start_seconds ?? 0);
        }
      }

      const kilit = Array.isArray(soru.key_points) ? (soru.key_points as string[]) : [];

      const sonuc = await chatJson<Degerlendirme>({
        mesajlar: [
          { role: "system", content: SISTEM },
          {
            role: "user",
            content: [
              // Değerlendiriciye yalnızca ±90 sn'lik dilim gidiyor. İki yönlü bir
              // soruda (5. dakikadaki X ile 30. dakikadaki Y'yi karşılaştır) bu
              // dilim tek yarıyı gösterir; ders özeti diğer yarıyı hatırlatır.
              oturum?.summary ? `Dersin genel özeti:\n${oturum.summary}` : "",
              bolum ? `Dersin ilgili bölümü:\n${bolum}` : "",
              `Soru:\n${soru.question}`,
              `Beklenen cevap:\n${soru.answer_key ?? "-"}`,
              kilit.length ? `Kilit kavramlar: ${kilit.join(", ")}` : "",
              `Öğrencinin cevabı:\n${cevap}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        // Akıl yürüten bir model seçilirse düşünme tokenları da buradan düşer;
        // dar bütçe boş cevaba yol açıyor.
        maxTokens: 8000,
        rol: "degerlendirme", // bu uç en sık çağrılan uç
      });

      const ham = typeof sonuc.sonuc === "string" ? sonuc.sonuc.trim().toLowerCase() : "";
      verdict = (GECERLI as string[]).includes(ham) ? (ham as Verdict) : "eksik";
      feedback =
        typeof sonuc.geri_bildirim === "string" && sonuc.geri_bildirim.trim()
          ? sonuc.geri_bildirim.trim()
          : "Değerlendirme alınamadı.";
      missing = Array.isArray(sonuc.eksik_kavramlar)
        ? sonuc.eksik_kavramlar.filter((k): k is string => typeof k === "string" && !!k.trim())
        : [];
    }

    const { error: kayitHatasi } = await supabase.from("ders_answers").upsert(
      {
        session_id: soru.session_id,
        question_id: soru.id,
        user_answer: soru.kind === "coktan" ? (secim !== null ? String(secim) : null) : cevap,
        verdict,
        feedback,
        missing,
      },
      { onConflict: "question_id" }
    );

    if (kayitHatasi) throw new Error(`Cevap kaydedilemedi: ${kayitHatasi.message}`);

    return NextResponse.json({
      verdict,
      feedback,
      missing,
      answerKey: soru.answer_key,
      explanation: soru.explanation,
      correctIndex: soru.correct_index,
      startSeconds: soru.start_seconds,
    });
  } catch (err) {
    return hataCevabi(err);
  }
}
