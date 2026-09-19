// ilan.gov.tr toplayıcı — Basın İlan Kurumu'nun resmî portalı.
//
// Kamu personel alımları (DPB, YÖK, belediyeler, bakanlıklar) burada tek
// yerde ve Resmî Gazete ile aynı gün yayınlanıyor. Kariyer Kapısı ve
// memurlar.net aynı havuzdan besleniyor; onları ayrıca taramaya gerek yok.
//
// Sayfa Angular ama arkasında düz bir JSON API var (tarayıcı gerekmiyor):
//   POST /api/api/services/app/Ad/AdsByFilter   liste + şehir sayaçları
//   GET  /api/api/services/app/AdDetail/GetAdDetail?id=…   ilan metni (HTML)
// Filtre anahtarları sitenin URL'sindekiyle aynı: ats=5 personel alımı,
// aci=[şehir kimliği]. Kimlik sabit değil, ilk cevabın cityCounts alanından
// ada bakarak bulunuyor. keys dizi alıyor ama aci'de yalnızca ilk eleman
// işleniyor (denendi: [Ankara, İstanbul] -> yalnız Ankara); şehir başına ayrı
// istek dizisi atılıyor.
//
// Arama terimi kullanılmıyor: kamu ilanı zaten az (Ankara'da ~25 aktif),
// "sözleşmeli personel alım ilanı" başlığından ne aradığı anlaşılmıyor,
// hangisinin uyduğuna model karar veriyor. Yalnızca yeni ilanın metni çekilir.

import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import { getir, metneCevir, nazikBekle } from "./http";

const API = "https://www.ilan.gov.tr/api/api/services/app";
const SITE = "https://www.ilan.gov.tr";
const PERSONEL_ALIMI = 5;
const SAYFA_BOYU = 20; // sunucu daha fazlasını vermiyor (50 istersen 20 döner)
const SAYFA_SINIRI = 10; // şehir filtresi yokken ~190 ilan

/**
 * Başlığından işe yaramadığı belli olanlar: modele gitmesin, para gitmesin.
 * sadelestir ile bakılıyor — "İ" harfi JS regex'inin /i bayrağıyla eşleşmiyor.
 */
const gereksizMi = (baslik: string) => /\b(iptal|duzeltme) ilan/.test(sadelestir(baslik));

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

async function listeAl(sayfa: number, sehirKimligi: number | null): Promise<ListeCevabi["result"]> {
  const keys: Record<string, number[]> = { ats: [PERSONEL_ALIMI], currentPage: [sayfa] };
  if (sehirKimligi) keys.aci = [sehirKimligi];
  const cevap = await getir(`${API}/Ad/AdsByFilter`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ keys, skipCount: (sayfa - 1) * SAYFA_BOYU, maxResultCount: SAYFA_BOYU }),
  });
  const veri = (await cevap.json()) as ListeCevabi;
  if (!veri?.result || !Array.isArray(veri.result.ads)) {
    throw new Error("liste cevabı beklenen biçimde değil (API değişmiş olabilir)");
  }
  return veri.result;
}

/** Şehir adları -> ilan.gov.tr kimlikleri. Sayaçlarda olmayan şehirde aktif ilan yok demek, atlanır. */
function sehirKimlikleriBul(sayaclar: ListeCevabi["result"]["cityCounts"], sehirler: string[]): number[] {
  return sehirler
    .map((s) => sayaclar?.find((c) => sadelestir(c.key) === sadelestir(s))?.id)
    .filter((id): id is number => typeof id === "number");
}

async function detayAl(id: string): Promise<string | null> {
  const cevap = await getir(`${API}/AdDetail/GetAdDetail?id=${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" },
  });
  const veri = (await cevap.json()) as { result?: { content?: string | null } };
  const html = veri?.result?.content;
  return html ? metneCevir(html).slice(0, 12_000) : null;
}

export async function ilangovTara(secenekler: IlangovSecenekleri) {
  const { sehirler = [], bilinenKimlikler, detaySiniri = 80 } = secenekler;
  const log = secenekler.log ?? (() => {});

  // İlk sayfa filtresiz: hem şehir kimliklerini verir hem şehir yoksa 1. sayfadır
  const ilk = await listeAl(1, null);
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
      const sonuc = sayfa === 1 && kimlik === null ? ilk : await listeAl(sayfa, kimlik);
      for (const k of sonuc.ads) kayitlar.set(String(k.id), k);
      if (sonuc.ads.length < SAYFA_BOYU) break;
      await nazikBekle();
    }
  }

  const ilanlar: HamIlan[] = [];
  let atlanan = 0;
  for (const k of kayitlar.values()) {
    if (bilinenKimlikler.has(k.id)) continue;
    if (gereksizMi(k.title)) {
      atlanan++;
      continue;
    }
    if (ilanlar.length >= detaySiniri) break;

    let aciklama: string | null = null;
    try {
      aciklama = await detayAl(k.id);
    } catch (e) {
      log(`ilan.gov.tr detay okunamadı (${k.id}): ${(e as Error).message}`);
    }
    ilanlar.push({
      kaynak: "ilangov",
      kaynakId: k.id,
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

  if (atlanan) log(`ilan.gov.tr: ${atlanan} iptal/düzeltme ilanı atlandı`);
  return { ilanlar, gorulen: kayitlar.size };
}
