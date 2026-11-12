// Adalet Bakanlığı collector — pgm.adalet.gov.tr (Personel Genel Müdürlüğü).
//
// The official source for zabıt kâtibi, mübaşir, icra kâtibi and other court
// staff intakes. Kamu İlan shows such an intake only while its short
// application window is open; this list has it on the day of publication and
// also carries the follow-ups a candidate needs (practical exam texts, exam
// dates, results).
//
// /Home/TumHaberler/1 is one server-rendered page with the whole archive
// (678 rows back to 2018, 454 KB, measured 12.11.2026): each row is
// <a href='/Home/SayfaDetay/<slug>'>title</a> + <td>d.MM.yyyy</td>. Most rows
// are noise for this profile (hâkim/savcı, in-service promotion exams,
// transfers, news), so the title filter runs before any detail request.
// Real intakes are rare (3-5 a year); an empty run is the normal case.

import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import { metniToparla, pdfMetni } from "./belge";
import { getir, metneCevir, nazikBekle, varliklariCoz } from "./http";

const SITE = "https://pgm.adalet.gov.tr";

export interface AdaletSecenekleri {
  bilinenKimlikler?: Set<string>;
  /** Announcements older than this are ignored */
  enEskiGun?: number;
  /** Detail pages fetched per run */
  detaySiniri?: number;
  /** For tests: fixed "today" */
  bugun?: Date;
  log?: (mesaj: string) => void;
}

export interface AdaletSatiri {
  /** URL slug; the site's own stable id of the announcement */
  kimlik: string;
  baslik: string;
  url: string;
  tarih: Date | null;
}

/**
 * Titles (after sade()) that are never an outside intake for this profile, even
 * when they contain "alım" or "sınav": judges and prosecutors, promotion and
 * title-change exams for existing staff, transfers, the bar-entry exam, expert
 * theses, news items. Decided from the real 2024-2026 titles (12.11.2026).
 * The last three are staff-only rows that pass ALIM on "sözleşmeli"/"kâtip"
 * alone: "Sözleşmeli Personelin Karşılıklı Yer Değiştirme Sonuçları",
 * "Sözleşmeli Personelin Kadroya Geçiş İşlemleri", "İcra Kâtipleri Arasından …
 * İcra Müdür Yardımcılığına Geçiş Yazılı Sınav Sonuçları".
 */
const GURULTU =
  /\bhakim|\bsavci|gorevde yukselme|unvan degisikligi|\bgys\b|\buds\b|\bnakil\b|\betik\b|hukuk mesleklerine|idari yargi on sinavi|adalet uzman|\btez|tetkik|kadastro|cubbe|toplanti|toren|gorevlendirilmesi|yer degis|kadroya gecis|yardimciligina gecis/;

/**
 * What makes a row recruitment-related. A bare "ilan" or "sınav" is not enough:
 * "İsteğe Bağlı Nakil Çalışması İlanı" and "Hukuk Mesleklerine Giriş Sınavı
 * İlanı" would pass. "alim" also covers "alımı" and "alım ilanı".
 */
const ALIM =
  /\balim|\bsozlesmeli\b|zabit katib|icra katib|mubasir|hizmetli|destek personeli|koruma ve guvenlik|infaz ve koruma|\bkatip|\bkatib/;

/**
 * Follow-ups of an earlier intake: useful news, not a new opening. Besides
 * results, objections and exam texts/places/dates, the archive has (checked
 * against all 678 titles, 12.11.2026) documents asked from winners ("İstenilecek
 * Belgeler", "İstenilen Belgeler"), placement of reserves ("Yedek Olarak
 * Belirlenen", "Yerleştirmeye Hak Kazanan"), "Ek Duyuru", evaluation criteria
 * and the height-weight measurement notices. "Ek İlan" is deliberately left
 * out: it can add positions, and calling a real opening a follow-up costs more
 * than the opposite mistake.
 */
const TAKIP =
  /sonuc|itiraz|sinavi? metin|sinav yer|sinav tarih|sinava iliskin|gireceklere|erteleme|ertelenmesi|iptal|duzeltme|istenile(cek|n) belge|\byedek|yerlestirme|ek duyuru|degerlendirme kriter|boy ve kilo|boy kilo/;

