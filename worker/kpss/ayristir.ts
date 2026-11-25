// KPSS preference guide — parsers for the documents ÖSYM publishes with each
// placement round (see lib/kpss-tercih.ts for what the result is used for).
//
// Everything here works on already-extracted input (positioned text runs, page
// texts, the announcement page's HTML) and has no network or database access;
// worker/kpss/yukle.ts does the fetching and the storing.
//
// The tables are read from positioned text, not from plain extracted text:
// plain text merges the columns of Tablo-2 and wraps multi-line cells
// unpredictably, and in the education-code table a wrapped definition would be
// indistinguishable from the program codes that follow it. Measured on
// KPSS-2026/1 (pdf.js via unpdf):
//   - every table cell line is one text run, and runs come in the order the
//     file draws them: row by row, the code cell first;
//   - header cells are centred, text cells are left-aligned, and a cell's runs
//     always start to the right of the previous column's header text. So a run
//     belongs to the first column whose header ends at or after the run's start;
//   - page titles and footers are drawn after the last row, so they are removed
//     by position (above the header line / on the page-number baseline).
// Rows are grouped by that drawing order and the result is then checked against
// the page: a run that does not lie on its own row's lines is an error.
// A wrong row here becomes a wrong "you can list this post", so every reader
// throws on anything it does not recognise instead of guessing.

import { extractText, getDocumentProxy } from "unpdf";
import type { KadroTabani, OgrenimKodu, TercihKadro, TercihVerisi } from "../../lib/kpss-tercih";

/** One text run of a PDF page. Pages keep the order the file draws the runs in. */
export interface Oge {
  x: number;
  y: number;
  w: number;
  s: string;
}

/** pdf.js verbosity 0 (errors only): ÖSYM's fonts make it print a "TT: undefined function" warning per glyph run */
const SESSIZ = { verbosity: 0 };

/** Positioned, non-blank text runs of every page */
export async function pdfOgeleri(veri: Uint8Array): Promise<Oge[][]> {
  const pdf = await getDocumentProxy(veri, SESSIZ);
  const sayfalar: Oge[][] = [];
  let toplam = 0;
  let egik = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const icerik = await (await pdf.getPage(n)).getTextContent();
    const ogeler: Oge[] = [];
    for (const o of icerik.items) {
      if (!("str" in o)) continue;
      const s = o.str.replace(/\s+/g, " ").trim();
      if (!s) continue;
      toplam++;
      if (Math.abs(o.transform[1]) > 0.01 || Math.abs(o.transform[2]) > 0.01) egik++;
      ogeler.push({ x: o.transform[4], y: o.transform[5], w: o.width, s });
    }
    sayfalar.push(ogeler);
  }
  // Column positions mean nothing on rotated text
  if (toplam && egik > toplam / 10) throw new Error("PDF metni döndürülmüş, sütun konumları okunamıyor");
  return sayfalar;
}

/** Plain text of every page (for the guide, which is running prose) */
export async function pdfSayfaMetinleri(veri: Uint8Array): Promise<string[]> {
  const { text } = await extractText(await getDocumentProxy(veri, SESSIZ), { mergePages: false });
  return text;
}

