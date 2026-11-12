// Kamu İlan collector — kamuilan.sbb.gov.tr (Presidency of Strategy and Budget).
//
// One page listing every active public-sector hiring announcement. The home
// page server-renders all of them as <a href='ilanDetay.aspx?kod=…'> in two
// markups: the headline slider (black / patrol / h5date spans) and the full
// list (alt_p1 / alt_p2 paragraphs, dates in <em>). The same announcement can
// appear in both, so items are de-duplicated by institution + title.
//
// `kod` is encrypted per session: it opens the announcement only with the
// session cookie of the page that produced it and a Referer from the home
// page, and then returns the announcement PDF itself (measured 10.11.2026; any
// other request gets a 404 page). Because those links expire, the stored URL is
// the home page and the stable id is a hash of institution | title | start date.
//
// Re-measured 12.11.2026 looking for a link that opens the announcement itself:
// there is none. The page has no other per-announcement link (no direct PDF
// path, no id), every page load issues a different `kod` for the same
// announcement, and the request is answered with the PDF only when it carries a
// Referer from this site (the cookie turned out not to matter); without it the
// server returns a 1.2 kB error page. A link opened from our app or an e-mail
// never has that Referer, so a stored `kod` link would be a dead link. The
// institution search box is a POST form, so it cannot be deep-linked either.
// The stored URL therefore stays the home page.
// No robots.txt (404), so nothing is disallowed; requests are paced with
// nazikBekle like every other source.

import { createHash } from "node:crypto";
import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import { pdfMetni } from "./belge";
import { getir, metneCevir, nazikBekle } from "./http";

const SITE = "https://kamuilan.sbb.gov.tr/";

// Notices about an earlier announcement, not announcements: "İPTAL İLANI",
// "KADRO İPTAL İLANI", "DÜZELTME İLANI" and the site's own typo "DÜLETME
// İLANI" (8 of the 91 live items on 12.11.2026). Their PDFs are a few hundred
// characters with no position in them, so they were being downloaded and scored
// as if they were job ads. The pattern needs the word İLANI right after, so a
// real ad that merely mentions a correction in a longer title is kept.
const DUYURU_BASLIGI = /(?:^|\s)(?:iptal|düzeltme|dületme)\s+ilan[ıi](?:\s|$)/;

export function duyuruMu(baslik: string): boolean {
  return DUYURU_BASLIGI.test(baslik.toLocaleLowerCase("tr"));
}

// Skipping a notice must not lose what it says about the announcement it refers
// to, which stays in the same list under the same institution name. The title
// never names that announcement, so the link is institution (+ dates):
//  - a whole-announcement "İPTAL İLANI" carrying the same date range as an
//    announcement of the same institution cancels it: that one is dropped
//    (12.11.2026: Asarcık "1 MEMUR ALACAK" 1-3 Aralık, Doğanyol 2-4 Aralık);
//  - every other pairing (a cancellation with different dates such as Eleşkirt,
//    which could also be an older round cancelled before a re-announcement; a
//    "KADRO İPTAL" that removes only some positions; a correction) cannot be
//    decided from the list, so the announcement is kept and the notice's own
//    text is put in front of its description for the scorer to read. For
//    Sarıidris that correction is the only readable text: the ad is a scan.
function tamIptalMi(baslik: string): boolean {
  const b = baslik.toLocaleLowerCase("tr");
  return duyuruMu(baslik) && b.includes("iptal") && !b.includes("kadro");
}

const gunu = (t: Date | null) => t?.toISOString().slice(0, 10) ?? "";

function ayniTarihler(a: ListeOgesi, b: ListeOgesi): boolean {
  return Boolean(a.bas) && gunu(a.bas) === gunu(b.bas) && gunu(a.bit) === gunu(b.bit);
}

function duyuruNotu(d: ListeOgesi, metin: string): string {
  const govde = metin
    ? `Duyurunun metni: ${metin.slice(0, 3_000)}`
    : "Duyurunun metni okunamadı; ilanın aslından doğrulanmalı.";
  return `[Dikkat: aynı kurumun listede ayrı bir "${d.baslik}" duyurusu var. Bu ilanı iptal etmiş ya da koşullarını değiştirmiş olabilir. ${govde}]`;
}

// A scanned announcement has no text layer, so pdfMetni returns "" (2 of the 91
// live items on 12.11.2026, both municipal memur ads). Without this note the
// scorer sees an ad with no description and cannot tell "nothing was published"
// from "the text could not be read".
const TARANMIS_PDF_NOTU = "[İlanın PDF'i taranmış görüntü; metni okunamadı. Koşullar ilanın aslından doğrulanmalı.]";

