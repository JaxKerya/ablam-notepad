// Yerel Yönetimler collector — yerelyonetimler.csb.gov.tr (Ministry of
// Environment, Urbanisation and Climate Change, General Directorate of Local
// Authorities).
//
// Municipalities publish their civil-servant and contract hiring here as
// "duyuru" pages whose URL ends in a stable numeric id (…-duyuru-478728).
// /duyurular only shows the latest 12 and ignores ?page=, so the list comes
// from sitemap.xml (advertised in robots.txt), which has every announcement
// with its date. The slug carries the province ("tokat-ili-tanoba-belediye-…")
// and the kind ("…-memur-alim-ilani", "…-iptal-ilani"), so the city and
// cancellation filters run before any detail request. The detail page has a
// one-paragraph summary; the real announcement (post, KPSS score type and
// minimum, requirements) is the attached DOCX, PDF or RTF.
// robots.txt allows everything except /uploads/, /system/ and similar
// (checked 10.11.2026); attachments live on webdosya.csb.gov.tr.

import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import { docxMetni, metniToparla, pdfMetni, rtfMetni } from "./belge";
import { getir, metneCevir, nazikBekle } from "./http";

const SITE = "https://yerelyonetimler.csb.gov.tr";

export interface YerelYonetimSecenekleri {
  /** Profile cities; empty = every province */
  sehirler?: string[];
  bilinenKimlikler: Set<string>;
  /** Announcements older than this are ignored (application windows are short) */
  enEskiGun?: number;
  /** Detail pages + attachments fetched per run */
  detaySiniri?: number;
  /** For tests: fixed "today" */
  bugun?: Date;
  log?: (mesaj: string) => void;
}

interface ListeOgesi {
  id: string;
  url: string;
  /** URL slug without the id: "tokat-ili-tanoba-belediye-…-memur-alim-ilani" */
  kisaAd: string;
  tarih: Date | null;
}

/** Every announcement in sitemap.xml, newest first */
export function haritayiAyikla(xml: string): ListeOgesi[] {
  const desen =
    /<loc>(https:\/\/yerelyonetimler\.csb\.gov\.tr\/([^<]*?)-duyuru-(\d+))<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g;
  const ogeler: ListeOgesi[] = [];
  for (const m of xml.matchAll(desen)) {
    // News items ("/haberler/…-duyuru-…") are articles, not announcements
    if (m[2].includes("/")) continue;
    const tarih = m[4] ? new Date(`${m[4].slice(0, 10)}T00:00:00Z`) : null;
    ogeler.push({ id: m[3], url: m[1], kisaAd: m[2], tarih: tarih && !isNaN(tarih.getTime()) ? tarih : null });
  }
  return ogeler.sort((a, b) => Number(b.id) - Number(a.id));
}

/** Hiring announcements only: cancellations, results and corrections are not jobs */
export function alimIlaniMi(kisaAd: string): boolean {
  if (/iptal|sonuc|duzeltme|erteleme|degisiklik|gorevde-yukselme/.test(kisaAd)) return false;
  return /alim|alin|atanmak|istihdam|personel/.test(kisaAd);
}

/**
 * "tokat-ili-tanoba-…" or "izmir-buyuksehir-belediye-…" -> "tokat" / "izmir"
 * (same form as sadelestir); other slugs give null (city unknown)
 */
export function ilKisaAdi(kisaAd: string): string | null {
  const m = kisaAd.match(/^([a-z]+(?:-[a-z]+)?)-(?:ili|buyuksehir)-/);
  return m ? m[1].replace(/-/g, " ") : null;
}

/** "TOKAT İLİ …" / "İZMİR BÜYÜKŞEHİR …" -> "Tokat" / "İzmir". \b does not work next to "İ" */
function ilAdi(baslik: string): string | null {
  const m = baslik.toLocaleUpperCase("tr").match(/^\s*([A-ZÇĞİÖŞÜ ]+?)\s+(?:İLİ|BÜYÜKŞEHİR)(?=\s|$)/);
  if (!m) return null;
  const ad = m[1].trim().toLocaleLowerCase("tr");
  return ad.charAt(0).toLocaleUpperCase("tr") + ad.slice(1);
}

