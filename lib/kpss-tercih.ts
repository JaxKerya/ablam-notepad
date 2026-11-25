// KPSS preference guide helper: shared types and the eligibility rule.
//
// ÖSYM publishes each placement round as a set of PDFs: Tablo-2 (posts open to
// associate-degree graduates, each with up to nine qualification codes), a
// dictionary of education codes (3xxx, each listing the program codes it
// accepts), a dictionary of special-condition codes (1xxx, 6xxx, 7xxx), the list
// of program codes, and the guide text. The worker parses them into
// `TercihVerisi`; the page combines that with what the user told it
// (`TercihDurumu`) through `kadroSonucu` below. No model is involved anywhere:
// a wrong "you can apply" costs the user the placement, so every answer has to
// be traceable to the official text.
//
// Rules, all from the guide itself (KPSS-2026/1, sections 3.3 and "Diğer
// Hususlar" 3.2-3.3): when a post lists several education codes, meeting ONE is
// enough; every other code on the row must be met.
//
// Placement scores (`taban`, `emsal`, the user's `puan`) are information shown
// next to a post. They never enter `kadroSonucu`: a score cannot open or close
// a post, and last round's minimum is not a promise about this round's.

/** A post's own placement result, from the "en küçük ve en büyük puanlar" list ÖSYM publishes after the round closes */
export interface KadroTabani {
  yerlesen: number;
  /** Seats left empty */
  bos: number;
  /** Lowest and highest placed score; null when nobody was placed */
  enKucuk: number | null;
  enBuyuk: number | null;
}

/** Reference for a post of a round that has no results yet: what similar posts closed at in an earlier round */
export interface KadroEmsali {
  /** The round the reference comes from, "2026/1" */
  donem: string;
  /** Lowest `enKucuk` among that round's posts with the same institution and title */
  enKucuk: number;
  /** How many of that round's posts it was computed from */
  kadro: number;
  /**
   * true: only posts with the same qualification codes were used; false: there
   * were none, so posts with other requirements were. It matters: in KPSS-2026/1
   * the same title at the same institution and province closed up to 25 points
   * apart where the education code differed.
   */
  ayniSart: boolean;
  /** true: only posts in the same province were used; false: none there, so every province was */
  ayniIl: boolean;
}

export interface TercihKadro {
  /** ÖSYM KODU: what the candidate types into the preference form */
  kod: string;
  sbb: string;
  kurum: string;
  /** MEMUR | SÖZLEŞMELİ PERSONEL | KİT SÖZLEŞMELİ PERSONEL ... */
  istihdam: string;
  unvan: string;
  il: string;
  ilce: string;
  birim: string;
  /** MERKEZ | TAŞRA | DÖNER SERMAYE */
  teskilat: string;
  sinif: string;
  derece: string;
  adet: number;
  /** Qualification codes in table order */
  nitelikler: string[];
  /** This round's result; absent until ÖSYM publishes it */
  taban?: KadroTabani;
  /** Earlier round's reference; filled by the worker when the round is loaded */
  emsal?: KadroEmsali;
}

export interface OgrenimKodu {
  metin: string;
  /** Program codes (from "Mezun Olunan Ön Lisans Programı") this code accepts; empty for "any program" */
  programlar: string[];
}

export interface TercihVerisi {
  /** "2026/1" */
  donem: string;
  /** Preference window as ISO dates, when the guide states it */
  tercihBaslangic?: string;
  tercihBitis?: string;
  /** Maximum number of preferences (30 in 2026/1) */
  enFazlaTercih: number;
  kadrolar: TercihKadro[];
  ogrenim: Record<string, OgrenimKodu>;
  /** Special-condition code -> official text */
  ozel: Record<string, string>;
  /** Program code -> name */
  programlar: Record<string, string>;
  /** Code -> the guide's "Başvurma Özel Şartları" section it points to ("Bakınız: ...") */
  aciklamalar: Record<string, { baslik: string; metin: string }>;
  /** Source documents, for the "official text" links */
  belgeler: { ad: string; url: string }[];
}

export type Cevap = "evet" | "hayir";

export interface TercihDurumu {
  /** Program code the user graduated from */
  program?: string;
  cinsiyet?: "kadin" | "erkek";
  /** Answers per special-condition code */
  cevaplar: Record<string, Cevap>;
  /** ÖSYM codes in preference order */
  secilenler: string[];
  /** The user's KPSS score for this table's score type (P93 for associate degree), 0-100 */
  puan?: number;
}

export const BOS_DURUM: TercihDurumu = { cevaplar: {}, secilenler: [] };

