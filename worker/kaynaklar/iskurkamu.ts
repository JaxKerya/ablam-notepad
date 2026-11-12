// İŞKUR "Kamu Memur Alım İlanları" collector — www.iskur.gov.tr.
//
// A different section from the open job listings iskur.ts scrapes on
// esube.iskur.gov.tr: here İŞKUR republishes hiring announcements that public
// institutions send it, each as a PDF. It is a second, independent feed next to
// Kamu İlan (measured 12.11.2026: 35 announcements in 19 provinces; of 19
// sampled, 18 were on Kamu İlan too and one was not).
//
// The section's landing page lists no announcements, only a map with a counter
// per province (<g id="ankara" data-iladi="Ankara" data-count="12">). The rows
// are server-rendered on ?idId=<slug>&il=<name>, one request per province:
//   <tr class="clickable-row" data-file-url="/medya/<key>/<name>.pdf" data-has-file="True">
//     <td><span>16.11.2026 23:55 …</span></td><td>title</td><td><a href=pdf></td>
// Only provinces with a counter above zero are requested, paced with nazikBekle.
//
// The site sits behind a WAF that answers some clients with a 244-byte
// "Request Rejected" page and HTTP 200. That is reported as an error instead of
// an empty scan; nothing here tries to get past it. Measured 12.11.2026: getir's
// request was rejected on both tries, while a bare curl with the same
// User-Agent got the page; which header makes the difference was not probed.
// Re-run 12.11.2026 after review: still rejected on the first request, so the
// adapter has never completed a live scan. Province-page parsing, the PDF
// download and the stored URL are therefore unverified against the live site,
// and the source should stay unregistered until the owner decides what to do.

import { createHash } from "node:crypto";
import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import { pdfMetni } from "./belge";
import type { Page } from "playwright-core";
import { metneCevir, nazikBekle, varliklariCoz } from "./http";
import { tarayiciAc } from "./iskur";

const KOK = "https://www.iskur.gov.tr";
const SAYFA = `${KOK}/ilanlar/kamu-memur-alim-ilanlari/`;

/** Province pages requested per run; 19 had announcements on 12.11.2026 */
const EN_COK_IL = 30;

/**
 * Institution names end in one of these words; the title carries institution
 * and position in a single string ("Kültür ve Turizm Bakanlığı Sözleşmeli
 * Kütüphaneci Alım İlanı 16.11.2026"), so the institution is everything up to
 * the last such word.
 */
const KURUM_SONU =
  /^.*(?:Bakanlığı|Başkanlığı|Komutanlığı|Müdürlüğü|Rektörlüğü|Üniversitesi|Belediyesi|Valiliği|Kaymakamlığı|Kurumu|Kurulu|Ajansı|A\.Ş\.)(?=\s|$)/;

export interface IskurKamuSecenekleri {
  bilinenKimlikler?: Set<string>;
  /** PDFs downloaded per run; the rest wait for the next run */
  detaySiniri?: number;
  /** For tests: fixed "today" */
  bugun?: Date;
  log?: (mesaj: string) => void;
}

interface Il {
  kimlik: string;
  ad: string;
  sayi: number;
}

interface Satir {
  il: string;
  baslik: string;
  /** Site-relative path of the announcement file, when the row has one */
  dosya: string | null;
  bit: Date | null;
  sayfaAdresi: string;
}

// Same wording as kamuilan.ts: without a note the scorer cannot tell "nothing
// was published" from "the text could not be read".
const TARANMIS_PDF_NOTU = "[İlanın PDF'i taranmış görüntü; metni okunamadı. Koşullar ilanın aslından doğrulanmalı.]";
const INDIRILEMEDI_NOTU = "[İlanın PDF'i indirilemedi; yalnız başlık biliniyor. Koşullar ilanın aslından doğrulanmalı.]";

const reddedildiMi = (html: string) => html.length < 2000 && /Request Rejected/i.test(html);

/** The WAF's block page comes with HTTP 200, so getir does not catch it */
function reddiDenetle(html: string) {
  if (reddedildiMi(html)) {
    throw new Error("istek reddedildi (iskur.gov.tr güvenlik duvarı 'Request Rejected' döndü)");
  }
}

/**
 * Downloads one announcement PDF. The outcomes are kept apart because they are
 * handled differently: a WAF rejection is retried on the next run, the other
 * failures are not expected to heal by themselves.
 */
