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
// No robots.txt (404), so nothing is disallowed; requests are paced with
// nazikBekle like every other source.

import { createHash } from "node:crypto";
import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import { pdfMetni } from "./belge";
import { getir, metneCevir, nazikBekle } from "./http";

const SITE = "https://kamuilan.sbb.gov.tr/";

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
  const aktif = liste.filter((o) => !o.bit || o.bit.getTime() >= bugun.getTime());

  const ilanlar: HamIlan[] = [];
  let pdfHatasi = 0;
  for (const o of aktif) {
    const kimlik = kamuIlanKimligi(o);
    if (bilinenKimlikler.has(kimlik)) continue;
    if (ilanlar.length >= detaySiniri) break;

    let metin = "";
    try {
      await nazikBekle();
      const cevap = await getir(`${SITE}ilanDetay.aspx?kod=${o.kod}`, { headers: { cookie: cerez, referer: SITE } });
      if ((cevap.headers.get("content-type") ?? "").includes("pdf")) metin = await pdfMetni(await cevap.arrayBuffer());
      else await cevap.arrayBuffer(); // 404 page: the session expired or the markup changed
    } catch (e) {
      pdfHatasi++;
      log(`Kamu İlan: PDF okunamadı (${o.kurum}): ${(e as Error).message}`);
    }

    ilanlar.push({
      kaynak: "kamuilan",
      kaynakId: kimlik,
      baslik: `${o.kurum}: ${o.baslik}`,
      sirket: o.kurum,
      // Most announcements cover many provinces (or say it only inside the PDF);
      // leaving it empty means "unknown", so the city filter does not drop it
      sehir: undefined,
      aciklama: metin ? metin.slice(0, 12_000) : undefined,
      url: SITE,
      yayinTarihi: o.bas?.toISOString(),
      sonBasvuru: o.bit?.toISOString(),
      ham: { kurum: o.kurum, baslik: o.baslik, pdf: Boolean(metin) },
    });
  }
  if (pdfHatasi) log(`Kamu İlan: ${pdfHatasi} ilanın PDF'i okunamadı, yalnız başlıkla değerlendirilecek`);
  return { ilanlar, gorulen: aktif.length };
}
