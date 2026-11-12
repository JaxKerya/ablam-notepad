// ÖSYM collector — www.osym.gov.tr/Duyurular/Index.
//
// Not a job board: this watches the announcement list for the moment a KPSS
// placement round opens ("KPSS-2026/2 ... Tercih Kılavuzu ve Tablolar",
// "... Adaylardan Tercih Alınması"). Each round lists hundreds of önlisans (P93)
// posts province by province in its guide, and the preference window is about a
// week, so missing the announcement means missing the round.
//
// The list is one server-rendered page (measured 12.11.2026: 749 KB, 470 rows,
// about ten months back). Every row is
//   <a class="duyuru-list-item" href="/slug" data-search-text="Title dd.MM.yyyy d Ay yyyy" title="Title">
// Only 4 of the 470 rows were placement-round openings, so the title filter is
// strict and nothing else on the page is ever fetched. The site has no
// robots.txt (302 to the home page); one list request per run plus one detail
// request per new announcement.

import type { HamIlan } from "../../lib/kariyer";
import { getir, metneCevir, nazikBekle, varliklariCoz } from "./http";

const SITE = "https://www.osym.gov.tr";
const LISTE = `${SITE}/Duyurular/Index`;

/** First line of every description: tells the scoring model and the reader what this record is */
const ACIKLAMA_BASI =
  "ÖSYM KPSS tercih duyurusu: bu yerleştirmede önlisans (P93) kadroları tercih kılavuzunda il il listelenir.";

// A placement round is always named "KPSS-<year>/<n>". The exam itself is
// "<year>-KPSS Ön Lisans ...", so this one pattern drops application, entry
// document, answer key and score announcements. The lookbehind keeps
// "2026-EKPSS/Kura" (disabled-candidate placement) out.
const YERLESTIRME_TURU = /(?<![a-zçğıöşü])kpss[\s-]*(20\d{2})\s*\/\s*(\d{1,2})/;
// Opening of a round: preferences, guide, or placement being made...
const ACILIS = /tercih|kılavuz|yerleştir/;
// ...but not what comes after it closes (results, statistics, rankings).
const KAPANIS = /sonuç|sayısal bilgi|sıralama|en küçük|en büyük|itiraz/;
// General rounds; anything else is a single institution's round, which may have no önlisans post.
const GENEL_TUR = /bazı kamu kurum/;

const AYLAR = ["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"];
const AY_DESENI = AYLAR.join("|");

// Named entities the detail pages use that http.ts varliklariCoz does not know
const EK_VARLIKLAR: Record<string, string> = {
  rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-", hellip: "...",
  acirc: "â", Acirc: "Â", icirc: "î", Icirc: "Î", ucirc: "û", Ucirc: "Û",
};
const varliklar = (metin: string) => varliklariCoz(metin).replace(/&([a-z]+);/gi, (m, ad) => EK_VARLIKLAR[ad] ?? m);

export interface OsymSecenekleri {
  bilinenKimlikler?: Set<string>;
  /** Announcements older than this many days are ignored (a round is over well before) */
  gunSiniri?: number;
  /** For tests: fixed "today" */
  bugun?: Date;
  log?: (m: string) => void;
}

export interface OsymDuyurusu {
  /** Path without the leading slash; stable id of the announcement */
  slug: string;
  baslik: string;
  tarih: Date | null;
}

/** Parses every row of the announcement list, newest first as on the page */
export function osymListesi(html: string): OsymDuyurusu[] {
  const ogeler: OsymDuyurusu[] = [];
  const gorulen = new Set<string>();
  for (const m of html.matchAll(/<a\s+class="duyuru-list-item"([^>]*)>/g)) {
    const oznitelik = (ad: string) => varliklar(m[1].match(new RegExp(`\\b${ad}="([^"]*)"`))?.[1] ?? "");
    const slug = oznitelik("href").replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "");
    const baslik = oznitelik("title").replace(/\s+/g, " ").trim();
    if (!slug || !baslik || gorulen.has(slug)) continue;
    gorulen.add(slug);
    // data-search-text ends with "dd.MM.yyyy d Ay yyyy"; the last numeric date is the publication day
    const t = [...oznitelik("data-search-text").matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)].pop();
    ogeler.push({ slug, baslik, tarih: t ? new Date(Date.UTC(Number(t[3]), Number(t[2]) - 1, Number(t[1]))) : null });
  }
  return ogeler;
}

/** True for the opening of a KPSS placement round (preferences / guide), false for everything else */
export function tercihDuyurusuMu(baslik: string): boolean {
  const b = baslik.toLocaleLowerCase("tr");
  return YERLESTIRME_TURU.test(b) && ACILIS.test(b) && !KAPANIS.test(b);
}

/**
 * Last day of the preference window, when the text states exactly one.
 * Two wordings were seen (KPSS-2026/1): "9-16 Temmuz 2026 tarihleri arasında"
 * and "16 Temmuz 2026 tarihinde saat 23.59'da sona erecektir". If they
 * disagree, or neither appears, nothing is returned: a wrong deadline is worse
 * than a missing one.
 */