const puanMi = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const sayimMi = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Tolerant reader for a stored `taban`; anything not in the expected shape is dropped, never repaired */
export function tabanOku(ham: unknown): KadroTabani | undefined {
  const h = (ham && typeof ham === "object" ? ham : {}) as Record<string, unknown>;
  if (!sayimMi(h.yerlesen) || !sayimMi(h.bos)) return undefined;
  const { enKucuk, enBuyuk } = h;
  if (enKucuk === null && enBuyuk === null) return { yerlesen: h.yerlesen, bos: h.bos, enKucuk: null, enBuyuk: null };
  return puanMi(enKucuk) && puanMi(enBuyuk) ? { yerlesen: h.yerlesen, bos: h.bos, enKucuk, enBuyuk } : undefined;
}

/** Tolerant reader for a stored `emsal` */
export function emsalOku(ham: unknown): KadroEmsali | undefined {
  const h = (ham && typeof ham === "object" ? ham : {}) as Record<string, unknown>;
  if (typeof h.donem !== "string" || !h.donem || !puanMi(h.enKucuk) || !sayimMi(h.kadro) || h.kadro < 1) return undefined;
  if (typeof h.ayniSart !== "boolean" || typeof h.ayniIl !== "boolean") return undefined;
  return { donem: h.donem, enKucuk: h.enKucuk, kadro: h.kadro, ayniSart: h.ayniSart, ayniIl: h.ayniIl };
}

/**
 * The lowest placed score known for a post: this round's own once its results
 * are in (null when nobody was placed), otherwise the earlier round's
 * reference. undefined when there is neither.
 */
export function kadroEnKucukPuan(kadro: TercihKadro): number | null | undefined {
  return kadro.taban ? kadro.taban.enKucuk : kadro.emsal?.enKucuk;
}

/** A score against a lowest placed score: equal is enough. null when either is unknown. */
export function puanKarsilastir(puan: number | undefined, enKucuk: number | null | undefined): "yeter" | "yetmez" | null {
  if (puan === undefined || enKucuk === null || enKucuk === undefined) return null;
  return puan >= enKucuk ? "yeter" : "yetmez";
}

/** Tolerant reader for the jsonb column: unknown shapes become an empty state */
export function durumDogrula(ham: unknown): TercihDurumu {
  const h = (ham && typeof ham === "object" ? ham : {}) as Record<string, unknown>;
  const cevaplar: Record<string, Cevap> = {};
  if (h.cevaplar && typeof h.cevaplar === "object") {
    for (const [kod, c] of Object.entries(h.cevaplar as Record<string, unknown>)) {
      if (/^\d{4}$/.test(kod) && (c === "evet" || c === "hayir")) cevaplar[kod] = c;
    }
  }
  return {
    program: typeof h.program === "string" && /^\d{4}$/.test(h.program) ? h.program : undefined,
    cinsiyet: h.cinsiyet === "kadin" || h.cinsiyet === "erkek" ? h.cinsiyet : undefined,
    cevaplar,
    secilenler: Array.isArray(h.secilenler)
      ? [...new Set(h.secilenler.filter((k): k is string => typeof k === "string" && /^\d{6,12}$/.test(k)))]
      : [],
    // Left out (not `undefined`) when absent, so states compare and serialise as before
    ...(puanMi(h.puan) ? { puan: h.puan } : {}),
  };
}

export type KadroDurumu = "uygun" | "dogrula" | "kapali";

export interface KadroSonucu {
  durum: KadroDurumu;
  /** Education code the user's program satisfies, if any */
  ogrenimKarsilayan?: string;
  /** Codes that close the post for this user */
  kapatan: string[];
  /** Codes still waiting for an answer (or that the page cannot judge) */
  bekleyen: string[];
}

const TR_KUCUK = (s: string) => s.toLocaleLowerCase("tr-TR");

/** "Herhangi bir önlisans programından mezun olmak." and nothing narrower */
function herhangiProgramMi(k: OgrenimKodu): boolean {
  return k.programlar.length === 0 && /^herhangi bir ön ?lisans programından mezun olmak\.?$/.test(TR_KUCUK(k.metin).trim());
}

function cinsiyetKodu(kod: string, metin: string | undefined): "kadin" | "erkek" | null {
  const m = TR_KUCUK(metin ?? "");
  if (/cinsiyeti erkek/.test(m)) return "erkek";
  if (/cinsiyeti kadın/.test(m)) return "kadin";
  return null;
}

/**
 * Codes that describe the job instead of asking for anything. "Bakınız: Başvurma
 * Özel Şartları - Destek Personeli" points to a guide section that lists the
 * duties of the title; whatever that section requires (cleaning, driving licence,
 * cooking certificate...) is on the row as a separate code. Asking the user to
 * confirm it was noise, so it counts as met. Matched by its official text, not
 * its number.
 */
