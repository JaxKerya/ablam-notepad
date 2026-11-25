// KPSS preference guide loader: finds a placement round's documents on its ÖSYM
// announcement page, downloads and parses them (worker/kpss/ayristir.ts),
// checks the result and stores it in kpss_tercih (db/kpss-tercih.sql) for the
// "Tercih Rehberi" page.
//
//   npm run kpss:tercih -- <announcement page url>            load into the database
//   npm run kpss:tercih -- <url> --dosya <out.json>           write the parsed data to a file instead
//   npm run kpss:tercih -- [<url>] --yerel <dir> [--dosya …]  read sayfa.html and the PDFs from a directory
//   npm run kpss:tercih -- … --dosya <out.json> --onceki <older round.json>
//                                                             file mode has no stored rounds: take `emsal` from this file
//   npm run kpss:tercih -- --puanlar <pdf url or path> --donem 2026/1 [--dosya <round.json>]
//                                                             after the round closes: merge its "en küçük ve en büyük
//                                                             puanlar" list into the stored round (or into the JSON file)
//
// The scanner (worker/ana.ts) calls kpssDuyurulariniIsle after every ÖSYM scan,
// so a new round is loaded the moment its guide is announced.
//
// Six requests per load (the page and five PDFs, about 2.2 MB in 2026/1),
// sequential with pauses; a document that is refused is asked for once more
// with other request headers. Nothing is written unless every check passes: a
// half-read table would tell the user she may list posts she cannot.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HamIlan } from "../../lib/kariyer";
import { durumDogrula, tabanOku, type TercihDurumu, type TercihKadro, type TercihVerisi } from "../../lib/kpss-tercih";
import { createServerSupabaseClient } from "../../lib/supabase-server";
import { bekle, getir, nazikBekle } from "../kaynaklar/http";
import {
  BELGE_ADLARI,
  kilavuzAyristir,
  kodSozluguAyristir,
  ogrenimAyristir,
  pdfOgeleri,
  pdfSayfaMetinleri,
  puanlariKarsilastir,
  puanTablosuAyristir,
  sade,
  sayfaBaglantilari,
  tablo2Ayristir,
  type BelgeTuru,
  type PuanSatiri,
} from "./ayristir";

type Log = (m: string) => void;

const BELGE_SIRASI: BelgeTuru[] = ["kilavuz", "tablo2", "ozel", "ogrenim", "program"];
/** Used when the guide's sentence about the limit cannot be read (30 in every round seen) */
const VARSAYILAN_EN_FAZLA_TERCIH = 30;
const EN_BUYUK_PDF = 25 * 1024 * 1024;
/** A table shorter than this is a parse failure, not a small round (2026/1 has 410 rows) */
const EN_AZ_KADRO = 50;
/** Qualification codes missing from both dictionaries: a few are stored (the page then shows those posts as "verify"), more means a broken parse */
const COZULMEYEN_SINIRI = 5;

// --- Fetching ---------------------------------------------------------------

/** Only ÖSYM's own hosts are read: the data is shown to the user as the official table */
function osymAdresi(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`geçersiz adres: ${url.slice(0, 120)}`);
  }
  if (u.protocol !== "https:" || !/(^|\.)osym\.gov\.tr$/i.test(u.hostname)) {
    throw new Error(`ÖSYM adresi değil: ${url.slice(0, 120)}`);
  }
  return u.href;
}

/**
 * The document host (dokuman.osym.gov.tr) answers getir's browser-like
 * User-Agent with a block page ("Erişim Engellendi", sent with HTTP 200) and
 * serves clients that say what they are (curl, node) normally; measured
 * 25.11.2026. The announcement page on www.osym.gov.tr is fine with getir's
 * defaults, as the ÖSYM scanner shows. So the PDFs are requested without posing
 * as a browser first. That rule was measured from one address on one day, so
 * when the answer is not a PDF the other identity gets one try as well.
 */
const BELGE_BASLIKLARI: Record<string, string>[] = [{ "user-agent": "node" }, {}];

const pdfMi = (bayt: Uint8Array) => Buffer.from(bayt.subarray(0, 5)).toString("latin1") === "%PDF-";

/** What the server sent instead of a PDF: its block page comes with HTTP 200 and says so in the title */
const sayfaBasligi = (bayt: Uint8Array) => new TextDecoder().decode(bayt.subarray(0, 2048)).match(/<title[^>]*>([^<]*)/i)?.[1]?.trim();

/** One retry: a single timeout should not cost the round */
async function indir(url: string, basliklar: Record<string, string> = {}): Promise<{ bayt: Uint8Array; icerikTuru: string | null }> {
  for (let deneme = 1; ; deneme++) {
    try {
      const cevap = await getir(url, { headers: basliklar }, 60_000);
      return { bayt: new Uint8Array(await cevap.arrayBuffer()), icerikTuru: cevap.headers.get("content-type") };
    } catch (e) {
      if (deneme >= 2) throw e;
      await bekle(5000);
    }
  }
}

