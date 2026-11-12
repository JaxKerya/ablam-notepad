// İş Bul (isbul.net) toplayıcı — sitenin anahtarsız "agent" JSON API'si.
//
//   GET https://www.isbul.net/api/agent/jobs?q=<metin>&category=<slug>&sector=<slug>&city=<il>&page=N&per_page=25
//   -> { data: [{ id, title, company, city, district, work_type, position,
//        sector, salary, published_at, expires_at, url, slug }],
//        meta: { current_page, last_page, total } }
//   GET https://www.isbul.net/api/agent/jobs/<slug>
//   -> { data: { ...aynısı + education_level, experience_level, vacancy_count, description, is_open } }
//
// sercan-sever/job-list deposundan öğrenildi (20.09.2026).
//
// Measured 12.11.2026 (the old "pool is capped at 50 per city" note was stale):
//   - The unfiltered pool is 643 listings (26 pages at per_page=25, which is the
//     server maximum); city=ankara alone is 120. The old scan read 5x20=100 of
//     them, and the order is neither by published_at nor stable between pages,
//     so 5 of the 6 law-office listings were never seen.
//   - Not one of the 643 is a public-sector listing. The value of this source is
//     law-office / secretary / office work, so it is queried for exactly that
//     (see SORGULAR) instead of paging through the whole pool: about 16 list
//     requests per run instead of 26, and ~90 listings reach the scorer instead
//     of 643. No general scan is kept: its first page is the same
//     hospitality/retail noise every hour. What the filters miss is whatever
//     names office work with a word not in SORGULAR; a first page of the
//     unordered pool would not catch that either.
//   - "keyword" is ignored by the server (the unfiltered pool comes back). The
//     parameters that do filter are "q" (full text, documented in the site's
//     llms.txt; a nonsense word returns total=0), "category" (position slug) and
//     "sector" (slug as in isbul.net/sektorler). An unknown category/sector slug
//     answers HTTP 400 "unknown_filter_value".
//   - "description" is not in the list and often empty in the detail. A text is
//     therefore built from the structured fields (position, sector, work type,
//     education, experience, vacancies) so the model does not hit the
//     "no description" ceiling (80); the information really is there.
// Şehir parametresi ASCII küçük harf slug ("izmir", "nevsehir").

import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import { getir, metneCevir, nazikBekle } from "./http";

export interface IsbulSecenekleri {
  /** Boşsa Türkiye geneli. Her şehir için SORGULAR ayrı ayrı çalışır. */
  sehirler?: string[];
  bilinenKimlikler?: Set<string>;
  /** Upper bound on detail requests per run (default: no limit). Listings past it keep their list data. */
  detaySiniri?: number;
  log?: (mesaj: string) => void;
}

interface IsbulIlani {
  id?: string;
  title?: string;
  slug?: string;
  company?: string;
  city?: string;
  district?: string | null;
  work_type?: string | null;
  position?: string | null;
  sector?: string | null;
  education_level?: string | null;
  experience_level?: string | null;
  salary?: string | null;
  vacancy_count?: string | number | null;
  description?: string | null;
  is_open?: boolean | null;
  published_at?: string | null;
  expires_at?: string | null;
  url?: string | null;
}

const UC_NOKTA = "https://www.isbul.net/api/agent/jobs";
const SAYFA_BOYU = 25; // server maximum; asking for more still returns 25
const SAYFA_SINIRI = 8; // safety only: the largest query below (q=ofis) is 5 pages (12.11.2026)

/**
 * q=ofis and q=asistan are full-text and mostly noise (q=ofis: 98 rows, of which
 * real-estate agents, cleaners, engineers ... whose text mentions an office;
 * 12.11.2026). Their rows are kept only when the title or the position names
 * office work, and dropped when it is a tea/cleaning/dental job with "ofis" or
 * "asistan" in its name. Matched against sadelestir() output (ASCII lower case).
 */
const OFIS_ISI = /\b(ofis|office|buro|sekreter|asistan)/;
const OFIS_GURULTUSU = /temizlik|\bcay\b|barista|ofis ?boy|dis hekimi|satis|cagri merkezi|hostes/;
const ofisIsiMi = (i: IsbulIlani) => {
  const metin = sadelestir(`${i.title ?? ""} ${i.position ?? ""}`);
  return OFIS_ISI.test(metin) && !OFIS_GURULTUSU.test(metin);
};

