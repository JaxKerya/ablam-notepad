import { NextResponse } from "next/server";
import { chatJson } from "@/lib/ai";
import {
  EN_AZ_SORU,
  hedefSoruSayisi,
  hukumOneksizAciklama,
  siklariKaristir,
  sikOnekiniAt,
  type Segment,
} from "@/lib/ders";
import { gunlukLimitAsildiMi, hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { damgaBelirle, kelimeDizini, transkriptMetni } from "@/lib/youtube";
import {
  acikPrompt,
  coktanPrompt,
  SIK_SAYISI,
  SORU_OLGU_DENETIMI,
  SORU_TRANSKRIPT_DENETIMI,
} from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 300;

// Üretim iki isteğe bölünmüş durumda. Sebebi ölçüm: soru sayısı derse göre
// arttığı için tek çağrı 46 dakikalık bir derste 149 saniye sürüyordu, 78
// dakikalıkta 250 saniyeye çıkıyor. İki ayrı HTTP isteği demek, her birinin
// kendi süre bütçesi demek — hem sunucu tavanına takılma riski yarıya iniyor
// hem de ablam ilk adım biter bitmez ders özetini görebiliyor.
//
//   adim "acik"   -> oturumu açar, özet + konular + açık uçlu sorular
//   adim "coktan" -> çoktan seçmelileri ekler, oturumu "hazir" yapar

/**
 * Denetim bulgularının UYGULANMASI. Denetim yönergelerinin kendisi ve iki
 * katmanın neden ayrı olduğu lib/prompts.ts'te (SORU_TRANSKRIPT_DENETIMI,
 * SORU_OLGU_DENETIMI); burada yalnızca bulguyla ne yapıldığı var.
 *
 * ELEME SON ÇARE. Bir soruyu atmak ablamı bir soru eksik bırakır; oysa çoğu
 * durumda bozuk olan soru değil, içindeki tek bir değer. O yüzden varsayılan
 * davranış DÜZELTMEK. Eleme yalnızca iki durumda:
 *   - Ders o konuyu hiç anlatmamış (tur: "yok"). Cevabı düzeltmek adaletsiz
 *     soruyu adil yapmaz, ablamın izlemediği konudan sorulmuş olur.
 *   - Çoktan seçmelide düzeltilmiş şık başka bir şıkla çakışıyor; soru artık
 *     iki doğru cevaplı olur, kurtarılamaz.
 */

type Nerede = "anahtar" | "sik" | "aciklama";

interface DenetimBulgusu {
  tur: "yok" | "celiski";
  nerede: Nerede;
  gerekce: string;
  duzeltilmis: string;
}

interface DenetimYaniti {
  sorunlular?: Record<string, unknown>[];
  hatalar?: Record<string, unknown>[];
}

/** Denetime gönderilen soru: parçaları ayrı ayrı etiketli */
interface DenetimGirdisi {
  question: string;
  anahtar?: string;
  sik?: string;
  aciklama?: string;
}

async function denetimCalistir(
  sistem: string,
  girdiler: DenetimGirdisi[],
  transkript?: string
): Promise<Map<number, DenetimBulgusu>> {
  if (!girdiler.length) return new Map();

  const liste = girdiler
    .map((g, i) => {
      const parcalar = [`${i + 1}. SORU: ${g.question}`];
      if (g.anahtar) parcalar.push(`   anahtar: ${g.anahtar}`);
      if (g.sik) parcalar.push(`   sik: ${g.sik}`);
      if (g.aciklama) parcalar.push(`   aciklama: ${g.aciklama}`);
      return parcalar.join("\n");
    })
    .join("\n\n");

  let yanit: DenetimYaniti;
  try {
    yanit = await chatJson<DenetimYaniti>({
      mesajlar: [
        { role: "system", content: sistem },
        {
          role: "user",
          content: transkript
            ? `${transkript}\n\n--- DENETLENECEK SORULAR ---\n\n${liste}`
            : liste,
        },
      ],
      maxTokens: 8000,
      rol: "denetim",
    });
  } catch {
    // Denetim bir güvenlik ağı; kendisi düşerse üretimi engellemesin.
    return new Map();
  }

  const gecerliNerede = (v: unknown): Nerede =>
    v === "sik" || v === "aciklama" ? v : "anahtar";

  const bulgular = new Map<number, DenetimBulgusu>();
  for (const h of yanit.sorunlular ?? yanit.hatalar ?? []) {
    const no = h?.no;
    if (typeof no !== "number" || no < 1 || no > girdiler.length) continue;
    bulgular.set(no - 1, {
      tur: h?.tur === "yok" ? "yok" : "celiski",
      nerede: gecerliNerede(h?.nerede),
      gerekce: metin(h?.gerekce) || "gerekçe belirtilmedi",
      duzeltilmis: metin(h?.duzeltilmis),
    });
  }

  // Soruların yarısından fazlası işaretlendiyse hatalı olan büyük ihtimalle
  // denetimin kendisidir; o durumda hiçbirine dokunmuyoruz.
  return bulgular.size > girdiler.length / 2 ? new Map() : bulgular;
}

interface DenetimOzeti {
  duzeltilen: number;
  elenen: number;
  notlar: string[];
}

/** Açık uçlu sorulara denetim uygular: "yok" elenir, geri kalanı düzeltilir. */
function acikUygula<T extends { question: string; answer_key: string | null }>(
  sorular: T[],
  bulgular: Map<number, DenetimBulgusu>,
  ozet: DenetimOzeti
): T[] {
  return sorular.filter((s, i) => {
    const b = bulgular.get(i);
    if (!b) return true;

    if (b.tur === "yok") {
      ozet.elenen++;
      ozet.notlar.push(`elendi (derste yok): ${s.question.slice(0, 60)} — ${b.gerekce}`);
      return false;
    }
    if (!b.duzeltilmis) {
      ozet.elenen++;
      ozet.notlar.push(`elendi (düzeltme gelmedi): ${s.question.slice(0, 60)}`);
      return false;
    }
    s.answer_key = b.duzeltilmis;
    ozet.duzeltilen++;
    ozet.notlar.push(`düzeltildi: ${s.question.slice(0, 60)} — ${b.gerekce}`);
    return true;
  });
}

/**
 * Çoktan seçmeliye denetim uygular. Açıklama düzeltmek her zaman güvenli;
 * doğru şıkkın metnini düzeltmek de güvenli, tek istisna düzeltilmiş metnin
 * başka bir şıkla çakışması — o zaman soru iki doğru cevaplı olur, elenir.
 */
function coktanUygula<
  T extends { question: string; choices: string[] | null; correct_index: number | null; explanation: string | null },
>(sorular: T[], bulgular: Map<number, DenetimBulgusu>, ozet: DenetimOzeti): T[] {
  return sorular.filter((s, i) => {
    const b = bulgular.get(i);
    if (!b) return true;

    if (b.tur === "yok") {
      ozet.elenen++;
      ozet.notlar.push(`elendi (derste yok): ${s.question.slice(0, 60)} — ${b.gerekce}`);
      return false;
    }
    if (!b.duzeltilmis) {
      ozet.elenen++;
      ozet.notlar.push(`elendi (düzeltme gelmedi): ${s.question.slice(0, 60)}`);
      return false;
    }

    if (b.nerede === "sik") {
      const secenekler = s.choices ?? [];
      const dogruIndeks = s.correct_index ?? 0;
      const carpisma = secenekler.some(
        (o, j) => j !== dogruIndeks && o.trim().toLowerCase() === b.duzeltilmis.trim().toLowerCase()
      );
      if (carpisma) {
        ozet.elenen++;
        ozet.notlar.push(`elendi (şık çakışması): ${s.question.slice(0, 60)}`);
        return false;
      }
      s.choices = secenekler.map((o, j) => (j === dogruIndeks ? b.duzeltilmis : o));
    } else {
      s.explanation = b.duzeltilmis;
    }

    ozet.duzeltilen++;
    ozet.notlar.push(`düzeltildi: ${s.question.slice(0, 60)} — ${b.gerekce}`);
    return true;
  });
}

interface UretilenAcik {
  soru?: string;
  anahtar?: string;
  kilit_kavramlar?: string[];
  konu?: string;
  saniye?: number;
}

interface UretilenCoktan {
  soru?: string;
  secenekler?: string[];
  dogru?: number;
  aciklama?: string;
  konu?: string;
  saniye?: number;
}

const metin = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const dizi = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];

