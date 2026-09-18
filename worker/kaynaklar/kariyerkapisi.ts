// Kariyer Kapısı toplayıcı — kariyerkapisi.gov.tr (Cumhurbaşkanlığı İnsan Kaynakları Ofisi).
//
// Kamu kurumlarının başvurusunu bu platformdan aldığı ilanlar. Havuz küçük
// (ülke geneli ~25 aktif) ama ilan.gov.tr'den daha yapılı: her ilan POZİSYON
// POZİSYON geliyor — unvan, KPSS puan türü ve mezuniyet şartı, il başına
// kontenjan, değerlendirme aşamaları. "Önlisans KPSS ile büro personeli,
// Ankara" sorusunun cevabı burada metnin içinde değil, alanlarda.
//
// Sayfanın arkasındaki API herkese açık, anahtar yok (kaynak: sitenin kendi
// JS'i, js/Index/Main.js ve js/IlanDetay/IlanDetayV1.js):
//   POST api/ilan/SearchIlanPublic            {Il, IlanTuru, SearchText}
//   POST api/ilan/GetIlanPreviewPublic        {ilanGuid}   ilan metni (BBCode)
//   POST api/altilan/GetAltIlanInfoByIlanIdPublic {ilanGuid} pozisyonlar
// Il filtresi işe yaramıyor (Ankara=66 ile 0 döndü; şehir ilanda değil
// kontenjanda). Bütün ilan çekilip pozisyonların kontenjan illerine göre
// eleniyor. Eski alan adı (cbiko.gov.tr) artık çözülmüyor; doğrusu bu.

import type { HamIlan } from "../../lib/kariyer";
import { sadelestir } from "../../lib/kariyer";
import { getir, nazikBekle } from "./http";

const API = "https://api.kariyerkapisi.gov.tr/api";
const SITE = "https://kariyerkapisi.gov.tr";

export interface KariyerKapisiSecenekleri {
  /** Profildeki şehirler; boşsa her il */
  sehirler?: string[];
  bilinenKimlikler: Set<string>;
  detaySiniri?: number;
  log?: (mesaj: string) => void;
}

interface ListeIlani {
  guid: string;
  kurumAdi: string;
  birimAdi: string | null;
  ilanBaslik: string;
  /** 1 = başvuru platformda (IlanDetay), 2 = dış bağlantı (basvuruLinki) */
  ilanTipi: number;
  ilanTuru: string;
  sonDurumu: string;
  basTarih: string | null;
  bitTarih: string | null;
  basvuruLinki: string;
}

interface Pozisyon {
  ilanBaslik: string;
  ilanMetni: string;
  unvan: string;
  hizmetSinifi: string | null;
  kadroDerecesi: string | null;
  kontenjanList: { il: string; kontenjan: number }[] | null;
  degerlemeAsamaList: { asamaAdi: string }[] | null;
}