/** Title, summary text and attachment links of a detail page */
async function detayOku(url: string): Promise<{ baslik: string; ozet: string; ekler: string[] }> {
  const html = await (await getir(url)).text();
  const baslik = metneCevir(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const govde = html.match(/<h1[\s\S]*?(?=Duyurulara geri d)/)?.[0] ?? "";
  const ekler = [...new Set([...govde.matchAll(/href="(https:\/\/webdosya\.csb\.gov\.tr\/[^"]+\.(?:docx?|pdf|rtf))"/gi)].map((m) => m[1]))]
    // The site-wide footer links a generic council document; only this announcement's files
    .filter((e) => !/\/dokumanlar\//.test(e));
  return { baslik, ozet: metniToparla(metneCevir(govde)), ekler };
}

async function ekMetni(url: string): Promise<string> {
  const veri = await (await getir(url, {}, 60_000)).arrayBuffer();
  // By content, not by extension: Word also saves RTF under a .doc name
  const bas = Buffer.from(veri.slice(0, 5)).toString("latin1");
  if (bas.startsWith("%PDF")) return pdfMetni(veri);
  if (bas.startsWith("PK")) return docxMetni(veri);
  if (bas.startsWith("{\\rtf")) return rtfMetni(veri);
  // Legacy binary .doc (OLE) has no parser here; the caller logs it
  throw new Error(`desteklenmeyen ek biçimi (${url.match(/\.\w+$/)?.[0] ?? "?"})`);
}

/**
 * Last day of the application window, "YYYY-MM-DD", or undefined.
 * Announcements state it as "… 16/12/2026-18/12/2026 tarihleri arasında …";
 * the sentence does not always say "başvurular" right before the dates
 * (Gaziosmanpaşa: "belgelerini 07/12/2026-11/12/2026 tarihleri arasında"), so
 * the word is only required nearby. Exam and objection dates use the same
 * date format, hence the strict rules: a range followed by "tarihleri
 * arasında", "başvur…" close to it, a sane window, and every such range
 * agreeing on the end date. Anything else returns undefined and the scoring
 * model's own reading stays in charge (measured 12.11.2026).
 */
export function sonBasvuruBul(metin: string, yayin?: Date | null): string | undefined {
  const desen =
    /(\d{1,2})[./](\d{1,2})[./](20\d{2})\s*(?:[-–—]|ile|ila|ve)?\s*(\d{1,2})[./](\d{1,2})[./](20\d{2})\s+tarihleri\s+aras[ıi]nda/gi;
  const gun = (g: string, a: string, y: string) => {
    const t = new Date(Date.UTC(Number(y), Number(a) - 1, Number(g)));
    // Date.UTC rolls 31/02 over to March; such a date is a typo, not a deadline
    return t.getUTCDate() === Number(g) && t.getUTCMonth() === Number(a) - 1 ? t : null;
  };
  const bitisler = new Set<string>();
  for (const m of metin.matchAll(desen)) {
    const cevre = metin.slice(Math.max(0, m.index - 250), m.index + m[0].length + 120);
    if (!/başvur/i.test(cevre)) continue;
    const bas = gun(m[1], m[2], m[3]);
    const bit = gun(m[4], m[5], m[6]);
    if (!bas || !bit) return undefined;
    const sure = (bit.getTime() - bas.getTime()) / 86_400_000;
    if (sure < 0 || sure > 45) return undefined;
    // An application window far from the publication date is some other range
    if (yayin && Math.abs(bit.getTime() - yayin.getTime()) > 120 * 86_400_000) return undefined;
    bitisler.add(bit.toISOString().slice(0, 10));
  }
  return bitisler.size === 1 ? [...bitisler][0] : undefined;
}

export async function yerelYonetimTara(secenekler: YerelYonetimSecenekleri) {
  const { sehirler = [], bilinenKimlikler, enEskiGun = 30, detaySiniri = 15 } = secenekler;
  const bugun = secenekler.bugun ?? new Date();
  const log = secenekler.log ?? (() => {});
  const istenen = sehirler.map(sadelestir);

  const harita = haritayiAyikla(await (await getir(`${SITE}/sitemap.xml`)).text());
  if (!harita.length) throw new Error("site haritasında duyuru yok (yapı değişmiş olabilir)");
  const sinir = bugun.getTime() - enEskiGun * 86_400_000;
  const liste = harita.filter((o) => !o.tarih || o.tarih.getTime() >= sinir);

  const ilanlar: HamIlan[] = [];
  let sehirDisi = 0;
  for (const o of liste) {
    if (bilinenKimlikler.has(o.id) || !alimIlaniMi(o.kisaAd)) continue;
    const il = ilKisaAdi(o.kisaAd);
    if (istenen.length && il && !istenen.includes(il)) {
      sehirDisi++;
      continue;
    }
    if (ilanlar.length >= detaySiniri) break;

    let baslik = "";
    let ozet = "";
    const ekMetinleri: string[] = [];
    let ekVar = false;
    let detayOkundu = false;
    try {
      await nazikBekle();
      const d = await detayOku(o.url);
      baslik = d.baslik;
      ozet = d.ozet;
      detayOkundu = true;
      ekVar = d.ekler.length > 0;
      for (const ek of d.ekler.slice(0, 2)) {
        await nazikBekle();
        const metin = await ekMetni(ek).catch((e) => {
          log(`Yerel Yönetimler: ek okunamadı (${o.id}): ${(e as Error).message}`);
          return "";
        });
        if (metin) ekMetinleri.push(`## İlan metni\n${metin}`);
      }
    } catch (e) {
      log(`Yerel Yönetimler: detay okunamadı (${o.id}): ${(e as Error).message}`);
    }
    // The summary alone never names the post or the education requirement, so
    // such an announcement is scored blind; make that visible in the run log
    if (detayOkundu && !ekMetinleri.length) {
      log(`Yerel Yönetimler: ilan metni yok, yalnızca özet (${o.id}): ${ekVar ? "ek okunamadı" : "sayfada okunabilir ek yok"}`);
    }
    // Attachment first: if the model's input is cut, the summary goes, not the requirements
    const aciklama = [...ekMetinleri, ozet].filter(Boolean).join("\n\n").slice(0, 12_000);
    // Without the detail page the slug is the only title there is
    const gosterilen = baslik || o.kisaAd.replace(/-/g, " ").toLocaleUpperCase("tr");

    ilanlar.push({
      kaynak: "yerelyonetim",
      kaynakId: o.id,
      baslik: gosterilen,
      sirket: gosterilen.match(/^(?:.+?\s+İLİ\s+)?(.+?(?:BELEDİYE(?:Sİ| BAŞKANLIĞI)?|İL ÖZEL İDARESİ|BİRLİĞİ))/)?.[1]?.trim(),
      sehir: ilAdi(gosterilen) ?? undefined,
      aciklama: aciklama || undefined,
      url: o.url,
      yayinTarihi: o.tarih?.toISOString(),
      sonBasvuru: sonBasvuruBul(ekMetinleri.join("\n"), o.tarih),
      ham: { id: o.id, ekSayisi: ekMetinleri.length },
    });
  }

  if (sehirDisi) log(`Yerel Yönetimler: ${sehirDisi} ilan ${sehirler.join("/")} dışında, atlandı`);
  return { ilanlar, gorulen: liste.length };
}
