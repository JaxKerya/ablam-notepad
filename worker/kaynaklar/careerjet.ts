// Careerjet toplayıcı — resmî yayıncı API'si (ücretsiz, anahtar yayıncı hesabından).
//
// Belge: https://www.careerjet.com.tr/partners/api
//   GET https://search.api.careerjet.net/v4/query
//   Authorization: Basic base64("<anahtar>:")   (parola boş)
//   locale_code=tr_TR, keywords, location, sort=date, page_size<=100,
//   user_ip ve user_agent zorunlu (yoksa 403). Ayrıca iki şart daha var,
//   belgede yazmıyor, 403 gövdesinden öğrenildi: çağıran IP yayıncı hesabında
//   yetkili olmalı ("Unauthorized access from IP …") ve istek bir Referer
//   başlığı taşımalı ("Undeclared referrer") — içeriği denetlenmiyor.
// Cevap: { type: "JOBS", hits, pages, jobs: [{ title, company, date,
//          description (özet), locations, salary, url }] }
// type "LOCATIONS" gelirse konum bulunamamış ya da birden fazla eşleşmiş;
// ilk öneriyle bir kez daha deneniyor.
//
// Bu profil için kapsamı ince (Ankara "animatör" = 1 ilan) ama bedava ve
// sağlam; kariyer.net/yenibiris gibi Türk sitelerini dolaylı tarıyor.

import { createHash } from "node:crypto";
import type { HamIlan } from "../../lib/kariyer";
import { getir, metneCevir, nazikBekle } from "./http";

/**
 * Careerjet ilanının kimliği İÇERİKTEN türetilir, URL'den değil.
 *
 * API'nin "url" alanı her istekte farklı bir takip bağlantısıdır
 * (jobviewtrack.com/v2/<rastgele>); aynı ilan her aramada yeni URL ile gelir.
 * Kimlik URL olunca her saatlik tarama bütün ilanları "yeni" saydı: 95 ilan
 * için 858 satır, hepsi ayrı ayrı puanlandı (20.09.2026'da bulundu). "date"
 * de sabit değil (37/95 grupta değişmişti), "description" arama terimine göre
 * vurgulanan parça. Başlık + şirket + konum kalıyor; aynı şirketin aynı
 * şehirdeki aynı başlıklı iki ilanı tek sayılır, bu kabul edilebilir.
 * Yönlendirmeyi izleyip gerçek jobad kimliğini almak mümkün ama her ilan için
 * yayıncı hesabına tıklama yazar; o yola girilmedi.
 */
function careerjetKimlik(j: CareerjetIlani): string {
  const sade = (v?: string) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const ozet = [sade(j.title), sade(j.company), sade(j.locations)].join("|");
  return "cj_" + createHash("sha1").update(ozet).digest("hex").slice(0, 24);
}

const UC_NOKTA = "https://search.api.careerjet.net/v4/query";

export interface CareerjetSecenekleri {
  aramaTerimleri: string[];
  /** Boşsa ülke geneli. Her şehir ayrı sorgu. */
  sehirler?: string[];
  /** Daha önce kaydedilmiş kimlikler (url) — "yeni" sayısı doğru çıksın diye elenir */
  bilinenKimlikler?: Set<string>;
  log?: (mesaj: string) => void;
}

interface CareerjetIlani {
  title?: string;
  company?: string;
  date?: string;
  description?: string;
  locations?: string;
  salary?: string;
  url?: string;
}

interface CareerjetCevabi {
  type?: "JOBS" | "LOCATIONS";
  hits?: number;
  message?: string;
  jobs?: CareerjetIlani[];
  locations?: string[];
}

export const careerjetHazir = () => (process.env.CAREERJET_API_KEY ? null : "CAREERJET_API_KEY yok");