/** sadelestir() turns "â" into a space ("kâtibi" -> "k tibi", "hâkim" -> "h kim"); fold the circumflex letters first */
function sade(metin: string): string {
  return sadelestir(metin.replace(/[âÂ]/g, "a").replace(/[îÎ]/g, "i").replace(/[ûÛ]/g, "u"));
}

export function alimDuyurusuMu(baslik: string): boolean {
  const s = sade(baslik);
  return !GURULTU.test(s) && ALIM.test(s);
}

/**
 * The page editor writes circumflex letters as named entities ("K&acirc;tibi"),
 * which the shared varliklariCoz() table does not know
 */
const SAPKALI: Record<string, string> = { acirc: "â", Acirc: "Â", icirc: "î", Icirc: "Î", ucirc: "û", Ucirc: "Û" };
function sapkalilariCoz(html: string): string {
  return html.replace(/&([aiu]circ);/gi, (m, ad) => SAPKALI[ad] ?? m);
}

/** "ilan" = a new intake, "takip" = result / exam information of an earlier one */
export function duyuruTuru(baslik: string): "ilan" | "takip" {
  return TAKIP.test(sade(baslik)) ? "takip" : "ilan";
}

/** "4.11.2026" -> Date (UTC midnight) */
function tarihCoz(metin: string): Date | null {
  const m = metin.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const t = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return isNaN(t.getTime()) ? null : t;
}