/** One document from ÖSYM's document host; throws when neither identity is served a PDF */
async function pdfIndir(url: string, ad: string): Promise<Uint8Array> {
  const sebepler: string[] = [];
  for (const basliklar of BELGE_BASLIKLARI) {
    await nazikBekle();
    try {
      const { bayt } = await indir(url, basliklar);
      if (pdfMi(bayt)) return bayt;
      const baslik = sayfaBasligi(bayt);
      sebepler.push(`PDF değil${baslik ? ` (sunucunun cevabı: "${baslik.slice(0, 80)}")` : ""}`);
    } catch (e) {
      sebepler.push((e as Error).message);
    }
  }
  throw new Error(`${ad} indirilemedi — ${[...new Set(sebepler)].join("; ")}: ${url.slice(0, 120)}`);
}

/** The page states its encoding in the response header or a <meta>; UTF-8 is only the last resort */
function htmlCoz(bayt: Uint8Array, icerikTuru: string | null): string {
  const bas = Buffer.from(bayt.subarray(0, 8192)).toString("latin1");
  const adaylar = [
    icerikTuru?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1],
    bas.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1],
    "utf-8",
  ];
  for (const ad of adaylar) {
    if (!ad) continue;
    try {
      return new TextDecoder(ad).decode(bayt);
    } catch {
      // unknown label: try the next one
    }
  }
  return new TextDecoder().decode(bayt);
}

/** Development copies: the file name from the link, "<type>.pdf", or the name ÖSYM uses for that document */
function yerelPdf(dizin: string, url: string, tur: BelgeTuru): Uint8Array {
  const onEk: Record<BelgeTuru, string> = { kilavuz: "kilavuz", tablo2: "tablo2", ozel: "ozelkosullar", ogrenim: "onlisans-nitelik", program: "molunan" };
  const dosyalar = readdirSync(dizin).filter((d) => d.toLowerCase().endsWith(".pdf"));
  const adaylar = [basename(new URL(url).pathname), `${tur}.pdf`].map((a) => a.toLowerCase());
  const bulunan =
    dosyalar.find((d) => adaylar.includes(d.toLowerCase())) ?? dosyalar.find((d) => d.toLowerCase().startsWith(onEk[tur]));
  if (!bulunan) throw new Error(`${dizin} içinde ${BELGE_ADLARI[tur]} dosyası yok (${adaylar[0]})`);
  return new Uint8Array(readFileSync(join(dizin, bulunan)));
}

// --- Assembling ---------------------------------------------------------------

export interface ToplamaSecenekleri {
  /** Read sayfa.html and the PDFs from this directory instead of the network */
  yerelDizin?: string;
}

/** Downloads and parses one round. Throws when a document is missing or not in the expected layout. */
export async function tercihVerisiTopla(sayfaUrl: string, log: Log, secenekler: ToplamaSecenekleri = {}): Promise<TercihVerisi> {
  const { yerelDizin } = secenekler;
  let html: string;
  if (yerelDizin) {
    html = htmlCoz(new Uint8Array(readFileSync(join(yerelDizin, "sayfa.html"))), null);
  } else {
    const sayfa = await indir(osymAdresi(sayfaUrl));
    html = htmlCoz(sayfa.bayt, sayfa.icerikTuru);
  }

  const baglantilar = sayfaBaglantilari(html, sayfaUrl);
  const eksik = BELGE_SIRASI.filter((t) => !baglantilar.belgeler[t]);
  if (eksik.length) {
    throw new Error(`duyuru sayfasında belge bağlantısı bulunamadı: ${eksik.map((t) => BELGE_ADLARI[t]).join(", ")}`);
  }

  const pdf = {} as Record<BelgeTuru, Uint8Array>;
  for (const tur of BELGE_SIRASI) {
    const url = baglantilar.belgeler[tur]!.url;
    const bayt = yerelDizin ? yerelPdf(yerelDizin, url, tur) : await pdfIndir(osymAdresi(url), BELGE_ADLARI[tur]);
    if (bayt.byteLength > EN_BUYUK_PDF) throw new Error(`${BELGE_ADLARI[tur]} beklenmedik büyüklükte (${Math.round(bayt.byteLength / 1048576)} MB)`);
    if (!pdfMi(bayt)) throw new Error(`${BELGE_ADLARI[tur]} PDF değil: ${url.slice(0, 120)}`);
    log(`KPSS tercih: ${BELGE_ADLARI[tur]} okundu (${Math.round(bayt.byteLength / 1024)} KB)`);
    pdf[tur] = bayt;
  }

  const tablo = tablo2Ayristir(await pdfOgeleri(pdf.tablo2));
  const ogrenim = ogrenimAyristir(await pdfOgeleri(pdf.ogrenim));
  const ozel = kodSozluguAyristir(await pdfOgeleri(pdf.ozel), BELGE_ADLARI.ozel);
  const programlar = kodSozluguAyristir(await pdfOgeleri(pdf.program), BELGE_ADLARI.program);
  const kilavuz = kilavuzAyristir(await pdfSayfaMetinleri(pdf.kilavuz));

  // The page, the guide and the table each name the round; a link left over from another round must not slip in
  const donemler = { sayfa: baglantilar.donem, kılavuz: kilavuz.donem, "Tablo-2": tablo.donem };
  const farkli = [...new Set(Object.values(donemler).filter(Boolean))];
  if (farkli.length !== 1) {
    throw new Error(
      farkli.length
        ? `belgeler farklı yerleştirme dönemlerine ait: ${Object.entries(donemler).map(([k, v]) => `${k} ${v ?? "?"}`).join(", ")}`
        : "yerleştirme dönemi (KPSS-yıl/sıra) sayfadan da belgelerden de okunamadı"
    );
  }

  if (!kilavuz.tercihBaslangic) log("KPSS tercih: UYARI — tercih tarihleri kılavuzdan okunamadı, boş bırakıldı");
  if (!kilavuz.enFazlaTercih) log(`KPSS tercih: UYARI — en fazla tercih sayısı kılavuzdan okunamadı, ${VARSAYILAN_EN_FAZLA_TERCIH} varsayıldı`);

  return {
    donem: farkli[0]!,
    tercihBaslangic: kilavuz.tercihBaslangic,
    tercihBitis: kilavuz.tercihBitis,
    enFazlaTercih: kilavuz.enFazlaTercih ?? VARSAYILAN_EN_FAZLA_TERCIH,
    kadrolar: tablo.kadrolar,
    ogrenim,
    ozel,
    programlar,
    aciklamalar: kilavuz.aciklamalar,
    belgeler: BELGE_SIRASI.map((t) => baglantilar.belgeler[t]!),
  };
}

