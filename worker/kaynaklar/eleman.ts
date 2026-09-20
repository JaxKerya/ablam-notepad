// Eleman.net toplayıcı — herkese açık HTML sayfaları, anahtar yok.
//
// Arama: GET https://www.eleman.net/is-ilanlari/<il-slug>?aranan=<terim>
//   Site terimi kendi pozisyon sözlüğüne çevirip yönlendiriyor:
//   "büro memuru" -> /is-ilanlari/ankara/memur, "hukuk sekreteri" -> /ankara/sekreter.
//   Sözlükte olmayan terim ("sözleşmeli personel") yalnızca /is-ilanlari/ankara'ya
//   düşüyor = ilin BÜTÜN ilanları; bu bir eşleşme değil, atlanıyor (son URL'de
//   pozisyon parçası yoksa). Birçok terim aynı pozisyona çıkıyor; pozisyon URL'si
//   bir kez taranıyor. Sayfalama ?sy=N, sayfa ~40 ilan.
// Detay: ilan sayfasında schema.org JobPosting JSON-LD var — başlık, açıklama,
//   datePosted, validThrough (son başvuru), hiringOrganization, jobLocation.
//   Liste kartını ayrıştırmak yerine yalnızca YENİ ilanların detayı çekiliyor.
// İlan kimliği URL'deki -i<sayı> son eki (…/is-ilani/on-muhasebe-…-i4763218).
//
// sercan-sever/job-list deposundaki adaptörden yola çıkıldı (20.09.2026); oradaki
// ?kw= parametresi artık çalışmıyordu, URL biçimi yukarıdaki gibi yeniden bulundu.
// Nazik hız: istekler arası 1,5-3,5 sn, yalnız yeni ilan için detay.

import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import { getir, metneCevir, nazikBekle, varliklariCoz } from "./http";

export interface ElemanSecenekleri {
  aramaTerimleri: string[];
  /** Boşsa kaynak koşmaz: il olmadan arama ülke geneline düşer, havuz anlamsız büyür */
  sehirler?: string[];
  bilinenKimlikler?: Set<string>;
  log?: (mesaj: string) => void;
}

const TABAN = "https://www.eleman.net";
// Liste sayfası ucuz (tek istek, filtre yerel); detay yalnız eşleşen yeni kart için.
// "memur" kategorisi 23 sayfa, tarihe göre sıralı: 6 sayfa ~240 ilan geriye bakar.
const SAYFA_SINIRI = 6;
const BASLIKLAR = {
  accept: "text/html,application/xhtml+xml",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

/** "İzmir" -> "izmir" (site slug'ları ASCII küçük harf) */
const ilSlug = (il: string) => sadelestir(il).replace(/\s+/g, "-");

interface JobPosting {
  "@type"?: string;
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string } | { addressLocality?: string; addressRegion?: string }[] };
  baseSalary?: { value?: { value?: string | number; minValue?: string | number; maxValue?: string | number } };
}

function jobPostingCoz(html: string): JobPosting | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]) as JobPosting | JobPosting[];
      const liste = Array.isArray(d) ? d : [d];
      const jp = liste.find((x) => x && x["@type"] === "JobPosting");
      if (jp) return jp;
    } catch {
      // bozuk blok; sıradakine bak
    }
  }
  return null;
}

function konumMetni(jp: JobPosting): string | undefined {
  const adres = jp.jobLocation?.address;
  const ilk = Array.isArray(adres) ? adres[0] : adres;
  const parcalar = [ilk?.addressLocality, ilk?.addressRegion].filter(Boolean) as string[];
  if (!parcalar.length) return undefined;
  // "Ankara,Altındağ" + "Ankara" -> "Ankara / Altındağ"
  const [il, ilce] = parcalar[0].split(",").map((s) => s.trim());
  return ilce ? `${il} / ${ilce}` : il;
}

function maasMetni(jp: JobPosting): string | undefined {
  const v = jp.baseSalary?.value;
  if (!v) return undefined;
  const a = v.minValue ?? v.value, b = v.maxValue;
  if (!a && !b) return undefined;
  return b ? `${a} - ${b} TL` : `${a} TL`;
}

/**
 * Kart bağlantılarından (slug, id) çiftleri; sayfadaki sıra korunur, tekrarlar atılır.
 *
 * Yalnızca slug'ı pozisyonun kelimelerini taşıyan kartlar alınır. Ölçüldü
 * (20.09.2026): /ankara/memur sayfası "memur" ilanları değil, ilin bütün ilanları
 * (23 sayfa: bulaşıkçı, depo, çağrı merkezi). Filtresiz ilk tarama 250 ilan çekti,
 * 204'ü 0-24 puan aldı, ~$1,3 boşa gitti. /sekreter ve /buro-personeli gibi
 * kategoriler ise gerçek. Slug eşleşmesi ikisini de doğru işliyor: "büro memuru"
 * kartı "memur" taşır, "bulaşık personeli" taşımaz.
 */