export interface KamuIlanSecenekleri {
  bilinenKimlikler: Set<string>;
  /** PDFs downloaded per run; the rest wait for the next run */
  detaySiniri?: number;
  /** For tests: fixed "today" */
  bugun?: Date;
  log?: (mesaj: string) => void;
}

interface ListeOgesi {
  kod: string;
  kurum: string;
  baslik: string;
  bas: Date | null;
  bit: Date | null;
}

const AYLAR = ["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"];

/**
 * "11 Kasım - 25 Kasım" -> dates. The page omits the year: the start is put in
 * the year that makes it closest to today, and an end month earlier than the
 * start month rolls over to the next year (e.g. "25 Aralık - 8 Ocak").
 */
export function tarihAraligi(metin: string, bugun: Date): { bas: Date | null; bit: Date | null } {
  const parcalar = [...metin.toLocaleLowerCase("tr").matchAll(/(\d{1,2})\s+([a-zçğıöşü]+)/g)]
    .map((m) => ({ gun: Number(m[1]), ay: AYLAR.indexOf(m[2]) }))
    .filter((p) => p.ay >= 0);
  if (!parcalar.length) return { bas: null, bit: null };
  const yil = bugun.getFullYear();
  const enYakin = (gun: number, ay: number) =>
    [yil - 1, yil, yil + 1]
      .map((y) => new Date(Date.UTC(y, ay, gun)))
      .sort((a, b) => Math.abs(a.getTime() - bugun.getTime()) - Math.abs(b.getTime() - bugun.getTime()))[0];
  const bas = enYakin(parcalar[0].gun, parcalar[0].ay);
  let bit: Date | null = null;
  if (parcalar[1]) {
    const y = parcalar[1].ay < parcalar[0].ay ? bas.getUTCFullYear() + 1 : bas.getUTCFullYear();
    bit = new Date(Date.UTC(y, parcalar[1].ay, parcalar[1].gun, 23, 59));
  }
  return { bas, bit };
}