// --- Validation -----------------------------------------------------------------

/** Same test as lib/kpss-tercih.ts uses for "any program" */
const herhangiProgramMi = (metin: string) => /^herhangi bir ön ?lisans programından mezun olmak/.test(metin.toLocaleLowerCase("tr-TR").trim());

/**
 * Refuses data that would mislead the page. Throws with the first problems;
 * tolerated oddities (a few codes missing from the dictionaries, on rows that
 * still have a known education code) are logged loudly instead.
 */
export function tercihVerisiDogrula(veri: TercihVerisi, log: Log): void {
  const hatalar: string[] = [];
  if (!/^20\d{2}\/\d{1,2}$/.test(veri.donem)) hatalar.push(`dönem adı beklenen biçimde değil: "${veri.donem}"`);
  if (veri.kadrolar.length < EN_AZ_KADRO) hatalar.push(`Tablo-2'den yalnızca ${veri.kadrolar.length} satır okundu (en az ${EN_AZ_KADRO} bekleniyor)`);

  const kodlar = new Set<string>();
  const bozuk: string[] = [];
  for (const k of veri.kadrolar) {
    const sorun = !/^\d{9}$/.test(k.kod)
      ? "ÖSYM kodu 9 hane değil"
      : kodlar.has(k.kod)
        ? "ÖSYM kodu yineleniyor"
        : !k.kurum
          ? "kurum boş"
          : !k.unvan
            ? "unvan boş"
            : !k.il
              ? "il boş"
              : !(Number.isInteger(k.adet) && k.adet >= 1)
                ? "adet 1'den küçük"
                : !k.nitelikler.length
                  ? "nitelik kodu yok"
                  : k.nitelikler.some((n) => !/^\d{4}$/.test(n))
                    ? "nitelik kodu 4 hane değil"
                    : null;
    kodlar.add(k.kod);
    if (sorun) bozuk.push(`${k.kod || "?"} (${sorun})`);
  }
  if (bozuk.length) hatalar.push(`${bozuk.length} satır eksik ya da bozuk: ${bozuk.slice(0, 5).join(", ")}`);

  if (Object.keys(veri.ogrenim).length < 20) hatalar.push(`yalnızca ${Object.keys(veri.ogrenim).length} öğrenim kodu okundu`);
  if (Object.keys(veri.ozel).length < 20) hatalar.push(`yalnızca ${Object.keys(veri.ozel).length} özel koşul kodu okundu`);
  if (Object.keys(veri.programlar).length < 100) hatalar.push(`yalnızca ${Object.keys(veri.programlar).length} program okundu`);
  if (!Object.values(veri.ogrenim).some((o) => !o.programlar.length && herhangiProgramMi(o.metin))) {
    hatalar.push('"Herhangi bir önlisans programından mezun olmak" kodu öğrenim kodları arasında yok');
  }
  const cakisan = Object.keys(veri.ogrenim).filter((k) => veri.ozel[k] !== undefined);
  if (cakisan.length) hatalar.push(`aynı kod hem öğrenim hem özel koşul sözlüğünde: ${cakisan.slice(0, 5).join(", ")}`);

  const kullanilan = new Set(veri.kadrolar.flatMap((k) => k.nitelikler));
  const cozulmeyen = [...kullanilan].filter((n) => !veri.ogrenim[n] && veri.ozel[n] === undefined).sort();
  if (cozulmeyen.length > COZULMEYEN_SINIRI) {
    hatalar.push(`${cozulmeyen.length} nitelik kodunun açıklaması hiçbir sözlükte yok: ${cozulmeyen.slice(0, 10).join(", ")}`);
  }
  // Every Tablo-2 post names the program(s) it accepts. Without a known education code
  // kadroSonucu has no education check to make, so such a row must never reach the page.
  const ogrenimsiz = veri.kadrolar.filter((k) => !k.nitelikler.some((n) => veri.ogrenim[n]));
  if (ogrenimsiz.length) {
    hatalar.push(`${ogrenimsiz.length} kadroda tanınan öğrenim kodu yok: ${ogrenimsiz.slice(0, 5).map((k) => `${k.kod} [${k.nitelikler.join(" ")}]`).join(", ")}`);
  }

  if (hatalar.length) throw new Error(`KPSS tercih verisi doğrulanamadı — ${hatalar.join("; ")}`);

  // Stored, but the operator should know: the page can only show these as "verify"
  if (cozulmeyen.length) {
    const satir = veri.kadrolar.filter((k) => k.nitelikler.some((n) => cozulmeyen.includes(n))).length;
    log(`KPSS tercih: !!! UYARI — ${cozulmeyen.length} nitelik kodu sözlüklerde YOK (${cozulmeyen.join(", ")}); ${satir} kadro bu yüzden kesinleşemeyecek`);
  }
  const programsiz = [...kullanilan].filter((n) => veri.ogrenim[n] && !veri.ogrenim[n].programlar.length && !herhangiProgramMi(veri.ogrenim[n].metin));
  if (programsiz.length) log(`KPSS tercih: !!! UYARI — program listesi okunamayan öğrenim kodları: ${programsiz.join(", ")}`);
  const adsiz = [...new Set(Object.values(veri.ogrenim).flatMap((o) => o.programlar))].filter((p) => veri.programlar[p] === undefined);
  if (adsiz.length) log(`KPSS tercih: UYARI — program listesinde adı olmayan ${adsiz.length} program kodu: ${adsiz.slice(0, 10).join(", ")}`);
  const bakiniz = [...kullanilan].filter((n) => /bakınız/i.test(veri.ozel[n] ?? "") && !veri.aciklamalar[n]);
  if (bakiniz.length) log(`KPSS tercih: not — kılavuzda kendi bölümü bulunamayan "Bakınız" kodları: ${bakiniz.join(", ")}`);
}

