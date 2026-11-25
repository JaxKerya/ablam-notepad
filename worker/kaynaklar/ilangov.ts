// ilan.gov.tr toplayıcı — Basın İlan Kurumu'nun resmî portalı.
//
// Kamu personel alımları (DPB, YÖK, belediyeler, bakanlıklar) burada tek
// yerde ve Resmî Gazete ile aynı gün yayınlanıyor. Kariyer Kapısı ve
// memurlar.net aynı havuzdan besleniyor; onları ayrıca taramaya gerek yok.
//
// Sayfa Angular; listeyi ve ilan metnini kendi JSON servisinden alıyor:
//   POST /api/api/services/app/Ad/AdsByFilter   liste + şehir sayaçları
//   GET  /api/api/services/app/AdDetail/GetAdDetail?id=…   ilan metni (HTML)
// Since 24.09.2026 that service answers only the site's own pages (HTTP 403 to a
// plain client), so the adapter opens the public pages in a real browser, the way
// iskur.ts does, and reads the answers the page itself receives. No headers are
// forged and nothing is solved or bypassed; robots.txt allows everything but
// /tebligat. One page view per list page and per new ad, with a polite pause.
// Filtre anahtarları sayfa adresinde: ats=5 personel alımı, aci=şehir kimliği,
// currentPage=sayfa. Şehir kimliği sabit değil, ilk cevabın cityCounts alanından
// ada bakarak bulunuyor; aci tek değer işlediği için şehir başına ayrı gezilir.
//
// Arama terimi kullanılmıyor: kamu ilanı zaten az (Ankara'da ~25 aktif),
// "sözleşmeli personel alım ilanı" başlığından ne aradığı anlaşılmıyor,
// hangisinin uyduğuna model karar veriyor. Yalnızca yeni ilanın metni çekilir.

import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import type { Page } from "playwright";
import { metneCevir, nazikBekle } from "./http";
import { tarayiciAc } from "./iskur";

const SITE = "https://www.ilan.gov.tr";
const PERSONEL_ALIMI = 5;
const SAYFA_SINIRI = 20; // the site's own pages carry 12 ads each; ~120 ads without a city filter

/**
 * Başlığından işe yaramadığı belli olanlar: modele gitmesin, para gitmesin.
 * sadelestir ile bakılıyor — "İ" harfi JS regex'inin /i bayrağıyla eşleşmiyor.
 */
const gereksizMi = (baslik: string) =>
  /\b(iptal|duzeltme) ilan|ogretim (uyesi|elemani|gorevlisi)|arastirma gorevlisi|akademik personel/.test(sadelestir(baslik));

export interface IlangovSecenekleri {
  /** Profildeki şehirler; boşsa bütün iller */
  sehirler?: string[];
  bilinenKimlikler: Set<string>;
  detaySiniri?: number;
  log?: (mesaj: string) => void;
}

interface ListeKaydi {
  id: string;
  title: string;
  advertiserName: string;
  addressCityName: string | null;
  publishStartDate: string | null;
  urlStr: string;
}

interface ListeCevabi {
  result: {
    ads: ListeKaydi[];
    cityCounts: { id: number; key: string; count: number }[] | null;
    numFound: number;
  };
}

const YANIT_SURESI = 45_000;

/** Opens a public page and returns the JSON its own script receives from `servis`. */
async function sayfaVerisi<T>(sayfa: Page, adres: string, servis: string): Promise<T> {
  const [yanit] = await Promise.all([
    sayfa.waitForResponse((r) => r.url().includes(servis) && r.request().method() !== "OPTIONS", { timeout: YANIT_SURESI }),
    sayfa.goto(adres, { waitUntil: "domcontentloaded", timeout: YANIT_SURESI }),
  ]);
  if (!yanit.ok()) throw new Error(`HTTP ${yanit.status()} — ${servis}`);
  return (await yanit.json()) as T;
}

async function listeAl(tarayiciSayfasi: Page, sayfa: number, sehirKimligi: number | null): Promise<ListeCevabi["result"]> {
  const sorgu = new URLSearchParams({ ats: String(PERSONEL_ALIMI), currentPage: String(sayfa) });
  if (sehirKimligi) sorgu.set("aci", String(sehirKimligi));
  const veri = await sayfaVerisi<ListeCevabi>(tarayiciSayfasi, `${SITE}/ilan/tum-ilanlar/personel-alimi?${sorgu}`, "/Ad/AdsByFilter");
  if (!veri?.result || !Array.isArray(veri.result.ads)) {
    throw new Error("liste cevabı beklenen biçimde değil (site değişmiş olabilir)");
  }
  return veri.result;
}