const HARF: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** "TABLO-2. Ön Lisans…" -> "tablo 2 on lisans…": case, diacritics and punctuation folded for matching */
export function sade(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, (c) => HARF[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const donemBul = (metin: string): string | undefined => {
  // "KPSS-2026/1" in announcements and guides; Tablo-2 of 2025/2 prints "KPSS 2025-2"
  const m = metin.match(/KPSS[\s-]*(20\d{2})\s*[\/-]\s*(\d{1,2})(?!\d)/i);
  return m ? `${m[1]}/${Number(m[2])}` : undefined;
};

// --- Positioned-table helpers -------------------------------------------------

/** Baselines closer than this are the same text line (cells of a row differ by ~0.3) */
const AYNI_SATIR = 1.6;
/** Slack when comparing a run's start with a column edge */
const KENAR_PAYI = 0.5;

/**
 * Removes the page-number line: the lowest baseline of the page when it holds a
 * bare 1-3 digit number and no code (a table row's last line always carries its
 * code, or is plain text). A footnote on the same baseline goes with it.
 */
function altBilgisiz(ogeler: Oge[]): Oge[] {
  if (!ogeler.length) return ogeler;
  const enAlt = Math.min(...ogeler.map((o) => o.y));
  const taban = new Set(ogeler.filter((o) => o.y - enAlt < AYNI_SATIR));
  const sayfaNo = [...taban].some((o) => /^\d{1,3}$/.test(o.s));
  const kod = [...taban].some((o) => /^\d{4,}$/.test(o.s));
  return sayfaNo && !kod ? ogeler.filter((o) => !taban.has(o)) : ogeler;
}

/** Joins wrapped lines; a line ending in "letter-" continues without a space ("GÖREVLİSİ-" + "SİLAHLI") */
function satirlariBirlestir(satirlar: string[]): string {
  let metin = "";
  for (const s of satirlar) {
    if (!metin) metin = s;
    else metin += /[\p{L}\p{N})]-$/u.test(metin) ? s : ` ${s}`;
  }
  return metin.replace(/\s+/g, " ").trim();
}

/** Text lines of one cell: its runs top to bottom, left to right */
function hucreSatirlari(ogeler: Oge[]): string[] {
  const sirali = [...ogeler].sort((a, b) => b.y - a.y);
  const satirlar: Oge[][] = [];
  for (const o of sirali) {
    const son = satirlar[satirlar.length - 1];
    if (son && son[0].y - o.y < AYNI_SATIR) son.push(o);
    else satirlar.push([o]);
  }
  return satirlar.map((s) => s.sort((a, b) => a.x - b.x).map((o) => o.s).join(" "));
}

const hucreMetni = (ogeler: Oge[]) => satirlariBirlestir(hucreSatirlari(ogeler));

// --- Tablo-2 ------------------------------------------------------------------

/** Header text (folded) -> field. "nit3" keeps its own column so the code order is the table's. */
function tablo2Alani(baslik: string): string | null {
  if (/^osym\b/.test(baslik)) return "kod";
  if (/^sbb\b/.test(baslik)) return "sbb";
  if (/^kurum\b/.test(baslik)) return "kurum";
  if (/^istihdam\b/.test(baslik)) return "istihdam";
  if (/^(kadro|unvan)\b/.test(baslik)) return "unvan";
  if (baslik === "il") return "il";
  if (baslik === "ilce") return "ilce";
  if (/^birim\b/.test(baslik)) return "birim";
  if (/^teskilat\b/.test(baslik)) return "teskilat";
  // Whole words only: the post title "HİZMETLİ" must never read as the "HİZMET SINIFI" header
  if (/^(hizmet|sinifi?)\b/.test(baslik)) return "sinif";
  if (/^derece\b/.test(baslik)) return "derece";
  if (/^adet\b/.test(baslik)) return "adet";
  // "Nit1 … Nit9" (2026/1) or bare "1 … 9" under an "Aranan Nitelikler" heading (2025/2)
  const nit = baslik.match(/^(?:nit(?:elik)? ?)?(\d)$/);
  return nit && nit[1] !== "0" ? `nit${Number(nit[1])}` : null;
}

// "BİRİM ADI" is not in every round's table (2026/1 has it, 2025/2 does not)
const TABLO2_ZORUNLU = ["kod", "sbb", "kurum", "istihdam", "unvan", "il", "ilce", "teskilat", "sinif", "derece", "adet", "nit1"];
/** Header cells are two lines at most ("HİZMET" over "SINIFI"), ±4.2 around the middle at this font size */
const TABLO2_BASLIK_BANDI = 10;

interface Kolon {
  alan: string;
  /** Right end of the column's header text */
  sag: number;
}

interface Tablo2Satiri {
  kod: string;
  /** Baseline of the ÖSYM code cell */
  y: number;
  /** Field -> the row's runs in that column */
  hucre: Map<string, Oge[]>;
}

/**
 * Header row of a table whose first column is the code: the columns (by the
 * right end of their header text) and the header's lowest baseline. null when
 * the page has no header row. `alanBul` maps a folded header text to its
 * field, or null for text that is not part of the header.
 */
function tabloBasligi(
  ogeler: Oge[],
  alanBul: (baslik: string, oge: Oge) => string | null,
  zorunlu: string[],
  belge: string
): { kolonlar: Kolon[]; alt: number } | null {
  const capa = ogeler.find((o) => alanBul(sade(o.s), o) === "kod");
  if (!capa) return null;
  const sag = new Map<string, number>();
  let alt = capa.y;
  for (const o of ogeler) {
    if (Math.abs(o.y - capa.y) > TABLO2_BASLIK_BANDI) continue;
    const alan = alanBul(sade(o.s), o);
    if (alan === null) continue;
    // "" is header text that names no column by itself (a second line such as "Sayısı"): it only extends the header downwards
    if (alan) sag.set(alan, Math.max(sag.get(alan) ?? -Infinity, o.x + o.w));
    alt = Math.min(alt, o.y);
  }
  const eksik = zorunlu.filter((a) => !sag.has(a));
  if (eksik.length) throw new Error(`${belge} başlık satırında beklenen sütunlar yok: ${eksik.join(", ")}`);
  return { kolonlar: [...sag].map(([alan, s]) => ({ alan, sag: s })).sort((a, b) => a.sag - b.sag), alt };
}

/**
 * A bare digit is a code-column header ("1 … 9") only to the right of the
 * "ADET" header. The first row of a page lies inside the header band, and its
 * one-digit grade or seat count would otherwise read as a header cell and take
 * the whole row out of the table (KPSS-2025/2: the first row of every page).
 */
const tablo2Basligi = (ogeler: Oge[]) => {
  const adet = ogeler.find((o) => sade(o.s) === "adet");
  const sinir = adet ? adet.x + adet.w : Infinity;
  return tabloBasligi(ogeler, (baslik, o) => (/^\d$/.test(baslik) && o.x <= sinir ? null : tablo2Alani(baslik)), TABLO2_ZORUNLU, "Tablo-2");
};

/** "-" is how the table prints an empty cell */
const bosIse = (s: string) => (/^[-–—]*$/.test(s) ? "" : s);

/**
 * The table is exported with fixed row heights: where the institution name is
 * the only wrapped cell of a row, its second line is cut off in the PDF itself
 * (KPSS-2026/1: "TAPU VE KADASTRO GENEL" on 66 rows, the full "… GENEL
 * MÜDÜRLÜĞÜ" on the rows that another wrapped cell made taller). A one-line
 * cell is completed only when it equals the first line of wrapped cells in the
 * same column and all of those agree on the rest; otherwise it stays as printed
 * ("ELEKTRİK ÜRETİM A.Ş. GENEL" has no complete twin in that table).
 *
 * Used for the institution name only. A post title is never completed: a title
 * that is whole on one line ("TEKNİKER") can equal the first line of a longer
 * one ("TEKNİKER" over "(ELEKTRİK-ELEKTRONİK)"), and nothing in the file tells
 * the two cases apart.
 */
function kesikHucreleriTamamla(hucreler: string[][]): string[] {
  const tamlar = new Map<string, Set<string>>();
  for (const satirlar of hucreler) {
    if (satirlar.length < 2) continue;
    const tam = tamlar.get(satirlar[0]) ?? new Set<string>();
    tam.add(satirlariBirlestir(satirlar));
    tamlar.set(satirlar[0], tam);
  }
  return hucreler.map((satirlar) => {
    const tam = satirlar.length === 1 ? tamlar.get(satirlar[0]) : undefined;
    return tam?.size === 1 ? [...tam][0] : satirlariBirlestir(satirlar);
  });
}

/**
 * Tablo-2 rows from positioned text. Throws when the layout is not the one
 * described at the top of this file: a cell that does not look like its column,
 * a code that is not on its row's baseline, text outside any row.
 */
export function tablo2Ayristir(sayfalar: Oge[][]): { kadrolar: TercihKadro[]; donem?: string } {
  const kadrolar: TercihKadro[] = [];
  const kurumSatirlari: string[][] = [];
  const sorunlar: string[] = [];
  let donem: string | undefined;
  let kolonlar: Kolon[] | null = null;

  sayfalar.forEach((sayfa, i) => {
    const baslik = tablo2Basligi(sayfa);
    // A page without a header row continues the previous page's table
    if (baslik) kolonlar = baslik.kolonlar;
    if (!kolonlar) {
      if (sayfa.length) sorunlar.push(`sayfa ${i + 1}: başlık satırı bulunamadı`);
      return;
    }
    const kolonlari: Kolon[] = kolonlar;
    if (baslik && !donem) donem = donemBul(sayfa.filter((o) => o.y >= baslik.alt).map((o) => o.s).join(" "));
    const govde = altBilgisiz(baslik ? sayfa.filter((o) => o.y < baslik.alt - 2) : sayfa);
    const kolonBul = (x: number) => (kolonlari.find((k) => x <= k.sag + KENAR_PAYI) ?? kolonlari[kolonlari.length - 1]).alan;

    let satir: Tablo2Satiri | null = null;
    const satirlar: Tablo2Satiri[] = [];
    for (const o of govde) {
      const alan = kolonBul(o.x);
      if (alan === "kod") {
        if (/^\d{9}$/.test(o.s)) {
          satir = { kod: o.s, y: o.y, hucre: new Map() };
          satirlar.push(satir);
        } else if (!o.s.startsWith("*")) {
          // "*Aranan Nitelikleri mutlaka okuyunuz." is the table's footnote; anything else is unexpected
          sorunlar.push(`sayfa ${i + 1}: ÖSYM kodu sütununda beklenmeyen metin "${o.s.slice(0, 40)}"`);
        }
        continue;
      }
      if (!satir) {
        sorunlar.push(`sayfa ${i + 1}: hiçbir satıra ait olmayan metin "${o.s.slice(0, 40)}"`);
        continue;
      }
      const hucre = satir.hucre.get(alan);
      if (hucre) hucre.push(o);
      else satir.hucre.set(alan, [o]);
    }

    satirlar.forEach((s, n) => {
      const hata = (m: string) => sorunlar.push(`${s.kod}: ${m}`);
      const metin = (alan: string) => bosIse(hucreMetni(s.hucre.get(alan) ?? []));
      // Rows are grouped by drawing order, so the grouping is checked against the
      // page: the code sits on the last line of its row, and every cell line of the
      // row lies between that baseline and the code of the row above (measured on
      // KPSS-2026/1: 0 to 8.6 above its own code, at least 8.3 below the previous one)
      const ust = n ? satirlar[n - 1].y : Infinity;
      if (s.y > ust - AYNI_SATIR) hata("satır bir öncekinin altında değil");
      const disarida = [...s.hucre.values()].flat().find((o) => o.y < s.y - AYNI_SATIR || o.y > ust - AYNI_SATIR);
      if (disarida) hata(`"${disarida.s.slice(0, 30)}" satırın dikey sınırları dışında`);
      // Single-line cells sit on the code's baseline whatever the row height; a code
      // from another baseline would mean the rows were grouped wrongly
      for (const [alan, ogeler] of s.hucre) {
        if (!/^(sbb|derece|adet|nit\d+)$/.test(alan)) continue;
        // A post can be announced for several grades ("8, 9"), drawn as separate runs on one line
        if (ogeler.length > 1 && alan !== "derece") hata(`${alan} hücresinde birden çok değer`);
        if (ogeler.some((o) => Math.abs(o.y - s.y) > AYNI_SATIR)) hata(`${alan} hücresi satırın hizasında değil`);
      }
      const nitelikler: string[] = [];
      for (const k of kolonlari) {
        if (!k.alan.startsWith("nit")) continue;
        const kod = metin(k.alan);
        if (!kod) continue;
        if (/^\d{4}$/.test(kod)) nitelikler.push(kod);
        else hata(`${k.alan} sütununda nitelik kodu olmayan değer "${kod.slice(0, 20)}"`);
      }
      const sbb = metin("sbb");
      const derece = metin("derece");
      const adet = metin("adet");
      if (sbb && !/^\d+$/.test(sbb)) hata(`SBB kayıt no sayı değil: "${sbb.slice(0, 20)}"`);
      if (derece && !/^\d{1,2}(\s*,\s*\d{1,2})*$/.test(derece)) hata(`derece sayı değil: "${derece.slice(0, 20)}"`);
      if (!/^\d{1,5}$/.test(adet)) hata(`adet sayı değil: "${adet.slice(0, 20)}"`);
      kurumSatirlari.push(hucreSatirlari(s.hucre.get("kurum") ?? []));
      kadrolar.push({
        kod: s.kod,
        sbb,
        kurum: metin("kurum"),
        istihdam: metin("istihdam"),
        unvan: metin("unvan"),
        il: metin("il"),
        ilce: metin("ilce"),
        birim: metin("birim"),
        teskilat: metin("teskilat"),
        sinif: metin("sinif"),
        derece,
        adet: Number(adet) || 0,
        nitelikler,
      });
    });
  });

  kesikHucreleriTamamla(kurumSatirlari).forEach((metin, i) => (kadrolar[i].kurum = bosIse(metin)));

  // Every ÖSYM code drawn anywhere in the file must have become a row: a row lost
  // to the header band or to a page break would otherwise go unnoticed
  const cizilen = new Set(sayfalar.flat().filter((o) => /^\d{9}$/.test(o.s)).map((o) => o.s));
  const okunan = new Set(kadrolar.map((k) => k.kod));
  const kayip = [...cizilen].filter((k) => !okunan.has(k));
  if (kayip.length) sorunlar.push(`${kayip.length} satır okunamadı (ilk kodlar: ${kayip.slice(0, 5).join(", ")})`);

  const gorulen = new Set<string>();
  for (const k of kadrolar) {
    if (gorulen.has(k.kod)) sorunlar.push(`${k.kod}: ÖSYM kodu tabloda iki kez geçiyor`);
    gorulen.add(k.kod);
  }
  if (sorunlar.length) {
    throw new Error(`Tablo-2 beklenen düzende değil (${sorunlar.length} sorun): ${sorunlar.slice(0, 5).join("; ")}`);
  }
  return { kadrolar, donem };
}

// --- Placement results ("en küçük ve en büyük puanlar") ---------------------------

/** One row of the list ÖSYM publishes after a round closes */
export interface PuanSatiri extends KadroTabani {
  /** "Program Adı" as printed: institution / province / organisation */
  ad: string;
  unvan: string;
  kontenjan: number;
}

/** Header text (folded) -> field; "" for the second header lines ("Sayısı", "Puan"), which name no column on their own */
function puanAlani(baslik: string): string | null {
  if (/^(sayisi|puan)$/.test(baslik)) return "";
  if (/^program kodu?$/.test(baslik)) return "kod";
  if (/^program adi$/.test(baslik)) return "ad";
  if (/^kadro unvani?$/.test(baslik)) return "unvan";
  if (/^kontenjan( sayisi)?$/.test(baslik)) return "kontenjan";
  if (/^yerlesen aday( sayisi)?$/.test(baslik)) return "yerlesen";
  if (/^bos kalan kontenjan( sayisi)?$/.test(baslik)) return "bos";
  if (/^en kucuk( puan)?$/.test(baslik)) return "enKucuk";
  if (/^en buyuk( puan)?$/.test(baslik)) return "enBuyuk";
  return null;
}

const PUAN_ZORUNLU = ["kod", "ad", "unvan", "kontenjan", "yerlesen", "bos", "enKucuk", "enBuyuk"];
const PUAN_BELGESI = "En küçük ve en büyük puanlar tablosu";
/** The title line repeated at the top of every page; only the first page has a header row under it */
const puanBasligiMi = (o: Oge) => /\ben kucuk ve en buyuk puanlar\b/.test(sade(o.s));

/** "84,94651" -> 84.94651; null for anything that is not a score between 0 and 100 written with a decimal comma */
function puanOku(s: string): number | null {
  if (!/^\d{1,3},\d{1,5}$/.test(s)) return null;
  const n = Number(s.replace(",", "."));
  return n > 0 && n <= 100 ? n : null;
}

/**
 * The placement results of one round: ÖSYM code -> seats, placed, empty,
 * lowest and highest placed score. Measured on KPSS-2026/1 (ön lisans, 410
 * rows on 11 pages): the header row is on the first page only, the title is on
 * every page, every row is eight single-line runs on one baseline drawn code
 * first, and no cell wraps. Columns are assigned as in Tablo-2 (see the top of
 * this file) and wrapped name or title lines are accepted; the number cells
 * must be single values on the code's baseline.
 *
 * That file has no post without a placement, so how ÖSYM prints one is not
 * known. A row with 0 placed is accepted only with both score cells empty,
 * dashes or zero, and gets null scores; a row with placements must carry both
 * scores. Everything else throws.
 */
export function puanTablosuAyristir(sayfalar: Oge[][]): { donem?: string; satirlar: Record<string, PuanSatiri> } {
  const satirlar: Record<string, PuanSatiri> = {};
  const sorunlar: string[] = [];
  const donemler = new Set<string>();
  let kolonlar: Kolon[] | null = null;

  sayfalar.forEach((sayfa, i) => {
    const baslik = tabloBasligi(sayfa, puanAlani, PUAN_ZORUNLU, PUAN_BELGESI);
    if (baslik) kolonlar = baslik.kolonlar;
    if (!kolonlar) {
      if (sayfa.length) sorunlar.push(`sayfa ${i + 1}: başlık satırı bulunamadı`);
      return;
    }
    const kolonlari: Kolon[] = kolonlar;
    // With a header row everything above it is the title; without one the title is recognised by its text
    const ust = sayfa.filter((o) => (baslik ? o.y >= baslik.alt : puanBasligiMi(o)));
    const govde = altBilgisiz(sayfa.filter((o) => (baslik ? o.y < baslik.alt - 2 : !puanBasligiMi(o))));
    const donem = donemBul(ust.map((o) => o.s).join(" "));
    if (donem) donemler.add(donem);
    if (!baslik && ust.length && govde.some((o) => o.y > Math.min(...ust.map((u) => u.y)) - AYNI_SATIR)) {
      sorunlar.push(`sayfa ${i + 1}: sayfa başlığı tablonun üstünde değil`);
    }
    const kolonBul = (x: number) => (kolonlari.find((k) => x <= k.sag + KENAR_PAYI) ?? kolonlari[kolonlari.length - 1]).alan;

    let satir: Tablo2Satiri | null = null;
    const sayfaSatirlari: Tablo2Satiri[] = [];
    for (const o of govde) {
      const alan = kolonBul(o.x);
      if (alan === "kod") {
        if (/^\d{9}$/.test(o.s)) {
          satir = { kod: o.s, y: o.y, hucre: new Map() };
          sayfaSatirlari.push(satir);
        } else {
          sorunlar.push(`sayfa ${i + 1}: program kodu sütununda beklenmeyen metin "${o.s.slice(0, 40)}"`);
        }
        continue;
      }
      if (!satir) {
        sorunlar.push(`sayfa ${i + 1}: hiçbir satıra ait olmayan metin "${o.s.slice(0, 40)}"`);
        continue;
      }
      const hucre = satir.hucre.get(alan);
      if (hucre) hucre.push(o);
      else satir.hucre.set(alan, [o]);
    }

    sayfaSatirlari.forEach((s, n) => {
      const hata = (m: string) => sorunlar.push(`${s.kod}: ${m}`);
      const metin = (alan: string) => bosIse(hucreMetni(s.hucre.get(alan) ?? []));
      // Rows are grouped by drawing order; checked against the page: each row below the one
      // before it, and all of its text between the codes of its two neighbours
      const yukari = n ? sayfaSatirlari[n - 1].y : Infinity;
      const asagi = n + 1 < sayfaSatirlari.length ? sayfaSatirlari[n + 1].y : -Infinity;
      if (s.y > yukari - AYNI_SATIR) hata("satır bir öncekinin altında değil");
      const disarida = [...s.hucre.values()].flat().find((o) => o.y > yukari - AYNI_SATIR || o.y < asagi + AYNI_SATIR);
      if (disarida) hata(`"${disarida.s.slice(0, 30)}" satırın dikey sınırları dışında`);
      for (const [alan, ogeler] of s.hucre) {
        if (alan === "ad" || alan === "unvan") continue;
        if (ogeler.length > 1) hata(`${alan} hücresinde birden çok değer`);
        if (ogeler.some((o) => Math.abs(o.y - s.y) > AYNI_SATIR)) hata(`${alan} hücresi satırın hizasında değil`);
      }

      const ad = metin("ad");
      const unvan = metin("unvan");
      if (!ad) hata("program adı boş");
      if (!unvan) hata("kadro unvanı boş");
      const sayilar = ["kontenjan", "yerlesen", "bos"].map((alan) => {
        const m = metin(alan);
        if (!/^\d{1,5}$/.test(m)) hata(`${alan} sayı değil: "${m.slice(0, 20)}"`);
        return /^\d{1,5}$/.test(m) ? Number(m) : NaN;
      });
      const [kontenjan, yerlesen, bos] = sayilar;
      const sayilarTamam = sayilar.every(Number.isInteger);
      if (sayilarTamam && (kontenjan < 1 || yerlesen + bos !== kontenjan)) {
        hata(`kontenjan ${kontenjan}, yerleşen ${yerlesen} ve boş kalan ${bos} birbirini tutmuyor`);
      }
      const hamKucuk = metin("enKucuk");
      const hamBuyuk = metin("enBuyuk");
      let enKucuk: number | null = null;
      let enBuyuk: number | null = null;
      if (yerlesen === 0) {
        // Nobody placed: there is no score to read, whichever way the empty cells are printed
        const bosMu = (m: string) => m === "" || /^0(,0+)?$/.test(m);
        if (!bosMu(hamKucuk) || !bosMu(hamBuyuk)) hata(`yerleşen yok ama puan yazıyor: "${hamKucuk.slice(0, 12)}" / "${hamBuyuk.slice(0, 12)}"`);
      } else if (sayilarTamam) {
        enKucuk = puanOku(hamKucuk);
        enBuyuk = puanOku(hamBuyuk);
        if (enKucuk === null || enBuyuk === null) hata(`puan okunamadı: "${hamKucuk.slice(0, 12)}" / "${hamBuyuk.slice(0, 12)}"`);
        else if (enKucuk > enBuyuk) hata(`en küçük puan (${hamKucuk}) en büyük puandan (${hamBuyuk}) büyük`);
        else if (yerlesen === 1 && enKucuk !== enBuyuk) hata(`tek yerleşen var ama iki puan farklı: ${hamKucuk} / ${hamBuyuk}`);
      }
      if (satirlar[s.kod]) hata("program kodu tabloda iki kez geçiyor");
      satirlar[s.kod] = { ad, unvan, kontenjan, yerlesen, bos, enKucuk, enBuyuk };
    });
  });

  if (!sorunlar.length && !Object.keys(satirlar).length) sorunlar.push("hiç satır okunamadı");
  if (donemler.size > 1) sorunlar.push(`sayfa başlıkları farklı dönemleri gösteriyor: ${[...donemler].join(", ")}`);
  if (sorunlar.length) {
    throw new Error(`${PUAN_BELGESI} beklenen düzende değil (${sorunlar.length} sorun): ${sorunlar.slice(0, 5).join("; ")}`);
  }
  return { donem: [...donemler][0], satirlar };
}

/**
 * The list against the round it is supposed to belong to, by ÖSYM code. Only
 * compares; the caller decides what is acceptable.
 */
export function puanlariKarsilastir(
  kadrolar: TercihKadro[],
  satirlar: Record<string, PuanSatiri>
): {
  /** Codes present in both */
  eslesen: string[];
  /** Codes of the list that the round does not have */
  yabanci: string[];
  /** Posts of the round the list says nothing about */
  sonucsuz: string[];
  /** Matching codes whose seat count or title differs between the two documents */
  farkli: string[];
} {
  const tablodaki = new Map(kadrolar.map((k) => [k.kod, k]));
  const kodlar = Object.keys(satirlar);
  const eslesen = kodlar.filter((kod) => tablodaki.has(kod));
  return {
    eslesen,
    yabanci: kodlar.filter((kod) => !tablodaki.has(kod)),
    sonucsuz: kadrolar.filter((k) => !satirlar[k.kod]).map((k) => k.kod),
    farkli: eslesen.filter((kod) => {
      const k = tablodaki.get(kod)!;
      return k.adet !== satirlar[kod].kontenjan || sade(k.unvan) !== sade(satirlar[kod].unvan);
    }),
  };
}

// --- Code dictionaries ----------------------------------------------------------

interface SozlukSatiri {
  kod: string;
  /** Baseline of the code */
  y: number;
  /** Runs of the row that are not the code, in drawing order */
  ogeler: Oge[];
}

/**
 * Rows are grouped by drawing order; this checks the grouping against the page.
 * A code is drawn on the first line of its text (Özel Koşullar), on its only
 * line (program list) or centred on it (education codes), so its baseline
 * always lies within the lines of its own text. Text that belongs to a
 * neighbouring row is a full line away or more.
 */
const metniKoduylaAyniHizada = (s: SozlukSatiri, metin: Oge[]) =>
  !metin.length || (s.y >= Math.min(...metin.map((o) => o.y)) - AYNI_SATIR && s.y <= Math.max(...metin.map((o) => o.y)) + AYNI_SATIR);

/**
 * Rows of a "code | text | …" table. `baslikBul` returns, per page, the right
 * end of the code column's header and the header row's lowest baseline. A row
 * starts at a 4-digit run inside the code column and owns every run drawn until
 * the next one, which is how wrapped texts and vertically centred codes stay
 * together (a wrapped line that happens to start with a number is in the text
 * column, so it cannot open a row).
 */
function sozlukSatirlari(
  sayfalar: Oge[][],
  belge: string,
  baslikBul: (sayfa: Oge[]) => { kodSag: number; alt: number } | null
): SozlukSatiri[] {
  const satirlar: SozlukSatiri[] = [];
  const sorunlar: string[] = [];
  let kodSag: number | null = null;
  sayfalar.forEach((sayfa, i) => {
    const baslik = baslikBul(sayfa);
    if (baslik) kodSag = baslik.kodSag;
    if (kodSag === null) {
      if (sayfa.length) sorunlar.push(`sayfa ${i + 1}: başlık satırı bulunamadı`);
      return;
    }
    const sag: number = kodSag;
    const govde = altBilgisiz(baslik ? sayfa.filter((o) => o.y < baslik.alt - 2) : sayfa);
    let satir: SozlukSatiri | null = null;
    for (const o of govde) {
      if (o.x < sag + KENAR_PAYI) {
        if (/^\d{4}$/.test(o.s)) {
          satir = { kod: o.s, y: o.y, ogeler: [] };
          satirlar.push(satir);
        } else {
          sorunlar.push(`sayfa ${i + 1}: kod sütununda beklenmeyen metin "${o.s.slice(0, 40)}"`);
        }
      } else if (satir) {
        satir.ogeler.push(o);
      } else {
        sorunlar.push(`sayfa ${i + 1}: hiçbir koda ait olmayan metin "${o.s.slice(0, 40)}"`);
      }
    }
  });
  if (sorunlar.length) throw new Error(`${belge} beklenen düzende değil (${sorunlar.length} sorun): ${sorunlar.slice(0, 5).join("; ")}`);
  return satirlar;
}

/** Header of the two-column dictionaries: "Kodu | Nitelik Adı", "Kod | Ad" */
function kodBasligi(sayfa: Oge[]): { kodSag: number; alt: number } | null {
  const kod = sayfa.find((o) => /^kodu?$/.test(sade(o.s)));
  return kod ? { kodSag: kod.x + kod.w, alt: kod.y } : null;
}

/**
 * "Özel Koşullar" (1xxx/6xxx/7xxx -> text) and "Mezun Olunan Ön Lisans
 * Programı" (program code -> name): code -> text, wrapped lines joined.
 */
export function kodSozluguAyristir(sayfalar: Oge[][], belge: string): Record<string, string> {
  const sozluk: Record<string, string> = {};
  const sorunlar: string[] = [];
  for (const s of sozlukSatirlari(sayfalar, belge, kodBasligi)) {
    const metin = hucreMetni(s.ogeler);
    if (!metin) sorunlar.push(`${s.kod}: açıklama boş`);
    else if (sozluk[s.kod] !== undefined && sozluk[s.kod] !== metin) sorunlar.push(`${s.kod}: iki farklı açıklama`);
    if (!metniKoduylaAyniHizada(s, s.ogeler)) sorunlar.push(`${s.kod}: açıklama kodun hizasında değil`);
    sozluk[s.kod] = metin;
  }
  if (sorunlar.length) throw new Error(`${belge} beklenen düzende değil (${sorunlar.length} sorun): ${sorunlar.slice(0, 5).join("; ")}`);
  return sozluk;
}

/**
 * Header of "Ön Lisans Mezunları İçin Nitelik Kodları": "Nitelik Kodu |
 * ÖĞRENİM KOŞULU | 1 … 15". The numbered columns hold the accepted program
 * codes; `programSol` is where the first of them begins.
 */
function ogrenimBasligi(sayfa: Oge[]): { kodSag: number; alt: number; programSol: number } | null {
  const kosul = sayfa.find((o) => /^ogrenim kosulu/.test(sade(o.s)));
  if (!kosul) return null;
  const bant = sayfa.filter((o) => Math.abs(o.y - kosul.y) < 8);
  const kodlar = bant.filter((o) => o.x < kosul.x && /^(nitelik|kodu?|nitelik kodu?)$/.test(sade(o.s)));
  const sayilar = bant
    .filter((o) => o.x > kosul.x && Math.abs(o.y - kosul.y) < AYNI_SATIR && /^\d{1,2}$/.test(o.s))
    .sort((a, b) => a.x - b.x);
  if (!kodlar.length || sayilar[0]?.s !== "1") {
    throw new Error("Ön lisans nitelik kodları tablosunun başlığı beklenen düzende değil (kod sütunu ya da 1…15 sütunları yok)");
  }
  const orta = (o: Oge) => o.x + o.w / 2;
  // Program columns are equally wide and their headers centred: half a pitch left of "1" is the column edge
  const adim = sayilar[1]?.s === "2" ? orta(sayilar[1]) - orta(sayilar[0]) : 16;
  return {
    kodSag: Math.max(...kodlar.map((o) => o.x + o.w)),
    alt: Math.min(kosul.y, ...kodlar.map((o) => o.y)),
    programSol: orta(sayilar[0]) - adim / 2,
  };
}

/** Education codes: definition text plus the program codes the code accepts, in table order */
export function ogrenimAyristir(sayfalar: Oge[][]): Record<string, OgrenimKodu> {
  const belge = "Ön lisans nitelik kodları tablosu";
  let programSol = Infinity;
  const satirlar = sozlukSatirlari(sayfalar, belge, (sayfa) => {
    const b = ogrenimBasligi(sayfa);
    if (b) programSol = b.programSol;
    return b;
  });
  const sozluk: Record<string, OgrenimKodu> = {};
  const sorunlar: string[] = [];
  for (const s of satirlar) {
    const metinOgeleri = s.ogeler.filter((o) => o.x < programSol);
    const programOgeleri = s.ogeler.filter((o) => o.x >= programSol).sort((a, b) => (Math.abs(a.y - b.y) < AYNI_SATIR ? a.x - b.x : b.y - a.y));
    const metin = hucreMetni(metinOgeleri);
    const bozuk = programOgeleri.filter((o) => !/^\d{4}$/.test(o.s));
    if (!metin) sorunlar.push(`${s.kod}: öğrenim koşulu metni boş`);
    if (bozuk.length) sorunlar.push(`${s.kod}: program sütunlarında kod olmayan metin "${bozuk[0].s.slice(0, 30)}"`);
    // A program code on another row's line would hand this code a program it does not accept
    if (!metniKoduylaAyniHizada(s, metinOgeleri)) sorunlar.push(`${s.kod}: öğrenim koşulu metni kodun hizasında değil`);
    if (programOgeleri.some((o) => Math.abs(o.y - s.y) > AYNI_SATIR)) sorunlar.push(`${s.kod}: program kodları kodun satırında değil`);
    if (sozluk[s.kod]) sorunlar.push(`${s.kod}: tabloda iki kez geçiyor`);
    sozluk[s.kod] = { metin, programlar: [...new Set(programOgeleri.map((o) => o.s))] };
  }
  if (sorunlar.length) throw new Error(`${belge} beklenen düzende değil (${sorunlar.length} sorun): ${sorunlar.slice(0, 5).join("; ")}`);
  return sozluk;
}

// --- Guide text -----------------------------------------------------------------

const AYLAR = ["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"];
const AY_DESENI = AYLAR.join("|");
const KUCUK_HARF = /[a-zçğıöşü]/;

const iso = (yil: number, ay: number, gun: number) => `${yil}-${String(ay).padStart(2, "0")}-${String(gun).padStart(2, "0")}`;

/**
 * Preference window from "Adaylar tercihlerini 9-16 Temmuz 2026 tarihleri
 * arasında …" (also "29 Aralık 2026 - 5 Ocak 2027"). Nothing is returned when
 * the sentence is not found: a wrong date is worse than a missing one.
 */
export function tercihTarihleri(metin: string): { tercihBaslangic: string; tercihBitis: string } | null {
  const m = metin
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr")
    .match(
      new RegExp(
        `tercihlerini (\\d{1,2})(?: (${AY_DESENI}))?(?: (20\\d{2}))? ?[-–] ?(\\d{1,2}) (${AY_DESENI}) (20\\d{2}) tarihleri arasında`
      )
    );
  if (!m) return null;
  const bitisAy = AYLAR.indexOf(m[5]) + 1;
  const bitisYil = Number(m[6]);
  const basAy = m[2] ? AYLAR.indexOf(m[2]) + 1 : bitisAy;
  // "29 Aralık - 5 Ocak 2027": a start month after the end month belongs to the year before
  const basYil = m[3] ? Number(m[3]) : basAy > bitisAy ? bitisYil - 1 : bitisYil;
  const tercihBaslangic = iso(basYil, basAy, Number(m[1]));
  const tercihBitis = iso(bitisYil, bitisAy, Number(m[4]));
  return tercihBaslangic <= tercihBitis ? { tercihBaslangic, tercihBitis } : null;
}

/** "… ve 30'u geçmemek üzere istek sıranıza göre yazınız." -> 30 */
export function enFazlaTercihSayisi(metin: string): number | null {
  const m = metin.replace(/\s+/g, " ").match(/(\d{1,3}) ?['’‘`´]? ?[a-zçğıöşü]{0,3} geçmemek üzere/);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= 200 ? n : null;
}

/**
 * Wrapped lines back into paragraphs. A new paragraph starts at a list marker
 * ("a) ", "ç) ", "1) ", "- "), or after a line that ends a sentence without
 * reaching the right margin.
 */
function paragraflar(satirlar: string[], tamSatir: number): string {
  const sonuc: string[][] = [];
  let onceki = "";
  for (const s of satirlar) {
    const madde = /^(?:[a-zçğıöşü]{1,2}|\d{1,2})\)\s|^[-–•·]\s/.test(s);
    const kisa = onceki.length < tamSatir * 0.88;
    const bitti = /[.:;!?][)"”’']?$/.test(onceki);
    if (!sonuc.length || madde || (kisa && bitti) || onceki.length < tamSatir * 0.6) sonuc.push([s]);
    else sonuc[sonuc.length - 1].push(s);
    onceki = s;
  }
  return sonuc.map(satirlariBirlestir).join("\n");
}

export interface KilavuzBilgisi {
  donem?: string;
  tercihBaslangic?: string;
  tercihBitis?: string;
  enFazlaTercih?: number;
  aciklamalar: TercihVerisi["aciklamalar"];
}

/**
 * Reads the guide ("Genel Bilgiler"): round name, preference window, maximum
 * number of preferences, and the "BAŞVURMA ÖZEL ŞARTLARI" sections. Each
 * section ("2.4. DESTEK PERSONELİ (7348)") is stored under every code its
 * heading names; headings may wrap and may name two codes.
 */
export function kilavuzAyristir(sayfaMetinleri: string[]): KilavuzBilgisi {
  const satirlar: string[] = [];
  for (const sayfa of sayfaMetinleri) {
    const s = sayfa.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    // The page number is a line of its own at the top or the bottom of the page
    if (s.length && /^\d{1,3}$/.test(s[0])) s.shift();
    if (s.length && /^\d{1,3}$/.test(s[s.length - 1])) s.pop();
    satirlar.push(...s);
  }
  const tumMetin = satirlar.join("\n");
  const tarih = tercihTarihleri(tumMetin);
  const bilgi: KilavuzBilgisi = {
    donem: donemBul(tumMetin),
    tercihBaslangic: tarih?.tercihBaslangic,
    tercihBitis: tarih?.tercihBitis,
    enFazlaTercih: enFazlaTercihSayisi(tumMetin) ?? undefined,
    aciklamalar: {},
  };

  // Last occurrence, so a table of contents listing the same title is skipped
  let bas = -1;
  let no = 0;
  satirlar.forEach((s, i) => {
    const m = s.match(/^(\d{1,2})\.\s*BAŞVURMA ÖZEL ŞARTLARI\b/);
    if (m && !KUCUK_HARF.test(s)) {
      bas = i;
      no = Number(m[1]);
    }
  });
  if (bas < 0) return bilgi;
  const sonrakiBolum = new RegExp(`^${no + 1}\\.\\s+\\p{Lu}`, "u");
  let son = satirlar.findIndex((s, i) => i > bas && sonrakiBolum.test(s) && !KUCUK_HARF.test(s));
  if (son < 0) son = satirlar.length;

  const sirali = [...satirlar].map((s) => s.length).sort((a, b) => a - b);
  const tamSatir = sirali[Math.floor(sirali.length * 0.9)] ?? 100;
  const altBaslik = new RegExp(`^${no}\\.\\d{1,2}\\.?\\s+\\S`);
  const baslikMi = (s: string) => altBaslik.test(s) && !KUCUK_HARF.test(s);

  let i = bas + 1;
  while (i < son && !baslikMi(satirlar[i])) i++;
  while (i < son) {
    const baslikSatirlari = [satirlar[i++]];
    // A heading runs on while it has not named a code yet or ends mid-phrase; body text is never all capitals
    while (
      i < son &&
      baslikSatirlari.length < 4 &&
      !baslikMi(satirlar[i]) &&
      !KUCUK_HARF.test(satirlar[i]) &&
      (!/\(\s*\d{4}/.test(baslikSatirlari.join(" ")) || /[-–,]$/.test(baslikSatirlari[baslikSatirlari.length - 1]))
    ) {
      baslikSatirlari.push(satirlar[i++]);
    }
    const govde: string[] = [];
    while (i < son && !baslikMi(satirlar[i])) govde.push(satirlar[i++]);
    const baslik = satirlariBirlestir(baslikSatirlari);
    const kodlar = [...baslik.matchAll(/\(([^()]*)\)/g)].flatMap((p) => p[1].match(/(?<!\d)\d{4}(?!\d)/g) ?? []);
    const metin = paragraflar(govde, tamSatir);
    for (const kod of kodlar) bilgi.aciklamalar[kod] = { baslik, metin };
  }
  return bilgi;
}

// --- Announcement page ------------------------------------------------------------

export type BelgeTuru = "kilavuz" | "tablo2" | "ozel" | "ogrenim" | "program";

/** Link texts as they appear on the round's page, folded (file names change every round, the texts do not) */
const BELGE_ESLESME: Record<BelgeTuru, (ad: string) => boolean> = {
  kilavuz: (ad) => /\bgenel bilgiler\b/.test(ad),
  tablo2: (ad) => /\btablo 2\b/.test(ad) && /\bon ?lisans\b/.test(ad),
  ozel: (ad) => /\bozel kosullar\b/.test(ad),
  ogrenim: (ad) => /\bon ?lisans\b/.test(ad) && /nitelik kod/.test(ad),
  program: (ad) => /mezun olunan/.test(ad) && /\bon ?lisans\b/.test(ad),
};

export const BELGE_ADLARI: Record<BelgeTuru, string> = {
  kilavuz: "Genel Bilgiler",
  tablo2: "TABLO-2 (ön lisans kadroları)",
  ozel: "Özel Koşullar",
  ogrenim: "Ön Lisans Mezunları İçin Nitelik Kodları",
  program: "Mezun Olunan Ön Lisans Programı",
};

const VARLIKLAR: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-",
  ccedil: "ç", Ccedil: "Ç", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü", scedil: "ş", Scedil: "Ş",
  inodot: "ı", gbreve: "ğ", Gbreve: "Ğ", Idot: "İ", acirc: "â", Acirc: "Â", icirc: "î", Icirc: "Î", ucirc: "û", Ucirc: "Û",
};

function htmlMetni(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, ad) => VARLIKLAR[ad] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export interface SayfaBaglantilari {
  donem?: string;
  belgeler: Partial<Record<BelgeTuru, { ad: string; url: string }>>;
}

/**
 * The five documents of a round, found on its announcement page by link text.
 * An <a> that opens before the previous one closed ends it, as in a browser:
 * the 2026/1 page carries a stale, empty link to a 2015 guide right before the
 * list, and a lazy "<a …>…</a>" match would hand its address to the next text.
 */
export function sayfaBaglantilari(html: string, sayfaUrl: string): SayfaBaglantilari {
  const baslik = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  // Menus and footers link other documents; the announcement body is enough when it can be found
  const bas = html.indexOf('class="row content"');
  const govde = bas >= 0 ? html.slice(bas) : html;
  const sonuc: SayfaBaglantilari = { donem: donemBul(htmlMetni(baslik)) ?? donemBul(htmlMetni(govde)), belgeler: {} };

  const etiket = /<a\b([^>]*)>|<\/a\s*>/gi;
  let acik: { href: string; bas: number } | null = null;
  const kapat = (son: number) => {
    if (!acik) return;
    const ad = htmlMetni(govde.slice(acik.bas, son));
    const sadeAd = sade(ad);
    let url: URL | null = null;
    try {
      url = new URL(acik.href, sayfaUrl || "https://www.osym.gov.tr/");
    } catch {
      // not a usable address
    }
    acik = null;
    if (!ad || !url || !/\.pdf$/i.test(url.pathname)) return;
    for (const tur of Object.keys(BELGE_ESLESME) as BelgeTuru[]) {
      // First match wins: the list is in page order and each text appears once
      if (!sonuc.belgeler[tur] && BELGE_ESLESME[tur](sadeAd)) sonuc.belgeler[tur] = { ad, url: url.href };
    }
  };
  for (let m = etiket.exec(govde); m; m = etiket.exec(govde)) {
    kapat(m.index);
    if (m[1] === undefined) continue;
    const href = m[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const adres = (href?.[1] ?? href?.[2] ?? "").replace(/&amp;/g, "&").trim();
    if (adres) acik = { href: adres, bas: m.index + m[0].length };
  }
  return sonuc;
}