const ozet = (veri: TercihVerisi) =>
  `KPSS-${veri.donem}: ${veri.kadrolar.length} kadro (${veri.kadrolar.reduce((t, k) => t + k.adet, 0)} kontenjan), ` +
  `${Object.keys(veri.ogrenim).length} öğrenim kodu, ${Object.keys(veri.ozel).length} özel koşul, ` +
  `${Object.keys(veri.programlar).length} program, ${Object.keys(veri.aciklamalar).length} açıklama; ` +
  `tercih ${veri.tercihBaslangic ?? "?"} – ${veri.tercihBitis ?? "?"}, en fazla ${veri.enFazlaTercih}`;

// --- Storing --------------------------------------------------------------------

type EskiSozlukler = Partial<Pick<TercihVerisi, "ozel" | "aciklamalar" | "programlar">>;

/**
 * What the user told the page in the previous round, carried into a new one:
 * program, gender and answers; the preference list starts empty. An answer is
 * kept only while it still answers the same question: the code's text and, for
 * a "Bakınız" code, its guide section must read the same in both rounds (the
 * age limits in those sections move with every round). The same goes for the
 * program code's name. The score is carried as it is: it stays hers until she
 * sits the exam again, and the page only ever shows it as a comparison.
 */
export function durumuDevret(eski: TercihDurumu, eskiVeri: EskiSozlukler, yeni: TercihVerisi): { durum: TercihDurumu; dusen: string[] } {
  const ayni = (a: string | undefined, b: string | undefined) => sade(a ?? "") === sade(b ?? "");
  const dusen: string[] = [];
  const durum: TercihDurumu = { cinsiyet: eski.cinsiyet, cevaplar: {}, secilenler: [] };
  if (eski.puan !== undefined) durum.puan = eski.puan;
  if (eski.program) {
    const ad = yeni.programlar[eski.program];
    if (ad !== undefined && ayni(ad, eskiVeri.programlar?.[eski.program])) durum.program = eski.program;
    else dusen.push(`program ${eski.program}`);
  }
  for (const [kod, cevap] of Object.entries(eski.cevaplar)) {
    const metin = yeni.ozel[kod];
    if (metin !== undefined && ayni(metin, eskiVeri.ozel?.[kod]) && ayni(yeni.aciklamalar[kod]?.metin, eskiVeri.aciklamalar?.[kod]?.metin)) {
      durum.cevaplar[kod] = cevap;
    } else {
      dusen.push(kod);
    }
  }
  return { durum, dusen };
}

/** "2026/2" -> 202602: rounds in the order they were held; anything else sorts first */
function donemSirasi(donem: string): number {
  const m = /^(\d{4})\/(\d{1,2})$/.exec(donem);
  return m ? Number(m[1]) * 100 + Number(m[2]) : -1;
}

// --- Placement scores -------------------------------------------------------------

const PUAN_BELGESI_ADI = "En küçük ve en büyük puanlar";
/** Below this share of the list's codes found in the round, the list belongs to some other table */
const EN_AZ_ESLESME = 0.9;

/** The published list as a PDF: an ÖSYM address (same rules as the round's documents) or a local file */
async function puanBelgesiOku(kaynak: string): Promise<Uint8Array> {
  const bayt = /^[a-z][a-z0-9+.-]*:\/\//i.test(kaynak) ? await pdfIndir(osymAdresi(kaynak), PUAN_BELGESI_ADI) : new Uint8Array(readFileSync(kaynak));
  if (bayt.byteLength > EN_BUYUK_PDF) throw new Error(`${PUAN_BELGESI_ADI} beklenmedik büyüklükte (${Math.round(bayt.byteLength / 1048576)} MB)`);
  if (!pdfMi(bayt)) throw new Error(`${PUAN_BELGESI_ADI} PDF değil: ${kaynak.slice(0, 120)}`);
  return bayt;
}