/**
 * Server-side filters that fit the profile, each read to its last page and
 * merged by id. Totals measured 12.11.2026 are in the trailing comments.
 * Left out on purpose: q=katip (23 hits, all substring noise such as barista and
 * cook ads, no clerk ad) and q="veri giriş" (7 hits, none a data-entry job).
 * The category slugs buro-elemani / ofis-elemani / ofis-sorumlusu /
 * avukat-sekreteri (1 each), ofis-asistani (6) and yonetici-asistani (7) exist
 * but miss ads whose position is plain "Asistan" or something unrelated
 * ("Ofis Personeli" filed as "Ön Muhasebe"); q=ofis and q=asistan cover them.
 * arsiv-gorevlisi and ofis-personeli are not known slugs (400), buro-memuru
 * and idari-isler-elemani are known but empty.
 */
const SORGULAR: {
  ad: string;
  parametre: "sector" | "category" | "q";
  deger: string;
  /** Client-side keep test for queries whose server-side match is too loose */
  suzgec?: (i: IsbulIlani) => boolean;
}[] = [
  { ad: "sektör hukuk", parametre: "sector", deger: "avukatlik-ve-hukuki-danismanlik" }, // 6
  { ad: "kategori sekreter", parametre: "category", deger: "sekreter" }, // 14
  { ad: "sekreter", parametre: "q", deger: "sekreter" }, // 20
  { ad: "büro", parametre: "q", deger: "büro" }, // 16
  // 98 rows on 4 pages (meta says 114 / 5, the 5th is empty). An earlier version
  // had no office query and missed 10+ "Ofis Asistanı / Sorumlusu / Personeli" ads.
  { ad: "ofis", parametre: "q", deger: "ofis", suzgec: ofisIsiMi },
  { ad: "asistan", parametre: "q", deger: "asistan", suzgec: ofisIsiMi }, // 36; "Yönetici Asistanı" ads
  { ad: "hukuk", parametre: "q", deger: "hukuk" }, // 7; catches law work filed under another sector
  { ad: "arşiv", parametre: "q", deger: "arşiv" }, // 30; mostly accounting ads that mention filing
  { ad: "kütüphane", parametre: "q", deger: "kütüphane" }, // 1
  // 0 today; kept because one request is a cheap way to notice the first public-sector ad
  { ad: "memur", parametre: "q", deger: "memur" },
];

const BASLIKLAR = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "accept-language": "tr-TR,tr;q=0.9",
};

/** "İzmir" -> "izmir", "Nevşehir" -> "nevsehir" */
const ilSlug = (il: string) => sadelestir(il).replace(/\s+/g, "-");