export function sonTercihGunu(metin: string): Date | null {
  const m = metin.toLocaleLowerCase("tr");
  const gunler = new Set<string>();
  const ekle = (gun: string, ay: string, yil: string) =>
    gunler.add(`${yil}-${String(AYLAR.indexOf(ay) + 1).padStart(2, "0")}-${gun.padStart(2, "0")}`);
  const aralik = new RegExp(`\\d{1,2}(?:\\s+(?:${AY_DESENI}))?(?:\\s+20\\d{2})?\\s*[-–]\\s*(\\d{1,2})\\s+(${AY_DESENI})\\s+(20\\d{2})`, "g");
  for (const a of m.matchAll(aralik)) ekle(a[1], a[2], a[3]);
  const bitis = new RegExp(`(\\d{1,2})\\s+(${AY_DESENI})\\s+(20\\d{2})\\s+tarihinde(?:\\s+saat\\s+[\\d.:]+\\S*)?\\s+(?:sona|bit)`, "g");
  for (const a of m.matchAll(bitis)) ekle(a[1], a[2], a[3]);
  if (gunler.size !== 1) return null;
  // 23:59 Turkey time (UTC+3, no daylight saving)
  return new Date(`${[...gunler][0]}T23:59:00+03:00`);
}

/** Body of an announcement page: text plus the guide/table PDF links, which the text alone would lose */
function detayMetni(html: string): string {
  const bas = html.indexOf('class="row content"');
  if (bas < 0) return "";
  // The side menu column follows the text column; cut at its opening tag
  const menu = html.indexOf("sinavGrubuYanMenu", bas);
  const son = menu > 0 ? html.lastIndexOf('class="col-sm-3"', menu) : -1;
  const govde = html.slice(html.indexOf(">", bas) + 1, son > 0 ? html.lastIndexOf("<", son) : bas + 60_000);
  const metin = varliklar(metneCevir(govde))
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  const belgeler: string[] = [];
  for (const a of govde.matchAll(/<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const ad = varliklar(metneCevir(a[2])).replace(/\s+/g, " ").trim();
    if (ad) belgeler.push(`- ${ad}: ${a[1].startsWith("//") ? `https:${a[1]}` : a[1]}`);
  }
  return belgeler.length ? `${metin}\n\nBelgeler:\n${belgeler.join("\n")}` : metin;
}

export async function osymTara(secenekler: OsymSecenekleri = {}): Promise<{ ilanlar: HamIlan[]; gorulen: number }> {
  const { bilinenKimlikler = new Set<string>(), gunSiniri = 45 } = secenekler;
  const bugun = secenekler.bugun ?? new Date();
  const log = secenekler.log ?? (() => {});

  const liste = osymListesi(await (await getir(LISTE)).text());
  if (!liste.length) throw new Error("duyuru listesi boş (sayfa yapısı değişmiş olabilir)");

  const esik = bugun.getTime() - gunSiniri * 86_400_000;
  // A row whose date could not be read is kept: better one stale notice than a missed round
  const uygun = liste.filter((d) => tercihDuyurusuMu(d.baslik) && (!d.tarih || d.tarih.getTime() >= esik));

  const ilanlar: HamIlan[] = [];
  let atlanan = 0;
  for (const d of uygun) {
    if (bilinenKimlikler.has(d.slug)) continue;
    const url = `${SITE}/${d.slug}`;

    let metin = "";
    try {
      await nazikBekle();
      metin = detayMetni(await (await getir(url)).text());
    } catch (e) {
      // Skip instead of saving a body-less record: once the slug is stored it is
      // never fetched again, so one timeout would permanently lose the deadline
      // and the guide links. The row stays in the 45-day window; the next run retries.
      log(`ÖSYM: duyuru sayfası okunamadı, sonraki taramada yeniden denenecek (${d.baslik.slice(0, 60)}): ${(e as Error).message}`);
      atlanan++;
      continue;
    }
    // A page that loads but yields no text is a layout change, not a transient
    // error: retrying would never succeed, so the notice still goes out with its link.
    if (!metin) log(`ÖSYM: duyuru metni ayrıştırılamadı, yalnızca başlık kaydediliyor (${d.baslik.slice(0, 60)})`);

    const son = sonTercihGunu(metin);
    const satirlar = [ACIKLAMA_BASI];
    if (!GENEL_TUR.test(d.baslik.toLocaleLowerCase("tr")))
      satirlar.push("Kuruma özel yerleştirme: önlisans kadrosu olup olmadığı kılavuzdan doğrulanmalı.");
    if (son) {
      const gun = new Date(son.getTime() + 3 * 3_600_000);
      const ay = AYLAR[gun.getUTCMonth()];
      satirlar.push(`Son tercih günü: ${gun.getUTCDate()} ${ay[0].toLocaleUpperCase("tr")}${ay.slice(1)} ${gun.getUTCFullYear()}, saat 23.59.`);
    }
    if (metin) satirlar.push("", metin);

    ilanlar.push({
      kaynak: "osym",
      kaynakId: d.slug,
      baslik: d.baslik,
      sirket: "ÖSYM",
      // Nationwide placement; empty means "unknown", so the city filter does not drop it
      sehir: undefined,
      aciklama: satirlar.join("\n").slice(0, 12_000),
      url,
      yayinTarihi: d.tarih?.toISOString(),
      sonBasvuru: son?.toISOString(),
      ham: { tur: d.baslik.toLocaleLowerCase("tr").match(YERLESTIRME_TURU)?.slice(1, 3).join("/"), detay: Boolean(metin) },
    });
  }
  log(`ÖSYM: ${liste.length} duyuru, ${uygun.length} KPSS tercih duyurusu (son ${gunSiniri} gün), ${ilanlar.length} yeni${atlanan ? `, ${atlanan} okunamadı` : ""}`);
  // gorulen is the whole list, not the matches: matches are 0 most of the year,
  // and a non-zero count is what shows the page still parses
  return { ilanlar, gorulen: liste.length };
}
