// Türkçe paragraf soruları: model paragrafı kendisi yazıyor, ikinci bir model
// soruyu anahtarı görmeden çözüyor. Yönergeler ve gerekçe lib/prompts.ts'te
// (paragrafPrompt, PARAGRAF_COZUCU). İki çağıran var:
//   /api/ders/paragraf          Türkçe kartındaki "Paragraf" düğmesi (yeni ders)
//   /api/ders/generate "paragraf" paragraf anlatılan Türkçe dersinin ek adımı
import { chatJsonOlculu } from "@/lib/ai";
import {
  DENETIM_KAYIT_SINIRI,
  gerekceKirp,
  hamKirp,
  hukumOneksizAciklama,
  metaReferansVarMi,
  numaraSiklariMi,
  onculMetniVarMi,
  onculluSiklarMi,
  PARAGRAF_VIDEO,
  sikSetiniDogrula,
  soruKirp,
  type DenetimAdimi,
  type DenetimGecisi,
  type DenetimKaydi,
} from "@/lib/ders";
import { PARAGRAF_COZUCU, paragrafPrompt, SIK_SAYISI } from "@/lib/prompts";
import type { createServerSupabaseClient } from "@/lib/supabase-server";

type Supa = ReturnType<typeof createServerSupabaseClient>;

const HARF = ["A", "B", "C", "D", "E"];

/** ders_questions'a eklenmeye hazır satır (session_id, video_id, position çağıranda) */
export interface ParagrafSorusu {
  kind: "coktan";
  question: string;
  answer_key: null;
  key_points: string[];
  choices: string[];
  correct_index: number;
  explanation: string | null;
  topic: string | null;
  start_seconds: number;
}

interface UretilenParagraf {
  tur?: unknown;
  paragraf?: unknown;
  soru?: unknown;
  secenekler?: unknown;
  dogru?: unknown;
  aciklama?: unknown;
}

const metin = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Çıkmış soru dosyasından (KPSS kategorisi, Türkçe) rastgele paragraf soruları.
 * Dil bilgisi soruları (ses olayı, yazım, öge…) örnek olmuyor: model onları
 * paragraf sorusu sanıp taklit ediyordu.
 */
async function ornekleriGetir(supabase: Supa, adet = 5): Promise<string> {
  const { data } = await supabase
    .from("ders_questions")
    .select("question, choices, correct_index")
    .like("video_id", "metin-cikmis-%-turkce")
    .eq("kind", "coktan")
    .limit(400);
  const uygun = (data ?? []).filter((q) => {
    const s = (q.question as string) ?? "";
    const soruCumlesi = s.split("\n").pop() ?? "";
    return (
      s.length > 220 &&
      /parça|paragraf|cümle/i.test(soruCumlesi) &&
      !/ses olay|yazım|noktalama|sözcük tür|ögeler|ögesi|eki|fiilimsi|tamlama|anlatım bozukluğu/i.test(soruCumlesi) &&
      Array.isArray(q.choices)
    );
  });
  for (let i = uygun.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [uygun[i], uygun[j]] = [uygun[j], uygun[i]];
  }
  return uygun
    .slice(0, adet)
    .map((q, i) =>
      [
        `Örnek ${i + 1}:`,
        q.question as string,
        ...(q.choices as string[]).map((c, j) => `${HARF[j]}) ${c}`),
        `Doğru cevap: ${HARF[q.correct_index as number] ?? "?"}`,
      ].join("\n")
    )
    .join("\n\n");
}

/** Elenen sorunun tam hâli: "bu eleme doğru muydu?" kırpılmış kökle anlaşılmıyor */
const tamMetin = (s: ParagrafSorusu) =>
  [s.question, ...s.choices.map((c, i) => `${HARF[i]}) ${c}${i === s.correct_index ? "  ← işaretli" : ""}`)].join("\n");

/**
 * `adet` paragraf sorusu üretir. Biraz fazlası isteniyor: çözücünün attıkları
 * sayıyı düşürmesin. Dönen `adim` oturumun denetim özetine yazılır (aiview +
 * maliyet sayfası oradan okuyor).
 */