export async function pdfOku(
  sayfa: Page,
  adres: string
): Promise<{ durum: "metin" | "taranmis" | "reddedildi" | "pdfDegil"; metin: string }> {
  // Fetched by the page itself (same origin, the browser's own request), then handed
  // over as base64. Files over 8 MB are left unread, like pdfMetni's own limit.
  const cevap = await sayfa.evaluate(async (url) => {
    const r = await fetch(url);
    const tur = r.headers.get("content-type") ?? "";
    if (!tur.includes("pdf")) return { tur, b64: "", metin: (await r.text()).slice(0, 3000) };
    const bayt = new Uint8Array(await r.arrayBuffer());
    if (bayt.length > 8_000_000) return { tur, b64: "", metin: "" };
    let ikili = "";
    for (let i = 0; i < bayt.length; i += 0x8000) ikili += String.fromCharCode(...bayt.subarray(i, i + 0x8000));
    return { tur, b64: btoa(ikili), metin: "" };
  }, adres);
  if (cevap.tur.includes("pdf")) {
    const tampon = Buffer.from(cevap.b64, "base64");
    const metin = cevap.b64 ? await pdfMetni(tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + tampon.byteLength) as ArrayBuffer) : "";
    // A PDF did arrive but gave no text: a scan (or a file over the size limit)
    return metin ? { durum: "metin", metin } : { durum: "taranmis", metin: "" };
  }
  // Not a PDF: the WAF's block page (HTTP 200, text/html) or a moved file
  return { durum: reddedildiMi(cevap.metin) ? "reddedildi" : "pdfDegil", metin: "" };
}

/** Opens a page in the browser and returns its HTML */
async function htmlAl(sayfa: Page, adres: string): Promise<string> {
  await sayfa.goto(adres, { waitUntil: "domcontentloaded", timeout: 45_000 });
  return sayfa.content();
}

/** Provinces whose map counter is above zero */
export function illeriAyikla(html: string): Il[] {
  const iller: Il[] = [];
  for (const m of html.matchAll(/<g\s+id="([^"]+)"[^>]*?data-iladi="([^"]*)"[^>]*?data-count="(\d*)"/g)) {
    const sayi = Number(m[3] || 0);
    if (sayi > 0) iller.push({ kimlik: m[1], ad: varliklariCoz(m[2]), sayi });
  }
  return iller;
}

/** "16.11.2026 23:55" in Turkey time (UTC+3, no DST) -> Date */
function sonTarih(metin: string): Date | null {
  const m = metin.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const saat = m[4] ? Number(m[4]) : 23;
  const dakika = m[5] ? Number(m[5]) : 59;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), saat - 3, dakika));
}