export interface PuanTablosu {
  donem?: string;
  satirlar: Record<string, PuanSatiri>;
}

/**
 * Writes a round's own results onto its posts (`taban`), replacing any written
 * before. Refuses a list that names another round or whose codes are mostly
 * not this round's. Returns how many posts got a result.
 */
export function tabanlariYaz(veri: TercihVerisi, tablo: PuanTablosu, log: Log): number {
  if (tablo.donem !== veri.donem) {
    throw new Error(`puan tablosu ${tablo.donem ? `KPSS-${tablo.donem} dönemine ait` : "hangi döneme ait olduğunu söylemiyor"}, beklenen KPSS-${veri.donem}`);
  }
  const k = puanlariKarsilastir(veri.kadrolar, tablo.satirlar);
  const toplam = Object.keys(tablo.satirlar).length;
  if (k.eslesen.length < toplam * EN_AZ_ESLESME) {
    throw new Error(`puan tablosundaki ${toplam} koddan yalnızca ${k.eslesen.length} tanesi KPSS-${veri.donem} kadrolarında var; bu dönemin tablosu olamaz`);
  }
  for (const kadro of veri.kadrolar) {
    const s = tablo.satirlar[kadro.kod];
    if (s) kadro.taban = { yerlesen: s.yerlesen, bos: s.bos, enKucuk: s.enKucuk, enBuyuk: s.enBuyuk };
    else delete kadro.taban;
  }
  log(`KPSS puanlar: KPSS-${veri.donem} tablosunda ${toplam} satır; ${veri.kadrolar.length} kadronun ${k.eslesen.length} tanesinin sonucu var`);
  if (k.yabanci.length) log(`KPSS puanlar: !!! UYARI — tablodaki ${k.yabanci.length} kod bu dönemin kadrolarında YOK, atlandı: ${k.yabanci.slice(0, 10).join(", ")}`);
  if (k.sonucsuz.length) log(`KPSS puanlar: UYARI — ${k.sonucsuz.length} kadronun sonucu tabloda yok: ${k.sonucsuz.slice(0, 10).join(", ")}`);
  if (k.farkli.length) log(`KPSS puanlar: UYARI — ${k.farkli.length} kadronun kontenjanı ya da unvanı iki belgede farklı: ${k.farkli.slice(0, 10).join(", ")}`);
  return k.eslesen.length;
}

/** A round whose results can serve as the reference for a later one */
export interface EmsalKaynagi {
  donem: string;
  kadrolar: TercihKadro[];
}

const tabanliMi = (kadrolar: TercihKadro[]) => kadrolar.some((k) => typeof k.taban?.enKucuk === "number");

/**
 * Recomputes `emsal` on every post of `veri` from an earlier round's results:
 * the lowest minimum among that round's posts with the same institution and
 * title. The candidates are narrowed first to those with the same qualification
 * codes when there are any, then to the same province when there are any; each
 * narrowing is recorded (`ayniSart`, `ayniIl`). Requirements come before the
 * province because they move the minimum far more: in KPSS-2026/1 the two
 * "Destek Personeli" posts of one institution in Ankara closed at 87,88 (any
 * program) and 77,32 (one program group), while the any-program ones lay
 * within 0,6 points of each other across six provinces. Names are compared folded
 * (case, diacritics, punctuation), nothing looser; a post without a twin gets
 * no `emsal`. Returns how many got one.
 */
export function emsalleriYaz(veri: TercihVerisi, kaynak: EmsalKaynagi | null): number {
  const anahtar = (k: TercihKadro) => `${sade(k.kurum)}|${sade(k.unvan)}`;
  const sartlar = (k: TercihKadro) => [...k.nitelikler].sort().join(" ");
  const benzerler = new Map<string, { il: string; sart: string; enKucuk: number }[]>();
  for (const k of kaynak?.kadrolar ?? []) {
    const enKucuk = tabanOku(k.taban)?.enKucuk;
    if (typeof enKucuk !== "number" || !Array.isArray(k.nitelikler)) continue;
    const benzer = { il: sade(k.il), sart: sartlar(k), enKucuk };
    const liste = benzerler.get(anahtar(k));
    if (liste) liste.push(benzer);
    else benzerler.set(anahtar(k), [benzer]);
  }
  let yazilan = 0;
  for (const kadro of veri.kadrolar) {
    delete kadro.emsal;
    const hepsi = benzerler.get(anahtar(kadro));
    if (!kaynak || !hepsi) continue;
    const ayniSart = hepsi.filter((b) => b.sart === sartlar(kadro));
    const havuz = ayniSart.length ? ayniSart : hepsi;
    const ayniIl = havuz.filter((b) => b.il === sade(kadro.il));
    const secilen = ayniIl.length ? ayniIl : havuz;
    kadro.emsal = {
      donem: kaynak.donem,
      enKucuk: Math.min(...secilen.map((b) => b.enKucuk)),
      kadro: secilen.length,
      ayniSart: ayniSart.length > 0,
      ayniIl: ayniIl.length > 0,
    };
    yazilan++;
  }
  return yazilan;
}

/** `kadrolar` of a stored round; empty when the row or the array is not there */
async function kadrolariOku(db: SupabaseClient, donem: string): Promise<TercihKadro[]> {
  const { data, error } = await db.from("kpss_tercih").select("kadrolar:veri->kadrolar").eq("donem", donem).maybeSingle();
  if (error) throw new Error(`kpss_tercih okunamadı: ${error.message}`);
  const kadrolar = (data as { kadrolar?: unknown } | null)?.kadrolar;
  return Array.isArray(kadrolar) ? (kadrolar as TercihKadro[]) : [];
}

