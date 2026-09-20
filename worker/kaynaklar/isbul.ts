// İş Bul (isbul.net) toplayıcı — sitenin anahtarsız "agent" JSON API'si.
//
//   GET https://www.isbul.net/api/agent/jobs?city=<il>&page=N&per_page=20
//   -> { data: [{ id, title, company, city, district, work_type, position,
//        sector, salary, published_at, expires_at, url, slug }],
//        meta: { current_page, last_page, total } }
//   GET https://www.isbul.net/api/agent/jobs/<slug>
//   -> { data: { ...aynısı + education_level, experience_level, vacancy_count, description } }
//
// sercan-sever/job-list deposundan öğrenildi (20.09.2026). İki kısıt ölçüldü:
//   - "keyword" parametresi fiilen yok sayılıyor: "büro memuru" ile de aynı 50
//     ilan geliyor. Bu yüzden arama terimi gönderilmiyor; il başına havuzun
//     tamamı çekiliyor ve eleme Sol'a kalıyor. Havuz il başına en yeni 50 ilanla
//     sınırlı (Ankara 50, İzmir 17) — yani maliyet doğal olarak sınırlı.
//   - "description" listede yok, detayda da çoğunlukla boş. Onun yerine yapısal
//     alanlardan (pozisyon, sektör, çalışma şekli, eğitim, deneyim, maaş,
//     kontenjan) bir açıklama kuruluyor ki model "açıklama yok" tavanına (80)
//     takılmasın; bilgi gerçekten orada.
// Şehir parametresi ASCII küçük harf slug ("izmir", "nevsehir").

import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import { getir, metneCevir, nazikBekle } from "./http";

export interface IsbulSecenekleri {
  /** Boşsa Türkiye geneli (o da 50 ilanla sınırlı). Her şehir ayrı sorgu. */
  sehirler?: string[];
  bilinenKimlikler?: Set<string>;
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
  published_at?: string | null;
  expires_at?: string | null;
  url?: string | null;
}

const UC_NOKTA = "https://www.isbul.net/api/agent/jobs";
const SAYFA_BOYU = 20;
const SAYFA_SINIRI = 5; // API zaten 50'de kesiyor; emniyet

const BASLIKLAR = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "accept-language": "tr-TR,tr;q=0.9",
};

/** "İzmir" -> "izmir", "Nevşehir" -> "nevsehir" */
const ilSlug = (il: string) => sadelestir(il).replace(/\s+/g, "-");

/** Yapısal alanlardan model için açıklama metni; boş alan satır yazmaz */
function aciklamaKur(i: IsbulIlani): string | undefined {
  const satirlar = [
    i.position ? `Pozisyon: ${i.position}` : "",
    i.sector ? `Sektör: ${i.sector}` : "",
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
  const { sehirler = [], bilinenKimlikler = new Set<string>() } = secenekler;
  const log = secenekler.log ?? (() => {});

  const toplanan = new Map<string, HamIlan>();
  const gorulen = new Set<string>();
  const hatalar: string[] = [];
  const sorgular = sehirler.length ? sehirler : [""];

  for (const sehir of sorgular) {
    try {
      for (let sayfa = 1; sayfa <= SAYFA_SINIRI; sayfa++) {
        const url = new URL(UC_NOKTA);
        if (sehir) url.searchParams.set("city", ilSlug(sehir));
        url.searchParams.set("page", String(sayfa));
        url.searchParams.set("per_page", String(SAYFA_BOYU));
        const cevap = await getir(url.toString(), { headers: BASLIKLAR });
        const veri = (await cevap.json()) as { data?: IsbulIlani[]; meta?: { last_page?: number } };
        if (!Array.isArray(veri.data)) throw new Error("cevapta 'data' dizisi yok (API değişmiş olabilir)");

        for (const i of veri.data) {
          if (!i.id || !i.title) continue;
          gorulen.add(i.id);
          if (bilinenKimlikler.has(i.id) || toplanan.has(i.id)) continue;
          // Detay yalnızca yeni ilan için: eğitim/deneyim/kontenjan orada
          const d = i.slug ? await detay(i.slug) : null;
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
          if (d) await nazikBekle();
        }
        const son = veri.meta?.last_page ?? sayfa;
        if (sayfa >= son || veri.data.length < SAYFA_BOYU) break;
        await nazikBekle();
      }
    } catch (e) {
      hatalar.push(`${sehir || "TR"}: ${(e as Error).message}`);
      log(`İş Bul "${sehir || "TR"}" düştü: ${(e as Error).message}`);
    }
    await nazikBekle();
  }

  if (sorgular.length && hatalar.length === sorgular.length) {
    throw new Error(`her şehir düştü — ${hatalar[0]}`);
  }
  return { ilanlar: [...toplanan.values()], gorulen: gorulen.size };
}