// Modelin verdiği "saniye" güvenilmez (bkz. lib/youtube.ts -> damgaBelirle).
// Sorunun kavramlarının transkriptte en yoğun geçtiği anı kendimiz buluyoruz.
type Dizin = Map<string, number[]>;

function acikDogrula(ham: UretilenAcik[], adet: number, sure: number, dizin: Dizin) {
  return (ham ?? [])
    .filter((s) => metin(s.soru) && metin(s.anahtar))
    .slice(0, adet)
    .map((s) => ({
      kind: "acik" as const,
      question: metin(s.soru),
      answer_key: metin(s.anahtar),
      key_points: dizi(s.kilit_kavramlar),
      choices: null,
      correct_index: null,
      explanation: null,
      topic: metin(s.konu) || null,
      start_seconds: damgaBelirle(
        [metin(s.soru), metin(s.anahtar), dizi(s.kilit_kavramlar).join(" ")].join(" "),
        dizin,
        s.saniye,
        sure
      ),
    }));
}

function coktanDogrula(ham: UretilenCoktan[], adet: number, sure: number, dizin: Dizin) {
  const gelen = ham ?? [];
  const gecerli = gelen.filter((s) => {
    const sec = dizi(s.secenekler);
    return (
      metin(s.soru) &&
      // KPSS beş şıklıdır; eksik ya da fazla şıklı soru sınav pratiği sayılmaz.
      // Arayüz de şıkları A-E diye harfliyor, altıncısı harfsiz kalırdı.
      sec.length === SIK_SAYISI &&
      typeof s.dogru === "number" &&
      s.dogru >= 0 &&
      s.dogru < sec.length
    );
  });

  // Şık sayısı şartı yeni; kaç soruyu düşürdüğü görünmezse soru sayısındaki
  // düşüş sebebi bilinmez kalır. Sessiz kayıp bırakmıyoruz.
  if (gecerli.length < gelen.length) {
    console.warn(
      `[ders] ${gelen.length - gecerli.length} çoktan seçmeli elendi ` +
        `(şık sayısı ${SIK_SAYISI} değil ya da doğru şık geçersiz)`
    );
  }

  return gecerli
    .slice(0, adet)
    .map((s) => {
      // Doğru şıkkın konumu modele bırakılmıyor — bkz. siklariKaristir
      const karisik = siklariKaristir(dizi(s.secenekler).map(sikOnekiniAt), s.dogru!);
      return {
        kind: "coktan" as const,
        question: metin(s.soru),
        answer_key: null,
        key_points: [] as string[],
        choices: karisik.secenekler,
        correct_index: karisik.dogruIndeks,
        explanation: metin(s.aciklama) ? hukumOneksizAciklama(metin(s.aciklama)) : null,
        topic: metin(s.konu) || null,
        start_seconds: damgaBelirle(
          [metin(s.soru), karisik.secenekler.join(" "), metin(s.aciklama)].join(" "),
          dizin,
          s.saniye,
          sure
        ),
      };
    });
}