/**
 * The reference round for `donem`: the newest stored round before it (by name,
 * not by load time) whose posts carry results. A later round is never used:
 * the page calls the reference "geçen dönem".
 */
async function emsalKaynagiBul(db: SupabaseClient, kayitli: string[], donem: string): Promise<EmsalKaynagi | null> {
  const oncekiler = kayitli.filter((d) => donemSirasi(d) >= 0 && donemSirasi(d) < donemSirasi(donem)).sort((a, b) => donemSirasi(b) - donemSirasi(a));
  for (const d of oncekiler) {
    const kadrolar = await kadrolariOku(db, d);
    if (tabanliMi(kadrolar)) return { donem: d, kadrolar };
  }
  return null;
}

const emsalOzeti = (veri: TercihVerisi, kaynak: EmsalKaynagi | null, yazilan: number) =>
  kaynak
    ? `KPSS tercih: KPSS-${veri.donem} — ${veri.kadrolar.length} kadronun ${yazilan} tanesine KPSS-${kaynak.donem} sonuçlarından emsal puan yazıldı`
    : `KPSS tercih: KPSS-${veri.donem} — sonuçları yüklü daha eski bir dönem yok, emsal puan yazılmadı`;

export interface YuklemeSonucu {
  donem: string;
  kadro: number;
  /** false when the round was already stored and only its data was refreshed */
  yeni: boolean;
}

/**
 * Loads the round announced at `sayfaUrl` into kpss_tercih. A new round starts
 * with the previous round's state (see durumuDevret); reloading a stored round
 * replaces its data and leaves the user's state alone. Either way the posts get
 * their `emsal` from the newest earlier round with results, and a reload keeps
 * the results (`taban`) merged into the round by kpssPuanlariYukle.
 */
export async function kpssTercihYukle(db: SupabaseClient, sayfaUrl: string, log: Log, secenekler: ToplamaSecenekleri = {}): Promise<YuklemeSonucu> {
  // Before anything is downloaded: with the table missing (db/kpss-tercih.sql not run
  // yet) every scan would otherwise fetch all six documents just to fail at the end
  const donemler = await db.from("kpss_tercih").select("donem");
  if (donemler.error) throw new Error(`kpss_tercih okunamadı: ${donemler.error.message}`);
  const kayitli = ((donemler.data ?? []) as { donem: string }[]).map((r) => String(r.donem));

  const veri = await tercihVerisiTopla(sayfaUrl, log, secenekler);
  tercihVerisiDogrula(veri, log);
  log(`KPSS tercih: ${ozet(veri)}`);

  if (kayitli.includes(veri.donem)) {
    // The documents just read know nothing about the results merged in later
    const eski = new Map((await kadrolariOku(db, veri.donem)).map((k) => [k.kod, tabanOku(k.taban)]));
    for (const kadro of veri.kadrolar) {
      const taban = eski.get(kadro.kod);
      if (taban) kadro.taban = taban;
    }
  }
  const kaynak = await emsalKaynagiBul(db, kayitli, veri.donem);
  log(emsalOzeti(veri, kaynak, emsalleriYaz(veri, kaynak)));

  const yuklendi = new Date().toISOString();
  if (kayitli.includes(veri.donem)) {
    // A reload from local copies has no address; the stored one stays
    const alanlar = sayfaUrl ? { veri, kaynak_url: sayfaUrl, yuklendi } : { veri, yuklendi };
    const { error } = await db.from("kpss_tercih").update(alanlar).eq("donem", veri.donem);
    if (error) throw new Error(`kpss_tercih güncellenemedi: ${error.message}`);
    return { donem: veri.donem, kadro: veri.kadrolar.length, yeni: false };
  }

  // The newest stored round by name, not by load time: reloading 2026/1 after 2026/2
  // refreshes its `yuklendi`, and 2026/3 must still start from what was said in 2026/2
  const sonDonem = [...kayitli].sort((a, b) => donemSirasi(b) - donemSirasi(a))[0];
  const onceki = sonDonem
    ? await db
        .from("kpss_tercih")
        .select("donem, durum, ozel:veri->ozel, aciklamalar:veri->aciklamalar, programlar:veri->programlar")
        .eq("donem", sonDonem)
        .maybeSingle()
    : { data: null, error: null };
  if (onceki.error) throw new Error(`kpss_tercih okunamadı: ${onceki.error.message}`);
  let durum: TercihDurumu = { cevaplar: {}, secilenler: [] };
  if (onceki.data) {
    const satir = onceki.data as unknown as { donem: string; durum: unknown } & EskiSozlukler;
    const devir = durumuDevret(durumDogrula(satir.durum), satir, veri);
    durum = devir.durum;
    log(
      `KPSS tercih: ${satir.donem} dönemindeki bilgiler devralındı (program ${durum.program ?? "yok"}, ${Object.keys(durum.cevaplar).length} cevap)` +
        (devir.dusen.length ? `; metni değiştiği için yeniden sorulacak: ${devir.dusen.join(", ")}` : "")
    );
  }
  const { error } = await db.from("kpss_tercih").insert({ donem: veri.donem, kaynak_url: sayfaUrl || null, yuklendi, veri, durum });
  if (error) throw new Error(`kpss_tercih yazılamadı: ${error.message}`);
  return { donem: veri.donem, kadro: veri.kadrolar.length, yeni: true };
}