/** Şehir adları -> ilan.gov.tr kimlikleri. Sayaçlarda olmayan şehirde aktif ilan yok demek, atlanır. */
function sehirKimlikleriBul(sayaclar: ListeCevabi["result"]["cityCounts"], sehirler: string[]): number[] {
  return sehirler
    .map((s) => sayaclar?.find((c) => sadelestir(c.key) === sadelestir(s))?.id)
    .filter((id): id is number => typeof id === "number");
}

async function detayAl(tarayiciSayfasi: Page, k: ListeKaydi): Promise<string | null> {
  const veri = await sayfaVerisi<{ result?: { content?: string | null } }>(tarayiciSayfasi, `${SITE}${k.urlStr}`, "/AdDetail/GetAdDetail");
  const html = veri?.result?.content;
  return html ? metneCevir(html).slice(0, 12_000) : null;
}

export async function ilangovTara(secenekler: IlangovSecenekleri) {
  const { sehirler = [], bilinenKimlikler, detaySiniri = 80 } = secenekler;
  const log = secenekler.log ?? (() => {});

  const tarayici = await tarayiciAc();
  try {
    const sayfa = await (await tarayici.newContext({ locale: "tr-TR" })).newPage();
    return await tara(sayfa, sehirler, bilinenKimlikler, detaySiniri, log);
  } finally {
    await tarayici.close().catch(() => {});
  }
}

async function tara(
  tarayiciSayfasi: Page,
  sehirler: string[],
  bilinenKimlikler: Set<string>,
  detaySiniri: number,
  log: (mesaj: string) => void
) {
  // İlk sayfa filtresiz: hem şehir kimliklerini verir hem şehir yoksa 1. sayfadır
  const ilk = await listeAl(tarayiciSayfasi, 1, null);
  let sehirKimlikleri: (number | null)[] = [null];
  if (sehirler.length) {
    sehirKimlikleri = sehirKimlikleriBul(ilk.cityCounts, sehirler);
    if (!sehirKimlikleri.length) {
      log(`ilan.gov.tr: ${sehirler.join(", ")} için aktif personel ilanı yok`);
      return { ilanlar: [] as HamIlan[], gorulen: 0 };
    }
  }

  const kayitlar = new Map<string, ListeKaydi>();
  for (const kimlik of sehirKimlikleri) {
    for (let sayfa = 1; sayfa <= SAYFA_SINIRI; sayfa++) {
      const sonuc = sayfa === 1 && kimlik === null ? ilk : await listeAl(tarayiciSayfasi, sayfa, kimlik);
      for (const k of sonuc.ads) kayitlar.set(String(k.id), k);
      // Page size is the site's choice, so stop on an empty page or once the last page is read
      if (!sonuc.ads.length || sayfa * sonuc.ads.length >= sonuc.numFound) break;
      await nazikBekle();
    }
  }

  const ilanlar: HamIlan[] = [];
  let atlanan = 0;
  for (const k of kayitlar.values()) {
    if (bilinenKimlikler.has(String(k.id))) continue;
    if (gereksizMi(k.title)) {
      atlanan++;
      continue;
    }
    if (ilanlar.length >= detaySiniri) break;

    let aciklama: string | null = null;
    try {
      aciklama = await detayAl(tarayiciSayfasi, k);
    } catch (e) {
      log(`ilan.gov.tr detay okunamadı (${k.id}): ${(e as Error).message}`);
    }
    ilanlar.push({
      kaynak: "ilangov",
      kaynakId: String(k.id),
      baslik: k.title.trim(),
      sirket: k.advertiserName?.trim() || undefined,
      sehir: k.addressCityName?.trim() || undefined,
      aciklama: aciklama ?? undefined,
      url: `${SITE}${k.urlStr}`,
      yayinTarihi: k.publishStartDate ?? undefined,
      ham: k,
    });
    await nazikBekle();
  }

  if (atlanan) log(`ilan.gov.tr: ${atlanan} iptal/düzeltme ya da akademik ilan atlandı`);
  return { ilanlar, gorulen: kayitlar.size };
}
