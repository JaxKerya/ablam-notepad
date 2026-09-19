// Jooble toplayıcı — resmî REST API (ücretsiz, anahtar formla alınıyor).
//
// Anahtar: https://tr.jooble.org/api/about  (ad, pozisyon, e-posta, site, telefon)
// Türkiye anahtarı tr.jooble.org'a bağlı; başka ülke alt alanından alınan
// anahtar Türkçe ilan döndürmez. JOOBLE_API_URL ile değiştirilebilir.
//
//   POST https://tr.jooble.org/api/<anahtar>   {"keywords","location","page"}
//   -> { totalCount, jobs: [{ id, title, location, snippet, salary, source,
//        type, link, company, updated }] }
//
// Cevap biçimi Jooble'ın belgelerinde değil, yaygın kullanımdan biliniyor;
// alanlar gelmezse hata fırlatılıyor ki fark edelim. Detay sayfası yok —
// snippet neyse o; açıklama kısa kalırsa model "açıklama yok" kuralıyla
// (en fazla 80 puan) davranıyor.

import type { HamIlan } from "../../lib/kariyer";
import { getir, metneCevir, nazikBekle } from "./http";

export interface JoobleSecenekleri {
  aramaTerimleri: string[];
  /** Boşsa ülke geneli. Her şehir ayrı sorgu. */
  sehirler?: string[];
  /** Daha önce kaydedilmiş kimlikler — "yeni" sayısı doğru çıksın diye elenir */
  bilinenKimlikler?: Set<string>;
  log?: (mesaj: string) => void;
}

interface JoobleIlani {
  id?: number | string;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
}

/** Anahtar yoksa kaynak hiç koşmaz; sebep loga düşer */
export const joobleHazir = () => (process.env.JOOBLE_API_KEY ? null : "JOOBLE_API_KEY yok");

export async function joobleTara(secenekler: JoobleSecenekleri) {
  const { aramaTerimleri, sehirler = [], bilinenKimlikler = new Set<string>() } = secenekler;
  const log = secenekler.log ?? (() => {});
  const anahtar = process.env.JOOBLE_API_KEY;
  if (!anahtar) throw new Error("JOOBLE_API_KEY tanımlı değil");
  const taban = (process.env.JOOBLE_API_URL || "https://tr.jooble.org/api/").replace(/\/?$/, "/");

  const toplanan = new Map<string, HamIlan>();
  const gorulen = new Set<string>();
  const hatalar: string[] = [];
  const aramalar = (sehirler.length ? sehirler : [""]).flatMap((sehir) => aramaTerimleri.map((terim) => ({ terim, sehir })));

  // Terim başına 3 sayfa (~20'şer): büyük şehirde ilk sayfa havuzun küçük bir kısmı.
  // Sayfa yeni kimlik getirmiyorsa durulur — bilinenler tekrar tekrar çekilmesin.
  const SAYFA_SINIRI = 3;
  for (const { terim, sehir } of aramalar) {
    try {
      for (let sayfa = 1; sayfa <= SAYFA_SINIRI; sayfa++) {
        const cevap = await getir(`${taban}${anahtar}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ keywords: terim, location: sehir, page: sayfa }),
        });
        const veri = (await cevap.json()) as { totalCount?: number; jobs?: JoobleIlani[] };
        if (!Array.isArray(veri.jobs)) throw new Error("cevapta 'jobs' dizisi yok (API değişmiş olabilir)");

        let yeniKimlik = 0;
        for (const j of veri.jobs) {
          if (!j.title) continue;
          const kimlik = j.id != null ? String(j.id) : j.link ?? "";
          if (!kimlik) continue;
          if (!gorulen.has(kimlik)) yeniKimlik++;
          gorulen.add(kimlik);
          if (bilinenKimlikler.has(kimlik) || toplanan.has(kimlik)) continue;
          toplanan.set(kimlik, {
            kaynak: "jooble",
            kaynakId: kimlik,
            baslik: j.title.trim(),
            sirket: j.company?.trim() || undefined,
            sehir: j.location?.trim() || undefined,
            aciklama: j.snippet ? metneCevir(j.snippet) : undefined,
            maas: j.salary?.trim() || undefined,
            url: j.link || undefined,
            yayinTarihi: j.updated || undefined,
            ham: j,
          });
        }
        if (veri.jobs.length < 10 || yeniKimlik === 0) break;
        await nazikBekle();
      }
    } catch (e) {
      // Hata mesajında URL var, URL'de anahtar var — loga ve veritabanına anahtar düşmesin
      let mesaj = (e as Error).message.replaceAll(anahtar, "<anahtar>");
      if (mesaj.startsWith("HTTP 403")) mesaj += " (anahtar bu ülke alt alanına ait değil — Türkiye anahtarı tr.jooble.org/api/about formundan alınır)";
      hatalar.push(`${terim}: ${mesaj}`);
      log(`Jooble "${terim}" düştü: ${mesaj}`);
    }
    await nazikBekle();
  }

  if (aramalar.length && hatalar.length === aramalar.length) {
    throw new Error(`her terim düştü — ${hatalar[0]}`);
  }
  return { ilanlar: [...toplanan.values()], gorulen: gorulen.size };
}