async function sorgula(anahtar: string, terim: string, konum: string): Promise<CareerjetCevabi> {
  const url = new URL(UC_NOKTA);
  url.searchParams.set("locale_code", "tr_TR");
  url.searchParams.set("keywords", terim);
  if (konum) url.searchParams.set("location", konum);
  url.searchParams.set("sort", "date");
  url.searchParams.set("page_size", "100"); // API'nin üst sınırı
  url.searchParams.set("fragment_size", "600");
  url.searchParams.set("user_ip", process.env.CAREERJET_USER_IP || "127.0.0.1");
  url.searchParams.set("user_agent", "AblamKariyer/1.0");
  const cevap = await getir(url.toString(), {
    headers: {
      authorization: `Basic ${Buffer.from(`${anahtar}:`).toString("base64")}`,
      accept: "application/json",
      referer: process.env.CAREERJET_SITE || "https://ablam-is.example/",
    },
  });
  return (await cevap.json()) as CareerjetCevabi;
}

export async function careerjetTara(secenekler: CareerjetSecenekleri) {
  const { aramaTerimleri, sehirler = [], bilinenKimlikler = new Set<string>() } = secenekler;
  const log = secenekler.log ?? (() => {});
  const anahtar = process.env.CAREERJET_API_KEY;
  if (!anahtar) throw new Error("CAREERJET_API_KEY tanımlı değil");

  const toplanan = new Map<string, HamIlan>();
  const gorulen = new Set<string>();
  const hatalar: string[] = [];
  // Şehir Careerjet'e verilmiyor: keywords + location birlikte gelince çok kelimeli
  // terimlerde API 0 döndürüyor ("büro personeli" TR geneli 44, Ankara 0 — 19.09.2026'da
  // ölçüldü; 33 sorgu × 0 sonuçla bir gece geçti). Türkiye geneli çekilip şehir elemesi
  // sertFiltre'ye (ilanın locations alanı) bırakılıyor. sehirler yalnız log için.
  void sehirler;
  const aramalar = aramaTerimleri.map((terim) => ({ terim, sehir: "" }));

  for (const { terim, sehir } of aramalar) {
    try {
      let veri = await sorgula(anahtar, terim, sehir);
      if (veri.type === "LOCATIONS" && veri.locations?.length) {
        log(`Careerjet konum belirsiz (${sehir}), "${veri.locations[0]}" deneniyor`);
        veri = await sorgula(anahtar, terim, veri.locations[0]);
      }
      if (veri.type !== "JOBS" || !Array.isArray(veri.jobs)) {
        throw new Error(veri.message || "cevapta 'jobs' yok (API değişmiş olabilir)");
      }
      for (const j of veri.jobs) {
        if (!j.title || !j.url) continue;
        const kimlik = careerjetKimlik(j);
        gorulen.add(kimlik);
        if (bilinenKimlikler.has(kimlik) || toplanan.has(kimlik)) continue;
        const zaman = j.date ? Date.parse(j.date) : NaN; // "Wed,15 Nov 2025 19:13:43 GMT"
        toplanan.set(kimlik, {
          kaynak: "careerjet",
          kaynakId: kimlik,
          baslik: j.title.trim(),
          sirket: j.company?.trim() || undefined,
          sehir: j.locations?.trim() || undefined,
          aciklama: j.description ? metneCevir(j.description) : undefined,
          maas: j.salary?.trim() || undefined,
          url: j.url,
          yayinTarihi: Number.isNaN(zaman) ? undefined : new Date(zaman).toISOString(),
          ham: j,
        });
      }
    } catch (e) {
      hatalar.push(`${terim}: ${(e as Error).message}`);
      log(`Careerjet "${terim}" düştü: ${(e as Error).message}`);
    }
    await nazikBekle();
  }

  if (aramalar.length && hatalar.length === aramalar.length) {
    throw new Error(`her terim düştü — ${hatalar[0]}`);
  }
  return { ilanlar: [...toplanan.values()], gorulen: gorulen.size };
}
