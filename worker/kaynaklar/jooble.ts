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

// Aggregated sites that only carry nanny / dental-clinic ads. Measured 12.11.2026
// on 1058 stored Jooble ads: bakiciburada 163, dentalilan 18, bakicibul 14,
// bakicibuldum 7, enuygunbakici 6 - none relevant to an office / memurluk profile.
// yenibiris, secretcv, isbul and elemanonline stay: the relevant office ads come
// from them.
const ENGELLI_SITELER = ["bakiciburada.com", "bakicibul.net", "bakicibuldum.com", "enuygunbakici.com", "dentalilan.com"];

const engelliSite = (kaynak?: string) => {
  const k = (kaynak ?? "").toLowerCase();
  return ENGELLI_SITELER.some((site) => k.includes(site));
};

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
  let elenen = 0;
  let kotaDoldu = false;
  const aramalar = (sehirler.length ? sehirler : [""]).flatMap((sehir) => aramaTerimleri.map((terim) => ({ terim, sehir })));

  // Terim başına 1 sayfa (~20 ilan). 10.11.2026: 845 Jooble ilanından 400'ü
  // puanlandı, hiçbiri 50'ye ulaşmadı; maliyetin en büyük payı buradaydı.
  // JOOBLE_SAYFA ile artırılabilir. Sayfa yeni kimlik getirmiyorsa durulur.
  const SAYFA_SINIRI = Number(process.env.JOOBLE_SAYFA) || 1;
  for (const [sira, { terim, sehir }] of aramalar.entries()) {
    // The 429 is a DAILY quota ("Daily request limit exceeded", Retry-After ~40 min+,
    // measured 12.11.2026), so every later term would fail too: stop asking instead
    // of retrying, and count the untried terms as failed.
    if (kotaDoldu) {
      hatalar.push(`${terim}: denenmedi (günlük kota)`);
      continue;
    }
    try {
      let donen = 0;
      let yeni = 0;
      let toplam: number | undefined;
      for (let sayfa = 1; sayfa <= SAYFA_SINIRI; sayfa++) {
        const cevap = await getir(`${taban}${anahtar}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ keywords: terim, location: sehir, page: sayfa }),
        });
        const veri = (await cevap.json()) as { totalCount?: number; jobs?: JoobleIlani[] };
        if (!Array.isArray(veri.jobs)) throw new Error("cevapta 'jobs' dizisi yok (API değişmiş olabilir)");

        donen += veri.jobs.length;
        toplam = veri.totalCount ?? toplam;
        let yeniKimlik = 0;
        for (const j of veri.jobs) {
          if (!j.title) continue;
          const kimlik = j.id != null ? String(j.id) : j.link ?? "";
          if (!kimlik) continue;
          if (engelliSite(j.source)) {
            elenen++;
            continue;
          }
          if (!gorulen.has(kimlik)) yeniKimlik++;
          gorulen.add(kimlik);
          if (bilinenKimlikler.has(kimlik) || toplanan.has(kimlik)) continue;
          yeni++;
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
            // aranan: the term that found it, so per-term yield can be audited later
            // (only the first term to find an ad is credited)
            ham: { ...j, aranan: terim },
          });
        }
        if (veri.jobs.length < 10 || yeniKimlik === 0) break;
        await nazikBekle();
      }
      // Per-term yield in the log: stored ads keep only the first term that found
      // them, so this line is the reliable measure for dropping useless terms.
      log(`Jooble "${terim}": ${donen} ilan döndü (toplam ${toplam ?? "?"}), ${yeni} yeni`);
    } catch (e) {
      // Hata mesajında URL var, URL'de anahtar var — loga ve veritabanına anahtar düşmesin
      let mesaj = (e as Error).message.replaceAll(anahtar, "<anahtar>");
      if (mesaj.startsWith("HTTP 403")) mesaj += " (anahtar bu ülke alt alanına ait değil — Türkiye anahtarı tr.jooble.org/api/about formundan alınır)";
      hatalar.push(`${terim}: ${mesaj}`);
      log(`Jooble "${terim}" düştü: ${mesaj}`);
      if (mesaj.startsWith("HTTP 429")) {
        kotaDoldu = true;
        log(`Jooble günlük kota dolmuş (HTTP 429): kalan ${aramalar.length - sira - 1} terim denenmeden bırakıldı`);
        continue;
      }
    }
    await nazikBekle();
  }
  if (elenen) log(`Jooble: ${elenen} ilan bakıcı/diş kliniği sitelerinden, elendi`);

  if (aramalar.length && hatalar.length === aramalar.length) {
    throw new Error(`her terim düştü — ${hatalar[0]}`);
  }
  // Partial failure used to be invisible (scan stored as a success with a third of
  // the ads); the caller writes this to the scan record.
  let uyari: string | undefined;
  if (hatalar.length) {
    const ilk = hatalar[0].slice(hatalar[0].indexOf(": ") + 2).split(" — ")[0];
    uyari = `${hatalar.length}/${aramalar.length} terim düştü: ${ilk}`;
    if (kotaDoldu) uyari += " (günlük kota doldu, kalan terimler denenmedi)";
  }
  return { ilanlar: [...toplanan.values()], gorulen: gorulen.size, uyari };
}