/**
 * Denetim sayılarını oturuma yazar. Bu yalnızca şeffaflık içindir — `denetim`
 * kolonu eklenmemişse ders üretimi bundan etkilenmemeli, o yüzden hata yutuluyor.
 * `ekle` true ise mevcut sayıların üstüne ekler (iki adımın toplamı).
 */
async function denetimOzetiYaz(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  sessionId: string,
  ozet: DenetimOzeti,
  ekle: boolean
) {
  try {
    let taban = { duzeltilen: 0, elenen: 0 };
    if (ekle) {
      const { data } = await supabase
        .from("ders_sessions")
        .select("denetim")
        .eq("id", sessionId)
        .maybeSingle();
      const onceki = (data?.denetim ?? {}) as { duzeltilen?: number; elenen?: number };
      taban = { duzeltilen: onceki.duzeltilen ?? 0, elenen: onceki.elenen ?? 0 };
    }
    await supabase
      .from("ders_sessions")
      .update({
        denetim: {
          duzeltilen: taban.duzeltilen + ozet.duzeltilen,
          elenen: taban.elenen + ozet.elenen,
        },
      })
      .eq("id", sessionId);
  } catch {
    // kolon yoksa sessizce geç
  }
}

async function videoGetir(videoId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ders_videos")
    .select("video_id, title, duration_seconds, segments")
    .eq("video_id", videoId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || !Array.isArray(data.segments) || !data.segments.length) return null;
  return data;
}