/** Parses both markups of the home page */
export function listeyiAyikla(html: string, bugun: Date): ListeOgesi[] {
  const sinif = (blok: string, ad: string) => {
    const m = blok.match(new RegExp(`class\\s*=\\s*'${ad}'[^>]*>([\\s\\S]*?)<\\/(?:span|p|em)>`));
    return m ? metneCevir(m[1]).replace(/\s+/g, " ").trim() : "";
  };
  const ogeler: ListeOgesi[] = [];
  const gorulen = new Set<string>();
  for (const m of html.matchAll(/<a href='ilanDetay\.aspx\?kod=([^']+)'[^>]*>([\s\S]*?)<\/a>/g)) {
    const blok = m[2];
    const kurum = sinif(blok, "black") || sinif(blok, "alt_p1");
    // In the list markup the dates sit in an <em> inside alt_p2
    const ham2 = blok.match(/class\s*=\s*'alt_p2'[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    const tarihMetni = sinif(blok, "h5date") || metneCevir(ham2.match(/<em[^>]*>([\s\S]*?)<\/em>/)?.[1] ?? "");
    const baslik = sinif(blok, "patrol") || metneCevir(ham2.replace(/<em[\s\S]*?<\/em>/, "")).replace(/\s+/g, " ").trim();
    if (!kurum || !baslik) continue;
    const anahtar = `${sadelestir(kurum)}|${sadelestir(baslik)}`;
    if (gorulen.has(anahtar)) continue;
    gorulen.add(anahtar);
    ogeler.push({ kod: m[1], kurum, baslik, ...tarihAraligi(tarihMetni, bugun) });
  }
  return ogeler;
}

export function kamuIlanKimligi(o: Pick<ListeOgesi, "kurum" | "baslik" | "bas">): string {
  const ham = `${sadelestir(o.kurum)}|${sadelestir(o.baslik)}|${o.bas?.toISOString().slice(0, 10) ?? ""}`;
  return createHash("sha1").update(ham).digest("hex").slice(0, 20);
}

/** Session cookies from the home page response, as a Cookie header */
function cerezBasligi(cevap: Awaited<ReturnType<typeof getir>>): string {
  return cevap.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function kamuIlanTara(secenekler: KamuIlanSecenekleri) {
  const { bilinenKimlikler, detaySiniri = 15 } = secenekler;
  const bugun = secenekler.bugun ?? new Date();
  const log = secenekler.log ?? (() => {});

  const ana = await getir(SITE);
  const cerez = cerezBasligi(ana);
  const html = await ana.text();
  const liste = listeyiAyikla(html, bugun);
  if (!liste.length) throw new Error("ilan listesi boş (sayfa yapısı değişmiş olabilir)");
  const suresiGecmemis = liste.filter((o) => !o.bit || o.bit.getTime() >= bugun.getTime());
  const duyuruDegil = suresiGecmemis.filter((o) => !duyuruMu(o.baslik));
  const atlanan = suresiGecmemis.length - duyuruDegil.length;
  if (atlanan) log(`Kamu İlan: ${atlanan} iptal/düzeltme duyurusu atlandı`);

  // Notices are taken from the whole list: one whose own date window has passed
  // still applies to an announcement that is open
  const duyurular = liste.filter((o) => duyuruMu(o.baslik));
  const kurumDuyurulari = (o: ListeOgesi) => duyurular.filter((d) => sadelestir(d.kurum) === sadelestir(o.kurum));
  const iptalEden = (o: ListeOgesi) => kurumDuyurulari(o).find((d) => tamIptalMi(d.baslik) && ayniTarihler(d, o));
  const aktif = duyuruDegil.filter((o) => !iptalEden(o));
  const iptalEdilen = duyuruDegil.length - aktif.length;
  if (iptalEdilen) log(`Kamu İlan: ${iptalEdilen} ilan iptal duyurusuyla eşleşti (aynı kurum, aynı tarihler), atlandı`);
  // A cancellation that already took its announcement out says nothing about the others
  const kullanilan = new Set(duyuruDegil.map(iptalEden).filter((d) => d !== undefined));

  let pdfHatasi = 0;
  const pdfOku = async (o: ListeOgesi): Promise<{ metin: string; taranmis: boolean }> => {
    try {
      await nazikBekle();
      const cevap = await getir(`${SITE}ilanDetay.aspx?kod=${o.kod}`, { headers: { cookie: cerez, referer: SITE } });
      if ((cevap.headers.get("content-type") ?? "").includes("pdf")) {
        const metin = await pdfMetni(await cevap.arrayBuffer());
        // A PDF did arrive but gave no text: a scan (or a file over pdfMetni's size limit)
        return { metin, taranmis: !metin };
      }
      await cevap.arrayBuffer(); // 404 page: the session expired or the markup changed
    } catch (e) {
      pdfHatasi++;
      log(`Kamu İlan: PDF okunamadı (${o.kurum}): ${(e as Error).message}`);
    }
    return { metin: "", taranmis: false };
  };
  // Each notice is downloaded at most once per run, and only when a new
  // announcement of its institution is about to be stored (at most 8 extra
  // requests with the 12.11.2026 list)
  const duyuruMetinleri = new Map<string, string>();

  const ilanlar: HamIlan[] = [];
  let taranmisSayisi = 0;
  let notluSayisi = 0;
  for (const o of aktif) {
    const kimlik = kamuIlanKimligi(o);
    if (bilinenKimlikler.has(kimlik)) continue;
    if (ilanlar.length >= detaySiniri) break;

    const { metin, taranmis } = await pdfOku(o);
    if (taranmis) taranmisSayisi++;
    const notlar: string[] = [];
    for (const d of kurumDuyurulari(o).filter((d) => !kullanilan.has(d))) {
      if (!duyuruMetinleri.has(d.kod)) duyuruMetinleri.set(d.kod, (await pdfOku(d)).metin);
      notlar.push(duyuruNotu(d, duyuruMetinleri.get(d.kod) ?? ""));
    }
    if (notlar.length) notluSayisi++;
    const govde = metin ? metin.slice(0, 12_000) : taranmis ? TARANMIS_PDF_NOTU : "";
    const aciklama = [...notlar, govde].filter(Boolean).join("\n\n");

    ilanlar.push({
      kaynak: "kamuilan",
      kaynakId: kimlik,
      baslik: `${o.kurum}: ${o.baslik}`,
      sirket: o.kurum,
      // Most announcements cover many provinces (or say it only inside the PDF);
      // leaving it empty means "unknown", so the city filter does not drop it
      sehir: undefined,
      aciklama: aciklama || undefined,
      url: SITE,
      yayinTarihi: o.bas?.toISOString(),
      sonBasvuru: o.bit?.toISOString(),
      ham: { kurum: o.kurum, baslik: o.baslik, pdf: Boolean(metin), taranmis, duyuruNotu: notlar.length },
    });
  }
  if (notluSayisi) log(`Kamu İlan: ${notluSayisi} ilanın açıklamasına kurumun iptal/düzeltme duyurusu eklendi`);
  if (taranmisSayisi) log(`Kamu İlan: ${taranmisSayisi} ilanın PDF'i taranmış görüntü, metni okunamadı`);
  if (pdfHatasi) log(`Kamu İlan: ${pdfHatasi} ilanın PDF'i okunamadı, yalnız başlıkla değerlendirilecek`);
  return { ilanlar, gorulen: aktif.length };
}