export function isTanimiKoduMu(kod: string, veri: TercihVerisi): boolean {
  return /^bakınız: başvurma özel şartları - destek personeli\.?$/.test(TR_KUCUK(veri.ozel[kod] ?? "").trim());
}

/**
 * Can this user list this post? "uygun" only when every code is settled in the
 * user's favour; one unanswered or unknown code makes it "dogrula", never "uygun".
 */
export function kadroSonucu(kadro: TercihKadro, veri: TercihVerisi, durum: TercihDurumu): KadroSonucu {
  const kapatan: string[] = [];
  const bekleyen: string[] = [];
  let ogrenimKarsilayan: string | undefined;

  const ogrenimKodlari = kadro.nitelikler.filter((k) => veri.ogrenim[k]);
  if (ogrenimKodlari.length) {
    ogrenimKarsilayan = ogrenimKodlari.find((k) => {
      const tanim = veri.ogrenim[k];
      return herhangiProgramMi(tanim) || (!!durum.program && tanim.programlar.includes(durum.program));
    });
    if (!ogrenimKarsilayan) {
      // A code whose program list could not be read is not proof that the user is excluded
      const okunamayan = ogrenimKodlari.filter((k) => veri.ogrenim[k].programlar.length === 0 && !herhangiProgramMi(veri.ogrenim[k]));
      if (!durum.program || okunamayan.length) bekleyen.push(...(durum.program ? okunamayan : ogrenimKodlari));
      else kapatan.push(...ogrenimKodlari);
    }
  }

  for (const kod of kadro.nitelikler) {
    if (veri.ogrenim[kod]) continue;
    const metin = veri.ozel[kod];
    // A code in neither dictionary cannot be judged, whatever was answered for it
    if (metin === undefined) {
      bekleyen.push(kod);
      continue;
    }
    if (isTanimiKoduMu(kod, veri)) continue;
    const cinsiyet = cinsiyetKodu(kod, metin);
    if (cinsiyet) {
      if (!durum.cinsiyet) bekleyen.push(kod);
      else if (durum.cinsiyet !== cinsiyet) kapatan.push(kod);
      continue;
    }
    const cevap = durum.cevaplar[kod];
    if (cevap === "hayir") kapatan.push(kod);
    else if (cevap !== "evet") bekleyen.push(kod);
  }

  return {
    durum: kapatan.length ? "kapali" : bekleyen.length ? "dogrula" : "uygun",
    ogrenimKarsilayan,
    kapatan,
    bekleyen,
  };
}

/** Official text of any code on a row, for display */
export function kodMetni(kod: string, veri: TercihVerisi): string {
  return veri.ogrenim[kod]?.metin ?? veri.ozel[kod] ?? "Bu kodun açıklaması kılavuzda bulunamadı.";
}

export interface TercihSorusu {
  kod: string;
  metin: string;
  /** Posts (and seats) that are otherwise open and hinge on this code */
  kadro: number;
  kontenjan: number;
}

/**
 * Special-condition codes worth asking about: only those on posts that the
 * user's program and gender do not already close, most valuable first.
 */
export function sorulacakKodlar(veri: TercihVerisi, durum: TercihDurumu): TercihSorusu[] {
  const sayac = new Map<string, { kadro: number; kontenjan: number }>();
  for (const kadro of veri.kadrolar) {
    for (const kod of kadro.nitelikler) {
      if (veri.ogrenim[kod] || veri.ozel[kod] === undefined || isTanimiKoduMu(kod, veri) || cinsiyetKodu(kod, veri.ozel[kod])) continue;
      // Does the post hinge on this code? Judge it with this one answer left out and the
      // others applied, so an answered question stays listed (and can be changed) while a
      // post some other answer already closed stops counting.
      const digerleri = { ...durum.cevaplar };
      delete digerleri[kod];
      const s = kadroSonucu(kadro, veri, { ...durum, cevaplar: digerleri });
      if (s.durum === "kapali") continue;
      const onceki = sayac.get(kod) ?? { kadro: 0, kontenjan: 0 };
      sayac.set(kod, { kadro: onceki.kadro + 1, kontenjan: onceki.kontenjan + kadro.adet });
    }
  }
  return [...sayac.entries()]
    .map(([kod, n]) => ({ kod, metin: kodMetni(kod, veri), ...n }))
    .sort((a, b) => b.kontenjan - a.kontenjan || a.kod.localeCompare(b.kod));
}