function kartlar(html: string, pozisyonKelimeleri: string[]): { url: string; id: string }[] {
  const gorulen = new Set<string>();
  const sonuc: { url: string; id: string }[] = [];
  for (const m of html.matchAll(/href="(https:\/\/www\.eleman\.net\/is-ilani\/([a-z0-9-]+)-i(\d+))"/g)) {
    const [, url, slug, id] = m;
    if (gorulen.has(id)) continue;
    gorulen.add(id);
    const parcalar = slug.split("-");
    // "memur" -> "memuru"/"memurlari" da sayılır (önek eşleşmesi); "on-muhasebe" -> ikisi de aranır
    if (!pozisyonKelimeleri.every((k) => parcalar.some((p) => p.startsWith(k)))) continue;
    sonuc.push({ url, id });
  }
  return sonuc;
}

export async function elemanTara(secenekler: ElemanSecenekleri) {
  const { aramaTerimleri, sehirler = [], bilinenKimlikler = new Set<string>() } = secenekler;
  const log = secenekler.log ?? (() => {});
  if (!sehirler.length) return { ilanlar: [], gorulen: 0 };

  // 1) Terimleri pozisyon sayfalarına çöz (şehir başına), aynı sayfa bir kez
  const pozisyonSayfalari = new Set<string>();
  const cozulemeyen = new Set<string>();
  for (const sehir of sehirler) {
    const il = ilSlug(sehir);
    for (const terim of aramaTerimleri) {
      try {
        const cevap = await getir(`${TABAN}/is-ilanlari/${il}?aranan=${encodeURIComponent(terim)}`, { headers: BASLIKLAR });
        const son = new URL(cevap.url);
        const parcalar = son.pathname.split("/").filter(Boolean); // ["is-ilanlari", il, pozisyon?]
        if (parcalar.length >= 3 && parcalar[1] === il) pozisyonSayfalari.add(`${son.origin}${son.pathname}`);
        else cozulemeyen.add(terim);
      } catch (e) {
        log(`Eleman.net "${terim}" (${sehir}) çözülemedi: ${(e as Error).message}`);
      }
      await nazikBekle();
    }
  }
  if (cozulemeyen.size) log(`Eleman.net sözlüğünde yok, atlandı: ${[...cozulemeyen].join(", ")}`);
  if (!pozisyonSayfalari.size) return { ilanlar: [], gorulen: 0 };

  // 2) Pozisyon sayfalarını gez, yeni ilanların detayını çek
  const toplanan = new Map<string, HamIlan>();
  const gorulen = new Set<string>();
  const hatalar: string[] = [];
  for (const sayfaUrl of pozisyonSayfalari) {
    try {
      for (let sy = 1; sy <= SAYFA_SINIRI; sy++) {
        const cevap = await getir(sy === 1 ? sayfaUrl : `${sayfaUrl}?sy=${sy}`, { headers: BASLIKLAR });
        const html = await cevap.text();
        const pozisyon = sayfaUrl.split("/").pop() ?? "";
        const liste = kartlar(html, pozisyon.split("-").filter((k) => k.length >= 3));
        // Sayfa sayısı 2. sayfadan itibaren başlıkta ("[23 Sayfadan 2. Sayfa]"); ilk
        // sayfada yok, orada "?sy=2" bağlantısının varlığına bakılıyor
        const sonSayfa = Number(/\[(\d+) Sayfadan/.exec(html)?.[1] ?? (html.includes(`?sy=${sy + 1}`) ? sy + 1 : sy));
        let yeniKimlik = 0;
        for (const k of liste) {
          if (!gorulen.has(k.id)) yeniKimlik++;
          gorulen.add(k.id);
          if (bilinenKimlikler.has(k.id) || toplanan.has(k.id)) continue;
          await nazikBekle();
          const detay = await getir(k.url, { headers: BASLIKLAR });
          const jp = jobPostingCoz(await detay.text());
          if (!jp?.title) continue; // JSON-LD yoksa bu ilan atlanır; kart metni güvenilir değil
          toplanan.set(k.id, {
            kaynak: "eleman",
            kaynakId: k.id,
            baslik: varliklariCoz(jp.title).trim(),
            sirket: jp.hiringOrganization?.name ? varliklariCoz(jp.hiringOrganization.name).trim() : undefined,
            sehir: konumMetni(jp),
            aciklama: [
              jp.employmentType ? `Çalışma şekli: ${jp.employmentType}` : "",
              jp.description ? metneCevir(jp.description) : "",
            ].filter(Boolean).join("\n\n") || undefined,
            maas: maasMetni(jp),
            url: k.url,
            yayinTarihi: jp.datePosted ? jp.datePosted.slice(0, 10) : undefined,
            sonBasvuru: jp.validThrough ? jp.validThrough.slice(0, 10) : undefined,
            ham: { ...jp, description: undefined, employmentType: jp.employmentType },
          });
        }
        if (sy >= sonSayfa || (liste.length && yeniKimlik === 0)) break;
        await nazikBekle();
      }
    } catch (e) {
      hatalar.push(`${sayfaUrl}: ${(e as Error).message}`);
      log(`Eleman.net ${sayfaUrl.replace(TABAN, "")} düştü: ${(e as Error).message}`);
    }
    await nazikBekle();
  }

  if (hatalar.length === pozisyonSayfalari.size) throw new Error(`her sayfa düştü — ${hatalar[0]}`);
  return { ilanlar: [...toplanan.values()], gorulen: gorulen.size };
}