export async function paragrafSorulariUret(
  supabase: Supa,
  { adet, odak = [] }: { adet: number; odak?: string[] }
): Promise<{ sorular: ParagrafSorusu[]; adim: DenetimAdimi; elenen: number }> {
  const ornekler = await ornekleriGetir(supabase);
  const istenen = adet + 2;

  const { veri, olcum, ham } = await chatJsonOlculu<{ sorular?: UretilenParagraf[] }>({
    mesajlar: [
      { role: "system", content: paragrafPrompt(istenen, odak, ornekler) },
      { role: "user", content: `${istenen} paragraf sorusu yaz; yalnızca JSON döndür.` },
    ],
    maxTokens: 32000,
  });

  // --- Biçim
  const gelen = Array.isArray(veri.sorular) ? veri.sorular : [];
  const bicimElenen: Record<string, number> = {};
  const dus = (sebep: string) => {
    bicimElenen[sebep] = (bicimElenen[sebep] ?? 0) + 1;
  };
  const adaylar: ParagrafSorusu[] = [];
  for (const u of gelen) {
    const paragraf = metin(u.paragraf);
    const soru = metin(u.soru);
    if (!paragraf || !soru) {
      dus("paragraf ya da soru boş");
      continue;
    }
    const k = sikSetiniDogrula(u.secenekler, u.dogru, SIK_SAYISI);
    if (!k) {
      dus("şık sayısı ya da doğru indeks geçersiz");
      continue;
    }
    // Şıklar numara ("I.", "II ile IV") ama paragrafta numara yoksa soru çözülemez
    if (numaraSiklariMi(k.secenekler) && !/\((I|II|III|IV|V)\)/.test(paragraf)) {
      dus("numaralı şık var, paragrafta numara yok");
      continue;
    }
    if (onculluSiklarMi(k.secenekler) && !onculMetniVarMi(`${paragraf}\n${soru}`)) {
      dus("öncül şıkları var ama öncül yok");
      continue;
    }
    if (metaReferansVarMi(`${paragraf} ${soru}`)) {
      dus("hoca/video göndermesi");
      continue;
    }
    const tur = metin(u.tur);
    adaylar.push({
      kind: "coktan",
      question: `${paragraf}\n${soru}`,
      answer_key: null,
      key_points: [],
      choices: k.secenekler,
      correct_index: k.dogruIndeks,
      explanation: metin(u.aciklama) ? hukumOneksizAciklama(metin(u.aciklama)) : null,
      topic: tur ? `Paragraf: ${tur}` : "Paragraf",
      start_seconds: 0,
    });
  }

  // --- Çözücü: anahtarı görmeden çöz, anahtarla karşılaştır
  const kayitlar: DenetimKaydi[] = [];
  const kaydet = (s: ParagrafSorusu, sebep: string, gerekce?: string) => {
    if (kayitlar.length >= DENETIM_KAYIT_SINIRI) return;
    kayitlar.push({ katman: "cozucu", soru: soruKirp(s.question), islem: "elendi", sebep, gerekce: gerekceKirp(gerekce), tamMetin: tamMetin(s) });
  };
  let gecis: DenetimGecisi = { katman: "cozucu", bulgu: 0, valf: false, sn: 0, girdiToken: 0, ciktiToken: 0 };
  let kalan = adaylar;
  if (adaylar.length) {
    const liste = adaylar
      .map((s, i) => [`${i + 1}. SORU:`, s.question, ...s.choices.map((c, j) => `${HARF[j]}) ${c}`)].join("\n"))
      .join("\n\n");
    try {
      const cozum = await chatJsonOlculu<{ cevaplar?: { no?: unknown; cevap?: unknown; sorun?: unknown; gerekce?: unknown }[] }>({
        mesajlar: [
          { role: "system", content: PARAGRAF_COZUCU },
          { role: "user", content: liste },
        ],
        maxTokens: 16000,
        rol: "denetim",
      });
      const cevaplar = new Map<number, { cevap: string; sorun: string; gerekce: string }>();
      for (const c of Array.isArray(cozum.veri.cevaplar) ? cozum.veri.cevaplar : []) {
        if (typeof c?.no === "number") {
          cevaplar.set(c.no - 1, { cevap: metin(c.cevap).toUpperCase(), sorun: metin(c.sorun), gerekce: metin(c.gerekce) });
        }
      }
      kalan = adaylar.filter((s, i) => {
        const c = cevaplar.get(i);
        if (!c) {
          kaydet(s, "çözücü cevaplamadı");
          return false;
        }
        if (c.sorun && c.sorun !== "null") {
          kaydet(s, `çözücü: ${c.sorun.replace("_", " ")}`, c.gerekce);
          return false;
        }
        if (HARF.indexOf(c.cevap) !== s.correct_index) {
          kaydet(s, `çözücü ${c.cevap || "?"} dedi, anahtar ${HARF[s.correct_index]}`, c.gerekce);
          return false;
        }
        return true;
      });
      gecis = { katman: "cozucu", bulgu: adaylar.length - kalan.length, valf: false, ...cozum.olcum };
    } catch (e) {
      // Çözücü düşerse sorular denetimsiz kalır; yine de verilir ama kayda geçer
      console.warn("[paragraf] çözücü düştü:", (e as Error).message);
      gecis = { ...gecis, hata: (e as Error).message.slice(0, 200) };
    }
  }

  const sorular = kalan.slice(0, adet);
  const elenen = adaylar.length - kalan.length;
  const ters = elenen > 0 || Object.keys(bicimElenen).length > 0;
  for (const [sebep, sayi] of Object.entries(bicimElenen)) {
    if (kayitlar.length < DENETIM_KAYIT_SINIRI) {
      kayitlar.push({ katman: "bicim", soru: `${sayi} soru`, islem: "bicim-elendi", sebep });
    }
  }
  const adim: DenetimAdimi = {
    adim: "paragraf",
    uretilen: gelen.length,
    bicimElenen,
    hedef: adet,
    nihai: sorular.length,
    uretimSn: olcum.sn,
    uretimGirdiToken: olcum.girdiToken,
    uretimCiktiToken: olcum.ciktiToken,
    uretimModeli: olcum.model,
    uretimOnbellekToken: olcum.onbellekToken,
    uretimMaliyetUsd: olcum.maliyetUsd,
    hamUretim: ters || !gelen.length ? hamKirp(ham) : undefined,
    gecisler: [gecis],
    kayitlar,
  };
  return { sorular, adim, elenen };
}

/** Paragraf sorularının bağlandığı ortak sahte video satırı (yoksa açılır) */
export async function paragrafVideosunuHazirla(supabase: Supa, videoId: string = PARAGRAF_VIDEO) {
  const { error } = await supabase.from("ders_videos").upsert(
    { video_id: videoId, url: "", title: null, duration_seconds: 0, lang: "tr", source: "metin", segments: [] },
    { onConflict: "video_id", ignoreDuplicates: true }
  );
  if (error) throw new Error(`Paragraf kaydı açılamadı: ${error.message}`);
}
