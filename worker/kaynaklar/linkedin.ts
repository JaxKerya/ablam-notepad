// LinkedIn toplayıcı — girişsiz "guest" uç noktaları.
//
// Resmî API yok; LinkedIn'in kendi giriş yapmamış ziyaretçi sayfasının
// arkasındaki HTML parçası kullanılıyor:
//   GET /jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=&location=&f_TPR=&start=
//   GET /jobs-guest/jobs/api/jobPosting/<id>
// Tarayıcı gerekmiyor, düz HTTP. Ankara'da 3D/oyun ilanlarını taşıyan tek
// kaynak bu (İŞKUR ve Careerjet'te yok) — o yüzden var.
//
// Bilinen riskler, bilerek kabul edildi:
// - Kullanım şartlarına aykırı. Kişisel, tek kullanıcı, düşük hacim.
// - Engellenirse 429 ya da 999 döner; hata fırlatılır, üç koşu sonra uyarı
//   e-postası gider (worker/bildir.ts). Sessiz kırılma yok.
// - Sayfa yapısı değişirse kart ayrıştırıcı boş döner; "0 kart" da hata sayılır.
// Hacmi düşük tutmak için: kaynak günde iki kez taranır (ana.ts'te aralık),
// her istek arası 1,5–3,5 sn beklenir, koşu başına en fazla 20 detay okunur.

import type { HamIlan } from "../../lib/kariyer";
import { getir, metneCevir, nazikBekle, varliklariCoz } from "./http";

const ARAMA = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const DETAY = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting";
const SON_GUNLER = "r2592000"; // 30 gün — bilinenler zaten atlanıyor, geniş tutmak bedava
const SAYFA_SINIRI = 2; // terim başına 2 x 10 kart

export interface LinkedinSecenekleri {
  aramaTerimleri: string[];
  /** Profildeki şehirler; boşsa "Türkiye". Her şehir ayrı arama. */
  sehirler?: string[];
  bilinenKimlikler: Set<string>;
  detaySiniri?: number;
  log?: (mesaj: string) => void;
}

interface Kart {
  kimlik: string;
  baslik: string;
  sirket: string;
  sehir: string;
  tarih: string;
  url: string;
}

const temiz = (s: string) => varliklariCoz(s).replace(/\s+/g, " ").trim();

/** Arama cevabındaki <li> kartlarını ayrıştırır. Yapı değişirse boş döner. */
export function kartlariAyristir(html: string): Kart[] {
  const kartlar: Kart[] = [];
  const parcalar = html.split(/<li[\s>]/).slice(1);
  for (const p of parcalar) {
    const kimlik = p.match(/urn:li:jobPosting:(\d+)/)?.[1];
    const baslik = p.match(/base-search-card__title[^>]*>\s*([\s\S]*?)\s*<\/h3>/)?.[1];
    if (!kimlik || !baslik) continue;
    const sirket = p.match(/base-search-card__subtitle[\s\S]*?<a[^>]*>\s*([\s\S]*?)\s*<\/a>/)?.[1] ?? "";
    const sehir = p.match(/job-search-card__location[^>]*>\s*([\s\S]*?)\s*<\/span>/)?.[1] ?? "";
    const tarih = p.match(/datetime="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? "";
    const hamUrl = p.match(/base-card__full-link[^>]*href="([^"]+)"/)?.[1] ?? "";
    kartlar.push({
      kimlik,
      baslik: temiz(baslik),
      sirket: temiz(sirket),
      sehir: temiz(sehir),
      tarih,
      url: hamUrl ? varliklariCoz(hamUrl).split("?")[0] : `https://www.linkedin.com/jobs/view/${kimlik}`,
    });
  }
  return kartlar;
}

/** Detay sayfasından açıklama + kriterler (kıdem, çalışma şekli, sektör) */
export function detayiAyristir(html: string): string | null {
  const govde = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1];
  if (!govde) return null;
  const kriterler = [...html.matchAll(/description__job-criteria-subheader[^>]*>\s*([^<]+?)\s*<[\s\S]*?description__job-criteria-text[^>]*>\s*([^<]+?)\s*</g)]
    .map((m) => `${temiz(m[1])}: ${temiz(m[2])}`);
  const metin = metneCevir(govde).slice(0, 10_000);
  return kriterler.length ? `${metin}\n\n${kriterler.join("\n")}` : metin;
}

async function ara(terim: string, konum: string, baslangic: number): Promise<Kart[]> {
  const url = new URL(ARAMA);
  url.searchParams.set("keywords", terim);
  url.searchParams.set("location", konum);
  url.searchParams.set("f_TPR", SON_GUNLER);
  url.searchParams.set("start", String(baslangic));
  const cevap = await getir(url.toString());
  return kartlariAyristir(await cevap.text());
}

export async function linkedinTara(secenekler: LinkedinSecenekleri) {
  const { aramaTerimleri, sehirler = [], bilinenKimlikler, detaySiniri = 20 } = secenekler;
  const log = secenekler.log ?? (() => {});
  const konumlar = sehirler.length ? sehirler.map((s) => `${s}, Türkiye`) : ["Türkiye"];
  const aramalar = konumlar.flatMap((konum) => aramaTerimleri.map((terim) => ({ terim, konum })));

  const kartlar = new Map<string, Kart>();
  const hatalar: string[] = [];
  let bosCevap = 0;

  for (const { terim, konum } of aramalar) {
    try {
      for (let sayfa = 0; sayfa < SAYFA_SINIRI; sayfa++) {
        const bulunan = await ara(terim, konum, sayfa * 10);
        if (!bulunan.length) {
          if (sayfa === 0) bosCevap++;
          break;
        }
        for (const k of bulunan) kartlar.set(k.kimlik, k);
        if (bulunan.length < 10) break;
        await nazikBekle();
      }
    } catch (e) {
      hatalar.push(`${terim}: ${(e as Error).message}`);
      log(`LinkedIn "${terim}" düştü: ${(e as Error).message}`);
    }
    await nazikBekle();
  }

  // Bütün terimler düştüyse ya da hepsi boşsa kaynak kırılmış demektir —
  // "0 ilan" diye sessizce geçilmesin.
  if (aramalar.length && hatalar.length === aramalar.length) throw new Error(`her terim düştü — ${hatalar[0]}`);
  if (aramalar.length && bosCevap === aramalar.length) {
    throw new Error("her arama 0 kart döndü — sayfa yapısı değişmiş ya da engellenmiş olabilir");
  }

  const ilanlar: HamIlan[] = [];
  for (const k of kartlar.values()) {
    if (bilinenKimlikler.has(k.kimlik)) continue;
    if (ilanlar.length >= detaySiniri) break;

    let aciklama: string | null = null;
    try {
      const cevap = await getir(`${DETAY}/${k.kimlik}`);
      aciklama = detayiAyristir(await cevap.text());
    } catch (e) {
      log(`LinkedIn detay okunamadı (${k.kimlik}): ${(e as Error).message}`);
    }
    ilanlar.push({
      kaynak: "linkedin",
      kaynakId: k.kimlik,
      baslik: k.baslik,
      sirket: k.sirket || undefined,
      sehir: k.sehir || undefined,
      aciklama: aciklama ?? undefined,
      url: k.url,
      yayinTarihi: k.tarih || undefined,
      ham: k,
    });
    await nazikBekle();
  }

  return { ilanlar, gorulen: kartlar.size };
}