async function post<T>(yol: string, govde: unknown): Promise<T> {
  const cevap = await getir(`${API}/${yol}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(govde),
  });
  if (cevap.status === 204) return null as T;
  return (await cevap.json()) as T;
}

/** İlan metni BBCode'la geliyor: [justify][size=14pt]…[/size]. Etiketleri at, boşlukları topla. */
export function bbcodeTemizle(metin: string): string {
  return metin
    .replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pozisyonun kontenjan illerinden profildeki bir şehre uyanı; uyan yoksa null */
function uyanSehir(p: Pozisyon, sehirler: string[]): string | null {
  const iller = (p.kontenjanList ?? []).map((k) => k.il).filter(Boolean);
  if (!sehirler.length) return iller[0] ?? null;
  const istenen = sehirler.map(sadelestir);
  return iller.find((il) => istenen.includes(sadelestir(il))) ?? null;
}

function pozisyonMetni(p: Pozisyon): string {
  const kontenjan = (p.kontenjanList ?? []).map((k) => `${k.il} ${k.kontenjan}`).join(", ");
  const asamalar = (p.degerlemeAsamaList ?? []).map((a) => a.asamaAdi).filter(Boolean).join(" → ");
  return [
    `## ${p.unvan || p.ilanBaslik}`,
    p.hizmetSinifi ? `Hizmet sınıfı: ${p.hizmetSinifi}` : "",
    kontenjan ? `Kontenjan: ${kontenjan}` : "",
    asamalar ? `Değerlendirme: ${asamalar}` : "",
    bbcodeTemizle(p.ilanMetni || ""),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function kariyerKapisiTara(secenekler: KariyerKapisiSecenekleri) {
  const { sehirler = [], bilinenKimlikler, detaySiniri = 30 } = secenekler;
  const log = secenekler.log ?? (() => {});

  const liste = (await post<ListeIlani[]>("ilan/SearchIlanPublic", { Il: "0", IlanTuru: "0", SearchText: "" })) ?? [];
  if (!Array.isArray(liste)) throw new Error("liste cevabı dizi değil (API değişmiş olabilir)");
  const simdi = Date.now();
  const aktif = liste.filter((i) => !i.bitTarih || new Date(i.bitTarih).getTime() >= simdi);

  const ilanlar: HamIlan[] = [];
  let sehirDisi = 0;
  for (const i of aktif) {
    if (bilinenKimlikler.has(i.guid)) continue;
    if (ilanlar.length >= detaySiniri) break;

    let pozisyonlar: Pozisyon[] = [];
    let govde = "";
    try {
      const [onizleme, alt] = await Promise.all([
        post<{ ilanMetni?: string; kontenjan?: number } | null>("ilan/GetIlanPreviewPublic", { ilanGuid: i.guid }),
        post<Pozisyon[] | null>("altilan/GetAltIlanInfoByIlanIdPublic", { ilanGuid: i.guid }),
      ]);
      govde = bbcodeTemizle(onizleme?.ilanMetni ?? "");
      pozisyonlar = Array.isArray(alt) ? alt : [];
    } catch (e) {
      log(`Kariyer Kapısı detay okunamadı (${i.guid}): ${(e as Error).message}`);
    }
    await nazikBekle();

    // Şehir: pozisyonların kontenjan illerinden profile uyan varsa o. Kontenjanı
    // OLMAYAN pozisyon "bilinmiyor"dur, uyumsuz değil — kalır, model bakar.
    // Bütün pozisyonların kontenjanı var ve hiçbiri uymuyorsa ilan burada elenir —
    // kayıt düşmez; kontenjan illeri değişirse yeniden bakılır.
    const kontenjansiz = pozisyonlar.filter((p) => !p.kontenjanList?.length);
    const uyanlar = pozisyonlar.filter((p) => uyanSehir(p, sehirler));
    if (sehirler.length && pozisyonlar.length && !uyanlar.length && !kontenjansiz.length) {
      sehirDisi++;
      continue;
    }
    const gosterilecek = uyanlar.length || kontenjansiz.length ? [...uyanlar, ...kontenjansiz] : pozisyonlar;
    const sehir = gosterilecek.map((p) => uyanSehir(p, sehirler)).find(Boolean) ?? undefined;

    // Pozisyonlar ÖNCE: modele giden metin kesilirse genel şartlar kesilsin,
    // "büro personeli, KPSS P93, Ankara 2 kişi" satırı değil (denetim bulgusu)
    const aciklama = [...gosterilecek.map(pozisyonMetni), govde ? `## Genel şartlar\n${govde}` : ""].filter(Boolean).join("\n\n").slice(0, 12_000);
    ilanlar.push({
      kaynak: "kariyerkapisi",
      kaynakId: i.guid,
      baslik: i.ilanBaslik.trim(),
      sirket: i.kurumAdi?.trim() || undefined,
      sehir,
      aciklama: aciklama || undefined,
      url: i.ilanTipi === 1 || !i.basvuruLinki ? `${SITE}/IlanDetay?i=${i.guid}` : i.basvuruLinki,
      yayinTarihi: i.basTarih ?? undefined,
      sonBasvuru: i.bitTarih ?? undefined,
      ham: { ...i, pozisyonSayisi: pozisyonlar.length },
    });
  }

  if (sehirDisi) log(`Kariyer Kapısı: ${sehirDisi} ilanın kontenjanı ${sehirler.join("/")} dışında, atlandı`);
  return { ilanlar, gorulen: aktif.length };
}