/** A stored `veri` (or a JSON file written by --dosya) as far as the score steps need it; throws on anything else */
function veriKabul(ham: unknown, donem: string, nerede: string): TercihVerisi {
  const v = ham as Partial<TercihVerisi> | null;
  if (!v || typeof v !== "object" || !Array.isArray(v.kadrolar) || !v.kadrolar.length) throw new Error(`${nerede}: kadro tablosu yok`);
  if (v.donem !== donem) throw new Error(`${nerede}: KPSS-${String(v.donem ?? "?")} dönemine ait, beklenen KPSS-${donem}`);
  return v as TercihVerisi;
}

/**
 * Merges a closed round's results into its stored row (`veri` only; the user's
 * state and the load time stay as they are), then refreshes `emsal` on the
 * later rounds that take their reference from it: every newer stored round up
 * to and including the first one that has results of its own.
 */
export async function kpssPuanlariYukle(db: SupabaseClient, donem: string, tablo: PuanTablosu, log: Log): Promise<{ kadro: number; sonuclu: number }> {
  const veriOku = async (d: string) => {
    const { data, error } = await db.from("kpss_tercih").select("veri").eq("donem", d).maybeSingle();
    if (error) throw new Error(`kpss_tercih okunamadı: ${error.message}`);
    if (!data) throw new Error(`KPSS-${d} dönemi kpss_tercih tablosunda yok; önce dönemin kendisini yükle`);
    return veriKabul((data as { veri: unknown }).veri, d, `kayıtlı KPSS-${d}`);
  };
  const veriYaz = async (v: TercihVerisi) => {
    const { error } = await db.from("kpss_tercih").update({ veri: v }).eq("donem", v.donem);
    if (error) throw new Error(`kpss_tercih güncellenemedi (KPSS-${v.donem}): ${error.message}`);
  };

  const veri = await veriOku(donem);
  const sonuclu = tabanlariYaz(veri, tablo, log);
  await veriYaz(veri);

  const donemler = await db.from("kpss_tercih").select("donem");
  if (donemler.error) throw new Error(`kpss_tercih okunamadı: ${donemler.error.message}`);
  const sonrakiler = ((donemler.data ?? []) as { donem: string }[])
    .map((r) => String(r.donem))
    .filter((d) => donemSirasi(d) > donemSirasi(donem))
    .sort((a, b) => donemSirasi(a) - donemSirasi(b));
  for (const d of sonrakiler) {
    const sonraki = await veriOku(d);
    const kaynak = { donem, kadrolar: veri.kadrolar };
    log(emsalOzeti(sonraki, kaynak, emsalleriYaz(sonraki, kaynak)));
    await veriYaz(sonraki);
    // Rounds after one with its own results take their reference from that one, not from here
    if (tabanliMi(sonraki.kadrolar)) break;
  }
  return { kadro: veri.kadrolar.length, sonuclu };
}

// --- Scanner hook -----------------------------------------------------------------

/** "KPSS-2026/2: Bazı Kamu Kurum ve Kuruluşlarının … Tercih Kılavuzu ve Tablolar" -> "2026/2"; null for anything else */
export function tercihKilavuzuDonemi(baslik: string): string | null {
  const b = sade(baslik);
  const m = b.match(/\bkpss (20\d{2}) (\d{1,2})\b/);
  return m && /bazi kamu kurum/.test(b) && /tercih kilavuzu/.test(b) && /tablo/.test(b) ? `${m[1]}/${Number(m[2])}` : null;
}

/** How long a stored announcement is retried: ÖSYM's list is scanned 45 days back, and a round is over well before */
const YENIDEN_DENEME_GUN = 45;

/**
 * Called by the scanner after each ÖSYM scan with the announcements that scan
 * found new. Loads the guide of every general round among them, and retries
 * announcements stored by earlier scans whose round is still not in kpss_tercih
 * (a timeout, or the table not created yet, on the day of the announcement).
 * Never throws: a failure here must not fail the scan.
 */