/** Table rows of one province page */
export function satirlariAyikla(html: string, il: string, sayfaAdresi: string): Satir[] {
  const satirlar: Satir[] = [];
  for (const m of html.matchAll(/<tr class="clickable-row"([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const hucreler = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((h) => h[1]);
    if (hucreler.length < 2) continue;
    const baslik = metneCevir(hucreler[1]).replace(/\s+/g, " ").trim();
    if (!baslik) continue;
    const yol = varliklariCoz(m[1].match(/data-file-url="([^"]*)"/)?.[1] ?? "").trim();
    satirlar.push({ il, baslik, dosya: yol || null, bit: sonTarih(metneCevir(hucreler[0])), sayfaAdresi });
  }
  return satirlar;
}

/**
 * Umbraco stores every upload under /medya/<key>/; the key identifies the
 * announcement and, unlike the title, is the same on every province page that
 * lists it. Rows without a file fall back to a hash of title + deadline.
 */
export function iskurKamuKimligi(s: Pick<Satir, "dosya" | "baslik" | "bit">): string {
  const anahtar = s.dosya?.match(/^\/medya\/([^/]+)\//)?.[1];
  if (anahtar) return anahtar;
  const ham = `${sadelestir(s.baslik)}|${s.bit?.toISOString().slice(0, 10) ?? ""}`;
  return createHash("sha1").update(ham).digest("hex").slice(0, 20);
}

export async function iskurKamuTara(secenekler: IskurKamuSecenekleri): Promise<{ ilanlar: HamIlan[]; gorulen: number }> {
  const { bilinenKimlikler = new Set<string>(), detaySiniri = 15 } = secenekler;
  const bugun = secenekler.bugun ?? new Date();
  const log = secenekler.log ?? (() => {});

  // A real browser, like worker/kaynaklar/iskur.ts on the same site: the firewall
  // answers the plain Node HTTP client with "Request Rejected" (measured 12.11.2026).
  const tarayici = await tarayiciAc();
  try {
    const sayfa = await (await tarayici.newContext({ locale: "tr-TR" })).newPage();
    return await tara(sayfa, { bilinenKimlikler, detaySiniri, bugun, log });
  } finally {
    await tarayici.close().catch(() => {});
  }
}

async function tara(
  sayfa: Page,
  { bilinenKimlikler, detaySiniri, bugun, log }: { bilinenKimlikler: Set<string>; detaySiniri: number; bugun: Date; log: (m: string) => void }
): Promise<{ ilanlar: HamIlan[]; gorulen: number }> {
  const anaHtml = await htmlAl(sayfa, SAYFA);
  reddiDenetle(anaHtml);
  // The map is always rendered, so no province markup at all means the page changed;
  // every counter at zero is a legitimate empty state
  if (!/data-iladi="/.test(anaHtml)) throw new Error("il haritası bulunamadı (sayfa yapısı değişmiş olabilir)");
  const iller = illeriAyikla(anaHtml);
  if (iller.length > EN_COK_IL) log(`İŞKUR Kamu: ${iller.length} ilde ilan var, ilk ${EN_COK_IL} il taranıyor`);

  // The same announcement can be listed under more than one province
  const satirlar = new Map<string, Satir>();
  let ilHatasi = 0;
  for (const il of iller.slice(0, EN_COK_IL)) {
    const adres = `${SAYFA}?idId=${encodeURIComponent(il.kimlik)}&il=${encodeURIComponent(il.ad)}`;
    try {
      await nazikBekle();
      const html = await htmlAl(sayfa, adres);
      reddiDenetle(html);
      const bulunan = satirlariAyikla(html, il.ad, adres);
      if (!bulunan.length) log(`İŞKUR Kamu: ${il.ad} sayacı ${il.sayi} ama tabloda satır yok`);
      for (const s of bulunan) {
        const kimlik = iskurKamuKimligi(s);
        if (!satirlar.has(kimlik)) satirlar.set(kimlik, s);
      }
    } catch (e) {
      ilHatasi++;
      log(`İŞKUR Kamu: ${il.ad} sayfası okunamadı: ${(e as Error).message}`);
    }
  }
  // Counters said there are announcements but not one row was read: a broken
  // source must not look like a successful empty scan
  if (iller.length && !satirlar.size) {
    throw new Error(`ilan tablosu okunamadı (${iller.length} ilde sayaç var, ${ilHatasi} il sayfası hata verdi)`);
  }

  const aktif = [...satirlar].filter(([, s]) => !s.bit || s.bit.getTime() >= bugun.getTime());

  const ilanlar: HamIlan[] = [];
  let pdfHatasi = 0;
  let reddedilen = 0;
  for (const [kimlik, s] of aktif) {
    if (bilinenKimlikler.has(kimlik)) continue;
    if (ilanlar.length >= detaySiniri) break;

    // new URL percent-encodes the Turkish letters Umbraco keeps in file names
    const dosyaAdresi = s.dosya ? new URL(s.dosya, KOK).href : null;
    let metin = "";
    let not: string | undefined;
    if (dosyaAdresi && /\.pdf$/i.test(s.dosya ?? "")) {
      try {
        await nazikBekle();
        const sonuc = await pdfOku(sayfa, dosyaAdresi);
        if (sonuc.durum === "reddedildi") {
          // Emitting the announcement now would put its id among the known ones
          // and the PDF would never be fetched again; leave it (and the rest,
          // rather than keep knocking on a WAF that said no) to the next run
          reddedilen++;
          break;
        }
        metin = sonuc.metin;
        if (sonuc.durum === "taranmis") not = TARANMIS_PDF_NOTU;
        if (sonuc.durum === "pdfDegil") {
          pdfHatasi++;
          not = INDIRILEMEDI_NOTU;
          log(`İŞKUR Kamu: PDF yerine başka içerik geldi (${s.baslik.slice(0, 60)})`);
        }
      } catch (e) {
        pdfHatasi++;
        not = INDIRILEMEDI_NOTU;
        log(`İŞKUR Kamu: PDF okunamadı (${s.baslik.slice(0, 60)}): ${(e as Error).message}`);
      }
    }

    // The title repeats the deadline at its end; sonBasvuru already carries it
    const baslik = s.baslik.replace(/\s+\d{2}\.\d{2}\.\d{4}$/, "").trim() || s.baslik;
    const kurum = baslik.match(KURUM_SONU)?.[0].trim();
    ilanlar.push({
      kaynak: "iskurkamu",
      kaynakId: kimlik,
      baslik,
      sirket: kurum && kurum.length < baslik.length ? kurum : undefined,
      // Central institutions are all filed under Ankara although they hire
      // nationwide, so the province is not a reliable work location; left empty
      // ("unknown") like Kamu İlan and kept in ham
      sehir: undefined,
      aciklama: metin ? metin.slice(0, 12_000) : not,
      url: dosyaAdresi ?? s.sayfaAdresi,
      sonBasvuru: s.bit?.toISOString(),
      ham: { il: s.il, baslik: s.baslik, dosya: s.dosya, pdf: Boolean(metin), taranmis: not === TARANMIS_PDF_NOTU },
    });
  }
  if (reddedilen) {
    // Nothing new got through: a blocked source must not look like a successful scan
    if (!ilanlar.length) throw new Error("ilan PDF'i reddedildi (iskur.gov.tr güvenlik duvarı 'Request Rejected' döndü)");
    log("İŞKUR Kamu: bir PDF isteği reddedildi, kalan ilanlar sonraki taramaya bırakıldı");
  }
  const taranmisSayisi = ilanlar.filter((i) => i.aciklama === TARANMIS_PDF_NOTU).length;
  if (taranmisSayisi) log(`İŞKUR Kamu: ${taranmisSayisi} ilanın PDF'i taranmış görüntü, metni okunamadı`);
  if (pdfHatasi) log(`İŞKUR Kamu: ${pdfHatasi} ilanın PDF'i okunamadı, yalnız başlıkla değerlendirilecek`);
  return { ilanlar, gorulen: aktif.length };
}