/** Every row of the announcement table, in page order (newest first) */
export function listeyiAyikla(html: string): AdaletSatiri[] {
  // The side menu also links SayfaDetay pages; only the table rows are announcements
  const tablo = html.slice(Math.max(0, html.indexOf('id="example"')));
  const desen =
    /<a[^>]*href=['"]\/Home\/SayfaDetay\/([^'"]+)['"][^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>\s*(\d{1,2}\.\d{1,2}\.\d{4})?\s*<\/td>/g;
  const satirlar: AdaletSatiri[] = [];
  const gorulen = new Set<string>();
  for (const m of tablo.matchAll(desen)) {
    const kimlik = m[1].trim();
    if (gorulen.has(kimlik)) continue;
    gorulen.add(kimlik);
    // Titles arrive with mixed numeric entities ("S&#246;zleşmeli")
    const baslik = metneCevir(sapkalilariCoz(m[2])).replace(/\s+/g, " ").trim();
    if (!baslik) continue;
    satirlar.push({
      kimlik,
      baslik,
      url: `${SITE}/Home/SayfaDetay/${encodeURIComponent(kimlik)}`,
      tarih: m[3] ? tarihCoz(m[3]) : null,
    });
  }
  return satirlar;
}

/** Body text and PDF attachments of a detail page */
export function detayiAyikla(html: string): { metin: string; ekler: { ad: string; url: string }[] } {
  const bas = html.indexOf('class="icerik-yazi"');
  if (bas < 0) return { metin: "", ekler: [] };
  // The right-hand column ("Son Duyurular") follows the content; never read past it
  const sagSutun = html.indexOf('class="orta-sag"', bas);
  const icerik = html.slice(bas, sagSutun > 0 ? sagSutun : undefined);
  // The body ends where the attachment box or the result-query form (T.C. no + captcha) starts
  const son = [icerik.indexOf('class="haber-galeri"'), icerik.indexOf('id="sorgualan"')].filter((i) => i > 0);
  // The markers sit inside an opening <div …>; cut at that tag's "<" so no half tag leaks into the text
  const bitis = son.length ? icerik.lastIndexOf("<", Math.min(...son)) : icerik.length;
  const govde = sapkalilariCoz(icerik.slice(icerik.indexOf(">") + 1, bitis));

  const ekler: { ad: string; url: string }[] = [];
  for (const m of icerik.matchAll(/<a[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      // File names contain spaces, Turkish letters and entities ("Ek-1 &#220;nvan, sayı….pdf")
      const url = new URL(varliklariCoz(m[1]), SITE);
      if (url.hostname !== "pgm.adalet.gov.tr") continue;
      const ad = metneCevir(sapkalilariCoz(m[2])).replace(/\s+/g, " ").trim();
      if (!ekler.some((e) => e.url === url.href)) ekler.push({ ad: ad || "Ek", url: url.href });
    } catch {
      // A malformed link is not worth losing the announcement for
    }
  }
  return { metin: metniToparla(metneCevir(govde)), ekler };
}

export async function adaletTara(secenekler: AdaletSecenekleri = {}): Promise<{ ilanlar: HamIlan[]; gorulen: number }> {
  const { bilinenKimlikler = new Set<string>(), enEskiGun = 60, detaySiniri = 8 } = secenekler;
  const bugun = secenekler.bugun ?? new Date();
  const log = secenekler.log ?? (() => {});

  const satirlar = listeyiAyikla(await (await getir(`${SITE}/Home/TumHaberler/1`, {}, 60_000)).text());
  if (!satirlar.length) throw new Error("duyuru listesinde satır yok (yapı değişmiş olabilir)");

  const sinir = bugun.getTime() - enEskiGun * 86_400_000;
  // A row without a date cannot be placed in the window; the archive goes back to 2018, so it is skipped
  const yeni = satirlar.filter((s) => s.tarih && s.tarih.getTime() >= sinir);
  const uygun = yeni.filter((s) => alimDuyurusuMu(s.baslik));

  const ilanlar: HamIlan[] = [];
  let atlanan = 0;
  for (const s of uygun) {
    if (bilinenKimlikler.has(s.kimlik)) continue;
    // Failed rows count too: a site that is down must not get one request per matching row
    if (ilanlar.length + atlanan >= detaySiniri) break;

    const tur = duyuruTuru(s.baslik);
    let metin = "";
    let ekler: { ad: string; url: string }[] = [];
    let ekMetni = "";
    try {
      await nazikBekle();
      const d = detayiAyikla(await (await getir(s.url)).text());
      metin = d.metin;
      ekler = d.ekler;
      // Most intakes carry the full text in the page; some pages are two lines
      // pointing at an attached PDF, and then the PDF is the announcement
      if (metin.length < 800 && ekler.length) {
        await nazikBekle();
        ekMetni = await getir(ekler[0].url, {}, 60_000)
          .then((c) => c.arrayBuffer())
          .then(pdfMetni)
          .catch((e) => {
            log(`Adalet: ek okunamadı (${s.kimlik}): ${(e as Error).message}`);
            return "";
          });
      }
    } catch (e) {
      // Once a row is stored its id lands in bilinenKimlikler and the detail is
      // never requested again, so a timeout here would leave a rare intake with
      // a title-only score for good. Leaving the row out makes the next run retry it.
      log(`Adalet: detay okunamadı, sonraki taramada yeniden denenecek (${s.kimlik}): ${(e as Error).message}`);
      atlanan++;
      continue;
    }

    const aciklama = [
      // The scoring model must not treat a result notice as an open position
      tur === "takip"
        ? "Not: Bu duyuru yeni bir alım ilanı değildir; daha önce açılmış bir alımın takip duyurusudur (sonuç, itiraz, sınav bilgisi ya da kazananlardan istenen belgeler)."
        : "",
      metin,
      ekMetni ? `## Ek: ${ekler[0].ad}\n${ekMetni}` : "",
      ekler.length ? `Ekler: ${ekler.map((e) => e.ad).join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 12_000);

    ilanlar.push({
      kaynak: "adalet",
      kaynakId: s.kimlik,
      baslik: s.baslik,
      sirket: "Adalet Bakanlığı",
      aciklama: aciklama || undefined,
      url: s.url,
      yayinTarihi: s.tarih?.toISOString(),
      ham: { kimlik: s.kimlik, tur, ekSayisi: ekler.length, ekOkundu: Boolean(ekMetni) },
    });
  }

  log(
    `Adalet: ${satirlar.length} duyuru, son ${enEskiGun} günde ${yeni.length}, alımla ilgili ${uygun.length}` +
      (atlanan ? `, detayı okunamayan ${atlanan}` : "")
  );
  return { ilanlar, gorulen: yeni.length };
}