export async function kpssDuyurulariniIsle(db: SupabaseClient, yeniIlanlar: HamIlan[], log: Log): Promise<void> {
  try {
    const adaylar = new Map<string, string>();
    for (const i of yeniIlanlar) {
      const donem = tercihKilavuzuDonemi(i.baslik);
      if (donem && i.url && !adaylar.has(donem)) adaylar.set(donem, i.url);
    }

    const esik = new Date(Date.now() - YENIDEN_DENEME_GUN * 86_400_000).toISOString();
    const eski = await db.from("kariyer_ilanlar").select("baslik, url").eq("kaynak", "osym").gte("gorulme", esik).limit(200);
    if (eski.error) log(`KPSS tercih: önceki duyurular okunamadı: ${eski.error.message}`);
    const bekleyen = new Map<string, string>();
    for (const i of (eski.data ?? []) as { baslik: string; url: string | null }[]) {
      const donem = tercihKilavuzuDonemi(i.baslik);
      if (donem && i.url && !adaylar.has(donem)) bekleyen.set(donem, i.url);
    }
    if (bekleyen.size) {
      const yuklu = await db.from("kpss_tercih").select("donem").in("donem", [...bekleyen.keys()]);
      if (yuklu.error) {
        // Not created yet, or unreachable: nothing could be stored, so nothing is fetched
        log(`KPSS tercih: kpss_tercih okunamadı, bekleyen ${[...bekleyen.keys()].join(", ")} yüklenmedi: ${yuklu.error.message}`);
      } else {
        const yukluDonemler = new Set(((yuklu.data ?? []) as { donem: string }[]).map((r) => r.donem));
        for (const [donem, url] of bekleyen) if (!yukluDonemler.has(donem)) adaylar.set(donem, url);
      }
    }

    for (const [donem, url] of adaylar) {
      try {
        const s = await kpssTercihYukle(db, url, log);
        log(`KPSS tercih tablosu yüklendi: ${s.donem}, ${s.kadro} kadro`);
      } catch (e) {
        log(`KPSS tercih tablosu YÜKLENEMEDİ (${donem}, ${url}): ${(e as Error).message}`);
      }
    }
  } catch (e) {
    log(`KPSS tercih tablosu denetimi düştü: ${(e as Error).message}`);
  }
}

// --- CLI ------------------------------------------------------------------------

async function main() {
  const log: Log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
  const argumanlar = process.argv.slice(2);
  const secenek = (ad: string) => {
    const i = argumanlar.indexOf(ad);
    if (i < 0) return undefined;
    const deger = argumanlar[i + 1];
    if (!deger || deger.startsWith("--")) throw new Error(`${ad} bir değer bekliyor`);
    argumanlar.splice(i, 2);
    return deger;
  };
  const dosya = secenek("--dosya");
  const yerelDizin = secenek("--yerel");
  const puanlar = secenek("--puanlar");
  const donem = secenek("--donem");
  const onceki = secenek("--onceki");
  const sayfaUrl = argumanlar.find((a) => !a.startsWith("--")) ?? "";
  const jsonOku = (yol: string): unknown => JSON.parse(readFileSync(yol, "utf8"));

  if (puanlar) {
    if (!donem || !/^20\d{2}\/\d{1,2}$/.test(donem)) throw new Error("kullanım: npm run kpss:tercih -- --puanlar <pdf adresi ya da dosyası> --donem 2026/1 [--dosya <dönem.json>]");
    const tablo = puanTablosuAyristir(await pdfOgeleri(await puanBelgesiOku(puanlar)));
    if (dosya) {
      const veri = veriKabul(jsonOku(dosya), donem, dosya);
      tabanlariYaz(veri, tablo, log);
      writeFileSync(dosya, JSON.stringify(veri, null, 1), "utf8");
      log(`sonuçlar dosyaya yazıldı (veritabanına dokunulmadı): ${dosya}`);
      return;
    }
    const s = await kpssPuanlariYukle(createServerSupabaseClient(), donem, tablo, log);
    log(`KPSS-${donem} yerleştirme sonuçları yüklendi: ${s.kadro} kadronun ${s.sonuclu} tanesinde`);
    return;
  }
  if (donem) throw new Error("--donem yalnızca --puanlar ile kullanılır");
  if (onceki && !dosya) throw new Error("--onceki yalnızca --dosya ile kullanılır; veritabanına yüklerken emsal kayıtlı dönemlerden alınır");
  if (!sayfaUrl && !yerelDizin) {
    throw new Error("kullanım: npm run kpss:tercih -- <ÖSYM duyuru sayfası adresi> [--dosya <çıktı.json> [--onceki <önceki dönem.json>]] [--yerel <dizin>]");
  }

  if (dosya) {
    // Read before anything is downloaded: a wrong file should not cost six requests
    let kaynak: EmsalKaynagi | null = null;
    if (onceki) {
      const ham = jsonOku(onceki) as Partial<TercihVerisi> | null;
      kaynak = veriKabul(ham, String(ham?.donem ?? ""), onceki);
      if (!tabanliMi(kaynak.kadrolar)) throw new Error(`--onceki dosyasında yerleştirme sonucu yok: ${onceki}`);
    }
    const veri = await tercihVerisiTopla(sayfaUrl, log, { yerelDizin });
    tercihVerisiDogrula(veri, log);
    if (kaynak) {
      if (!(donemSirasi(kaynak.donem) >= 0 && donemSirasi(kaynak.donem) < donemSirasi(veri.donem))) {
        throw new Error(`--onceki KPSS-${kaynak.donem} dönemine ait; KPSS-${veri.donem} için daha eski bir dönem gerekir`);
      }
      log(emsalOzeti(veri, kaynak, emsalleriYaz(veri, kaynak)));
    }
    writeFileSync(dosya, JSON.stringify(veri, null, 1), "utf8");
    log(`${ozet(veri)}`);
    log(`dosyaya yazıldı (veritabanına dokunulmadı): ${dosya}`);
    return;
  }
  const s = await kpssTercihYukle(createServerSupabaseClient(), sayfaUrl, log, { yerelDizin });
  log(`KPSS tercih tablosu ${s.yeni ? "yüklendi" : "güncellendi (kullanıcı bilgileri korundu)"}: ${s.donem}, ${s.kadro} kadro`);
}

// Only when run as a script; worker/ana.ts imports this module
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`KPSS tercih yüklenemedi: ${(e as Error).message}`);
    process.exit(1);
  });
}