/** Yapısal alanlardan model için açıklama metni; boş alan satır yazmaz */
function aciklamaKur(i: IsbulIlani): string | undefined {
  // Position and sector go first, on one line: titles here are often generic or
  // wrong ("Sekreter" whose position is "Avukat Sekreteri" in the law sector), and
  // a scorer that reads only the start of the text must still see them.
  const kunye = [
    i.position?.trim() ? `Pozisyon: ${i.position.trim()}` : "",
    i.sector?.trim() ? `Sektör: ${i.sector.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const satirlar = [
    kunye,
    i.work_type ? `Çalışma şekli: ${i.work_type}` : "",
    i.education_level ? `Eğitim: ${i.education_level}` : "",
    i.experience_level ? `Deneyim: ${i.experience_level}` : "",
    i.vacancy_count ? `Kontenjan: ${i.vacancy_count}` : "",
    i.description ? `\n${metneCevir(i.description)}` : "",
  ].filter(Boolean);
  return satirlar.length ? satirlar.join("\n") : undefined;
}

async function detay(slug: string): Promise<IsbulIlani | null> {
  try {
    const cevap = await getir(`${UC_NOKTA}/${encodeURIComponent(slug)}`, { headers: BASLIKLAR });
    const veri = (await cevap.json()) as { data?: IsbulIlani };
    return veri.data ?? null;
  } catch {
    return null; // detay gelmezse liste verisiyle devam
  }
}

export async function isbulTara(secenekler: IsbulSecenekleri) {
  const { sehirler = [], bilinenKimlikler = new Set<string>(), detaySiniri = Infinity } = secenekler;
  const log = secenekler.log ?? (() => {});

  const toplanan = new Map<string, HamIlan>();
  const gorulen = new Set<string>();
  const hatalar: string[] = [];
  const iller = sehirler.length ? sehirler : [""];
  let sorguSayisi = 0;
  let detaySayisi = 0;

  for (const sehir of iller) {
    for (const sorgu of SORGULAR) {
      const etiket = `${sehir || "TR"} / ${sorgu.ad}`;
      sorguSayisi++;
      try {
        for (let sayfa = 1; sayfa <= SAYFA_SINIRI; sayfa++) {
          const url = new URL(UC_NOKTA);
          url.searchParams.set(sorgu.parametre, sorgu.deger);
          if (sehir) url.searchParams.set("city", ilSlug(sehir));
          url.searchParams.set("page", String(sayfa));
          url.searchParams.set("per_page", String(SAYFA_BOYU));
          const cevap = await getir(url.toString(), { headers: BASLIKLAR });
          const veri = (await cevap.json()) as { data?: IsbulIlani[]; meta?: { last_page?: number } };
          if (!Array.isArray(veri.data)) throw new Error("cevapta 'data' dizisi yok (API değişmiş olabilir)");

          for (const i of veri.data) {
            if (!i.id || !i.title) continue;
            if (sorgu.suzgec && !sorgu.suzgec(i)) continue;
            gorulen.add(i.id);
            if (bilinenKimlikler.has(i.id) || toplanan.has(i.id)) continue;
            // Detay yalnızca yeni ilan için: eğitim/deneyim/kontenjan orada
            let d: IsbulIlani | null = null;
            if (i.slug && detaySayisi < detaySiniri) {
              detaySayisi++;
              d = await detay(i.slug);
              await nazikBekle();
            }
            // Only the detail says a listing stopped taking applications;
            // expires_at alone is not enough (site's llms.txt).
            if (d?.is_open === false) continue;
            const tam: IsbulIlani = { ...i, ...(d ?? {}) };
            toplanan.set(i.id, {
              kaynak: "isbul",
              kaynakId: i.id,
              baslik: i.title.trim(),
              sirket: tam.company?.trim() || undefined,
              sehir: [tam.city, tam.district].filter(Boolean).join(" / ") || undefined,
              aciklama: aciklamaKur(tam),
              maas: tam.salary?.trim() || undefined,
              url: tam.url || (i.slug ? `https://www.isbul.net/is-ilani/${i.slug}` : undefined),
              yayinTarihi: tam.published_at || undefined,
              sonBasvuru: tam.expires_at || undefined,
              ham: tam,
            });
          }
          // last_page decides, not the row count: a page can carry fewer rows
          // than meta.total says (q=katip: total 23, 11 rows, 12.11.2026).
          const son = veri.meta?.last_page ?? sayfa;
          if (sayfa >= son || veri.data.length === 0) break;
          await nazikBekle();
        }
      } catch (e) {
        // A renamed slug answers HTTP 400; it has to show up in the log rather
        // than look like an empty but successful query.
        hatalar.push(`${etiket}: ${(e as Error).message}`);
        log(`İş Bul "${etiket}" düştü: ${(e as Error).message}`);
      }
      await nazikBekle();
    }
  }

  if (sorguSayisi && hatalar.length === sorguSayisi) {
    throw new Error(`her sorgu düştü — ${hatalar[0]}`);
  }
  // A query that fails every hour (renamed sector slug -> HTTP 400) must be
  // visible on the scan record, not only in the log: the run otherwise looks
  // successful with a slightly lower "gorulen".
  const uyari = hatalar.length ? `${hatalar.length}/${sorguSayisi} sorgu düştü: ${hatalar[0]}` : undefined;
  return { ilanlar: [...toplanan.values()], gorulen: gorulen.size, uyari };
}