/**
 * Gövde: { videoId, adim: "acik" } -> { sessionId, ... }
 *        { videoId, adim: "coktan", sessionId } -> { soruSayisi }
 */
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
    const videoId = typeof govde.videoId === "string" ? govde.videoId : "";
    const adim = typeof govde.adim === "string" ? govde.adim : "acik";
    const sessionId = typeof govde.sessionId === "string" ? govde.sessionId : undefined;

    if (!videoId) {
      return NextResponse.json({ hata: "videoId gerekli." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const video = await videoGetir(videoId);
    if (!video) {
      return NextResponse.json(
        { hata: "Bu videonun transkripti bulunamadı. Baştan başlar mısın?" },
        { status: 404 }
      );
    }

    const segments = video.segments as Segment[];
    const sure = video.duration_seconds ?? 0;
    const hedef = hedefSoruSayisi(sure);
    const dizin = kelimeDizini(segments);
    // Video başlığı modele dönemi ve özel isimleri veriyor. Otomatik altyazıda
    // özel isimler bozuluyor ("ahlak" -> "Aylak" gibi); başlık bunu azaltıyor.
    const transkript =
      (video.title ? `Video başlığı: ${video.title}\n` : "") +
      `Ders süresi: ${Math.round(sure / 60)} dakika\n\n` +
      `Ders transkripti:\n\n${transkriptMetni(segments)}`;

    // ------------------------------------------------------------ 1. adım
    if (adim === "acik") {
      if (await gunlukLimitAsildiMi()) {
        return NextResponse.json(
          { hata: "Bugünlük ders hazırlama sınırına ulaşıldı. Yarın devam edebilirsin." },
          { status: 429 }
        );
      }

      // Yarım kalmış eski denemeleri temizle
      await supabase
        .from("ders_sessions")
        .delete()
        .eq("video_id", videoId)
        .eq("status", "hazirlaniyor");

      const uretilen = await chatJson<{
        baslik?: string;
        ozet?: string;
        konular?: string[];
        acik_uclu?: UretilenAcik[];
      }>({
        mesajlar: [
          { role: "system", content: acikPrompt(hedef.acik) },
          { role: "user", content: transkript },
        ],
        // Akıl yürüten modellerde düşünme tokenları da bu bütçeden düşüyor.
        // Dar bırakılınca model bütçeyi düşünmeye harcayıp boş cevap dönüyordu
        // (glm-5.3 ve kimi-k3 ölçümü). max_tokens yalnızca tavan — kullanılmayan
        // token ücretlendirilmediği için cömert olmak bedava.
        maxTokens: 32000,
      });

      const ozet: DenetimOzeti = { duzeltilen: 0, elenen: 0, notlar: [] };
      const girdi = (s: { question: string; answer_key: string | null }) => ({
        question: s.question,
        anahtar: s.answer_key ?? "",
      });

      // 1. katman: derste var mı? 2. katman: gerçekte doğru mu?
      // İkisi de önce düzeltmeye çalışır, eleme son çare.
      let acik = acikDogrula(uretilen.acik_uclu ?? [], hedef.acik, sure, dizin);
      acik = acikUygula(
        acik,
        await denetimCalistir(SORU_TRANSKRIPT_DENETIMI, acik.map(girdi), transkript),
        ozet
      );
      acik = acikUygula(acik, await denetimCalistir(SORU_OLGU_DENETIMI, acik.map(girdi)), ozet);
      if (ozet.notlar.length) console.warn("[ders] denetim (açık uçlu):", ozet.notlar);

      const { data: oturum, error: oturumHatasi } = await supabase
        .from("ders_sessions")
        .insert({
          video_id: videoId,
          title: metin(uretilen.baslik) || video.title || "Ders",
          summary: metin(uretilen.ozet) || null,
          topics: dizi(uretilen.konular),
          status: "hazirlaniyor",
        })
        .select("id")
        .single();

      if (oturumHatasi || !oturum) {
        throw new Error(`Oturum oluşturulamadı: ${oturumHatasi?.message ?? "bilinmiyor"}`);
      }

      // Denetim özeti şeffaflık için; kolon henüz eklenmemişse ders üretimi
      // bundan etkilenmesin diye ayrı ve hatası yutulan bir güncelleme.
      await denetimOzetiYaz(supabase, oturum.id, ozet, false);

      if (acik.length) {
        const { error } = await supabase
          .from("ders_questions")
          .insert(acik.map((s, i) => ({ ...s, session_id: oturum.id, position: i })));
        if (error) throw new Error(`Sorular kaydedilemedi: ${error.message}`);
      }

      return NextResponse.json({
        sessionId: oturum.id,
        acikSayisi: acik.length,
        coktanHedef: hedef.coktan,
      });
    }

    // ------------------------------------------------------------ 2. adım
    if (adim === "coktan") {
      if (!sessionId) {
        return NextResponse.json({ hata: "sessionId gerekli." }, { status: 400 });
      }

      const { data: oturum } = await supabase
        .from("ders_sessions")
        .select("id, topics, status")
        .eq("id", sessionId)
        .maybeSingle();

      if (!oturum) {
        return NextResponse.json({ hata: "Oturum bulunamadı." }, { status: 404 });
      }

      const { data: mevcut } = await supabase
        .from("ders_questions")
        .select("question, kind, position")
        .eq("session_id", sessionId)
        .order("position");

      const acikSorular = (mevcut ?? []).filter((s) => s.kind === "acik").map((s) => s.question);
      const sonrakiPozisyon = (mevcut ?? []).length;

      const uretilen = await chatJson<{ coktan_secmeli?: UretilenCoktan[] }>({
        mesajlar: [
          {
            role: "system",
            content: coktanPrompt(
              hedef.coktan,
              (oturum.topics as string[]) ?? [],
              acikSorular
            ),
          },
          { role: "user", content: transkript },
        ],
        maxTokens: 32000,
      });

      const ozet: DenetimOzeti = { duzeltilen: 0, elenen: 0, notlar: [] };
      // Şık ve açıklama ayrı ayrı gönderiliyor ki denetim hangisini düzelttiğini
      // söyleyebilsin. Çeldiriciler gönderilmiyor — onların yanlış olması zaten
      // beklenen şey, denetime sokmak yanlış alarm üretir.
      const girdi = (s: {
        question: string;
        choices: string[] | null;
        correct_index: number | null;
        explanation: string | null;
      }) => ({
        question: s.question,
        sik: (s.choices ?? [])[s.correct_index ?? 0] ?? "",
        aciklama: s.explanation ?? "",
      });

      let coktan = coktanDogrula(uretilen.coktan_secmeli ?? [], hedef.coktan, sure, dizin);
      coktan = coktanUygula(
        coktan,
        await denetimCalistir(SORU_TRANSKRIPT_DENETIMI, coktan.map(girdi), transkript),
        ozet
      );
      coktan = coktanUygula(coktan, await denetimCalistir(SORU_OLGU_DENETIMI, coktan.map(girdi)), ozet);
      if (ozet.notlar.length) console.warn("[ders] denetim (çoktan seçmeli):", ozet.notlar);

      if (coktan.length) {
        const { error } = await supabase.from("ders_questions").insert(
          coktan.map((s, i) => ({
            ...s,
            session_id: sessionId,
            position: sonrakiPozisyon + i,
          }))
        );
        if (error) throw new Error(`Sorular kaydedilemedi: ${error.message}`);
      }

      const toplam = sonrakiPozisyon + coktan.length;

      if (toplam < EN_AZ_SORU) {
        await supabase.from("ders_sessions").delete().eq("id", sessionId);
        throw new Error(
          "Bu videodan güvenilir soru üretilemedi. Altyazı çok bozuk olabilir; " +
            "başka bir video deneyebilir misin?"
        );
      }

      await supabase.from("ders_sessions").update({ status: "hazir" }).eq("id", sessionId);
      await denetimOzetiYaz(supabase, sessionId, ozet, true);

      return NextResponse.json({ sessionId, soruSayisi: toplam, coktanSayisi: coktan.length });
    }

    return NextResponse.json({ hata: "Geçersiz adım." }, { status: 400 });
  } catch (err) {
    return hataCevabi(err);
  }
}
