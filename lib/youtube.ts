// Ablam Ders — YouTube linki çözümleme ve transkript alma
//
// Transkript üç katmanlı alınır, biri düşerse diğeri devreye girer:
//   1. Supadata  (hızlı ve güvenilir; ücretsiz katman 100 kredi/ay)
//   2. YouTube'un kendi timedtext ucu (bedava, ama sunucu IP'lerinden sık engellenir)
//   3. Elle yapıştırma (ablamın kendi tarayıcısından — hiçbir zaman engellenmez)

import type { Segment } from "@/lib/ders";

export class TranskriptHatasi extends Error {}

/** youtu.be, /watch?v=, /shorts/, /embed/ ve /live/ biçimlerini kabul eder */
export function videoIdCozumle(girdi: string): string | null {
  const metin = girdi.trim();
  if (!metin) return null;

  // Çıplak video id
  if (/^[\w-]{11}$/.test(metin)) return metin;

  let url: URL;
  try {
    url = new URL(metin.startsWith("http") ? metin : `https://${metin}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;

    const yol = url.pathname.split("/").filter(Boolean);
    if (yol.length >= 2 && ["shorts", "embed", "live", "v"].includes(yol[0])) {
      return /^[\w-]{11}$/.test(yol[1]) ? yol[1] : null;
    }
  }

  return null;
}

/**
 * Saf oynatma listesi linki mi? (`/playlist?list=...` — içinde video yok)
 *
 * Not: `watch?v=...&list=...&index=...` biçimi BİR VİDEO linkidir, sadece bir
 * listenin içinden açılmıştır; videoIdCozumle onu zaten doğru çözer. Burada
 * yakalanan şey, ablamın videoya hiç girmeden listenin kendi adresini
 * kopyalaması durumu.
 */
export function oynatmaListesiMi(girdi: string): boolean {
  try {
    const url = new URL(girdi.trim().startsWith("http") ? girdi.trim() : `https://${girdi.trim()}`);
    const host = url.hostname.replace(/^www\./, "");
    if (!host.endsWith("youtube.com")) return false;
    return url.pathname === "/playlist" && !!url.searchParams.get("list");
  } catch {
    return false;
  }
}

/** Video başlığı — oEmbed ucu herkese açık ve hafif */
export async function baslikGetir(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.title === "string" ? data.title : null;
  } catch {
    return null;
  }
}

interface SupadataParca {
  text?: string;
  offset?: number;
  duration?: number;
}

/**
 * 1. katman — Supadata. Önce Türkçe altyazı istenir; o video için Türkçe yoksa
 * dil belirtmeden tekrar denenir (video hangi dildeyse onu döndürür). Yabancı
 * dilde altyazı, hiç altyazı olmamasından iyidir — model yine Türkçe soru üretir.
 */
async function supadataTranskript(videoId: string): Promise<{ segments: Segment[]; lang: string }> {
  const key = process.env.SUPADATA_API_KEY;
  if (!key) throw new TranskriptHatasi("SUPADATA_API_KEY tanımlı değil.");

  const dene = async (lang?: string) => {
    const url =
      `https://api.supadata.ai/v1/transcript` +
      `?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}` +
      (lang ? `&lang=${lang}` : "");

    const res = await fetch(url, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const govde = await res.text().catch(() => "");
      throw new TranskriptHatasi(`Supadata ${res.status}: ${govde.slice(0, 200)}`);
    }

    const data = await res.json();
    const icerik = data?.content;
    if (!Array.isArray(icerik) || icerik.length === 0) return null;

    const segments = (icerik as SupadataParca[])
      .filter((p) => typeof p.text === "string" && p.text.trim())
      .map((p) => ({
        o: Math.max(0, Math.round(p.offset ?? 0)),
        d: Math.max(0, Math.round(p.duration ?? 0)),
        t: p.text!.trim(),
      }));

    return segments.length ? { segments, lang: data?.lang ?? lang ?? "?" } : null;
  };

  const turkce = await dene("tr").catch(() => null);
  if (turkce) return turkce;

  const herhangi = await dene();
  if (herhangi) return herhangi;

  throw new TranskriptHatasi("Supadata bu video için altyazı bulamadı.");
}

/** 2. katman — YouTube'un kendi altyazı ucu. Sunucu IP'lerinde çoğu zaman boş döner. */
async function youtubeTimedText(videoId: string): Promise<Segment[]> {
  const dene = async (lang: string) => {
    const res = await fetch(
      `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}&fmt=json3`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!res.ok) return null;
    const govde = await res.text();
    if (!govde.trim()) return null;

    const data = JSON.parse(govde);
    const olaylar = Array.isArray(data?.events) ? data.events : [];
    const parcalar: Segment[] = [];

    for (const e of olaylar) {
      const metin = (e?.segs ?? [])
        .map((s: { utf8?: string }) => s?.utf8 ?? "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      if (metin) {
        parcalar.push({ o: e.tStartMs ?? 0, d: e.dDurationMs ?? 0, t: metin });
      }
    }
    return parcalar.length ? parcalar : null;
  };

  const sonuc = (await dene("tr")) ?? (await dene("en"));
  if (!sonuc) throw new TranskriptHatasi("YouTube altyazı vermedi (muhtemelen IP engeli).");
  return sonuc;
}

/**
 * 3. katman — YouTube'un "Transkripti göster" panelinden kopyalanan metin.
 * İki biçimi de kabul eder:
 *    "0:12\nEvet arkadaşlar"   (zaman damgası ayrı satırda)
 *    "0:12 Evet arkadaşlar"    (aynı satırda)
 * Zaman damgası hiç yoksa metni düz parça olarak alır.
 */
export function elleYapistirilaniCozumle(ham: string): Segment[] {
  const satirlar = ham
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const damga = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\s+(.*))?$/;
  const parcalar: Segment[] = [];
  let bekleyenMs: number | null = null;

  for (const satir of satirlar) {
    const m = satir.match(damga);

    if (m) {
      const [, sa, dk, sn, kalan] = m;
      const ms = ((Number(sa ?? 0) * 3600 + Number(dk) * 60 + Number(sn)) * 1000);

      if (kalan && kalan.trim()) {
        parcalar.push({ o: ms, d: 0, t: kalan.trim() });
        bekleyenMs = null;
      } else {
        bekleyenMs = ms;
      }
      continue;
    }

    if (bekleyenMs !== null) {
      parcalar.push({ o: bekleyenMs, d: 0, t: satir });
      bekleyenMs = null;
    } else if (parcalar.length) {
      // Zaman damgasız devam satırı — öncekine ekle
      parcalar[parcalar.length - 1].t += " " + satir;
    } else {
      parcalar.push({ o: 0, d: 0, t: satir });
    }
  }

  if (!parcalar.length) throw new TranskriptHatasi("Yapıştırılan metin boş.");

  // Süreleri bir sonraki parçanın başlangıcından türet
  for (let i = 0; i < parcalar.length; i++) {
    const sonraki = parcalar[i + 1];
    parcalar[i].d = sonraki ? Math.max(0, sonraki.o - parcalar[i].o) : 5000;
  }

  return parcalar;
}

/** Otomatik yollar sırayla denenir; ikisi de düşerse çağıran tarafa haber verilir. */
export async function transkriptGetir(
  videoId: string
): Promise<{ segments: Segment[]; source: "supadata"; lang: string }> {
  const hatalar: string[] = [];

  try {
    const { segments, lang } = await supadataTranskript(videoId);
    return { segments, source: "supadata", lang };
  } catch (e) {
    hatalar.push(`Supadata: ${(e as Error).message}`);
  }

  try {
    return { segments: await youtubeTimedText(videoId), source: "supadata", lang: "tr" };
  } catch (e) {
    hatalar.push(`YouTube: ${(e as Error).message}`);
  }

  throw new TranskriptHatasi(hatalar.join(" | "));
}

// --- Transkript metne çevirme ----------------------------------------------

function damgaMetni(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Parçaları ~30 saniyelik, [dk:sn] işaretli bloklara toplar.
 * Model bu işaretlerden soruların videodaki anını çıkarıyor.
 */
export function transkriptMetni(segments: Segment[], blokMs = 30_000): string {
  if (!segments.length) return "";

  const satirlar: string[] = [];
  let tampon: string[] = [];
  let blokBasi = segments[0].o;

  for (const s of segments) {
    // Eşiği aşan parça mevcut bloğa değil, YENİ bloğa girmeli. Aksi halde blok
    // etiketi ile içeriği kayar ve model soruların video anını yanlış hesaplar.
    if (tampon.length && s.o - blokBasi >= blokMs) {
      satirlar.push(`[${damgaMetni(blokBasi)}] ${tampon.join(" ")}`);
      tampon = [];
      blokBasi = s.o;
    }
    tampon.push(s.t);
  }
  if (tampon.length) satirlar.push(`[${damgaMetni(blokBasi)}] ${tampon.join(" ")}`);

  return satirlar.join("\n");
}

/**
 * Bir anın etrafındaki bölüm. Değerlendirme çağrısında transkriptin tamamı
 * yerine bu gönderiliyor — hem ~15 kat ucuz hem model tek konuya odaklanıyor.
 */
export function cevresindekiBolum(
  segments: Segment[],
  saniye: number,
  onceSn = 75,
  sonraSn = 105
): string {
  const bas = (saniye - onceSn) * 1000;
  const son = (saniye + sonraSn) * 1000;
  return segments
    .filter((s) => s.o >= bas && s.o <= son)
    .map((s) => s.t)
    .join(" ")
    .trim();
}

// --- Zaman damgasını transkriptten türetme --------------------------------
//
// Modelin verdiği "saniye" değeri güvenilmez. Ölçüm: claude-sonnet-5 aynı ders
// üzerinde üç kez çalıştırıldığında 10 damganın 0'ı, 7'si ve 8'i videonun
// süresini 2-15 kat aştı. Bu değeri kırpmak hatayı gizliyor (link videonun
// sonuna gidiyor), düzeltmiyor.
//
// Çözüm bir GÜVENLİK AĞI: sorunun kavramlarının transkriptte en yoğun geçtiği
// anı kendimiz hesaplıyoruz, ama modelin değerini otomatik olarak atmıyoruz —
// makul olduğu sürece (kendi tepemizin %75'i kadar skor alıyorsa) onu
// kullanıyoruz. Yani mekanizma modelin değerini DEĞİŞTİREN değil, ONAYLAYAN
// bir süzgeç; yalnızca değer bariz biçimde kötüyse devreye giriyor.
//
// Ölçüldü (gerçek bir ders, 11 soru, üretim modeli sol): 11'inde de modelin
// değeri kabul edildi, hesabımız hiç devreye girmedi. Yani sağlam bir modelle
// süzgeç sessizce bekliyor; sonuç doğruluğunu model sağlıyor, süzgeç yalnızca
// felaketi engelliyor. Bunu "damga modelden alınmıyor" diye anlatmak yanlış
// olur.
//
// Süzgeç devreye girdiğinde iyi bir değer koyabilsin diye dolgu kelimeleri
// diziden atılıyor (bkz. kelimeDizini): atılmazsa hocanın bütün konuları
// önizlediği giriş bölümü her soru için en yoğun an gibi görünüyor.

const TR_HARFLER: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
  Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
};

/** Metinden anlamlı (5+ harfli) kelimeleri çıkarır, Türkçe karakterleri sadeleştirir */
export function icerikKelimeleri(metin: string): Set<string> {
  const sade = metin.replace(/[çğıöşüÇĞİÖŞÜ]/g, (h) => TR_HARFLER[h] ?? h).toLowerCase();
  return new Set(sade.match(/[a-z]{5,}/g) ?? []);
}

/**
 * Bir kelimenin "her yerde geçiyor" sayılması için gereken pencere oranı.
 *
 * Değer taranarak seçildi (gerçek bir ders, 11 soru; ölçüt: hesaplanan tepenin
 * modelin değerine ortalama uzaklığı):
 *   süzgeç yok  3,7 dk | 0,5 -> 3,6 | 0,4 -> 3,5 | 0,3 -> 2,2 | 0,2 -> 1,5 | 0,12 -> 7,4
 * 0,2-0,3 aralığı bir plato, 0,12 uçurum (anlamlı kelimeler de atılıyor).
 * Ortasını aldık.
 *
 * SINIRLARI: tek video, n=11, ve hedef ölçüt "modelin değerine yakınlık" —
 * gerçek doğruluk değil, vekil bir ölçüt. Bu yüzden platonun en iyi noktasına
 * değil ortasına oturtuldu. Elde 10-20 ders birikince yeniden taranmalı.
 */
const DOLGU_ESIGI = 0.25;
const PENCERE = 180; // saniye — damga aramasındaki ±90'lık pencereyle aynı

/**
 * kelime -> transkriptte geçtiği saniyeler. Video başına bir kez kurulur.
 *
 * Videonun pencerelerinin yarısından fazlasında geçen kelimeler ATILIYOR.
 * icerikKelimeleri 5+ harfli her kelimeyi alıyor; bu, konuşma dilindeki
 * dolguları da içeriye sokuyor. Gerçek bir derste ölçüldü: "şimdi", "mesela",
 * "böyle", "burada", "tamam", "zaten", "osmanlı" gibi 15 kelime videonun
 * %50'sinden fazlasında geçiyordu. Bunlar kalınca, hocanın bütün konu
 * başlıklarını önizlediği GİRİŞ bölümü her soru için en yoğun an gibi
 * görünüyor: ölçümde bir sorunun hesaplanan tepesi 2:30 çıktı, doğrusu 26:43'tü.
 *
 * Liste elle tutulmuyor, her video için kendi metninden çıkarılıyor — ders
 * konusu değişince kendiliğinden uyum sağlıyor.
 */
export function kelimeDizini(segments: Segment[]): Map<string, number[]> {
  const dizin = new Map<string, number[]>();
  for (const s of segments) {
    const sn = Math.round(s.o / 1000);
    for (const k of icerikKelimeleri(s.t)) {
      const yerler = dizin.get(k);
      if (yerler) {
        if (yerler[yerler.length - 1] !== sn) yerler.push(sn);
      } else {
        dizin.set(k, [sn]);
      }
    }
  }

  const son = segments.length
    ? Math.round((segments[segments.length - 1].o + segments[segments.length - 1].d) / 1000)
    : 0;
  const toplamPencere = Math.max(1, Math.ceil(son / PENCERE));
  for (const [kelime, yerler] of dizin) {
    const pencereler = new Set(yerler.map((sn) => Math.floor(sn / PENCERE)));
    if (pencereler.size / toplamPencere > DOLGU_ESIGI) dizin.delete(kelime);
  }
  return dizin;
}

/** Bir zaman noktasında kaç farklı kavramın "kapsandığını" sayar (süpürme) */
function enYogunAn(
  icerik: Set<string>,
  dizin: Map<string, number[]>,
  yariPencere: number
): { an: number; skor: number } {
  // Her kelime için geçtiği yerlerin ±yariPencere aralıkları — aynı kelime
  // birden çok kez geçse de tek sayılsın diye aralıklar birleştiriliyor.
  const olaylar: { t: number; d: number }[] = [];

  for (const k of icerik) {
    const yerler = dizin.get(k);
    if (!yerler?.length) continue;

    let bas = yerler[0] - yariPencere;
    let son = yerler[0] + yariPencere;
    for (let i = 1; i < yerler.length; i++) {
      const yeniBas = yerler[i] - yariPencere;
      if (yeniBas <= son) {
        son = yerler[i] + yariPencere;
      } else {
        olaylar.push({ t: bas, d: 1 }, { t: son, d: -1 });
        bas = yeniBas;
        son = yerler[i] + yariPencere;
      }
    }
    olaylar.push({ t: bas, d: 1 }, { t: son, d: -1 });
  }

  if (!olaylar.length) return { an: 0, skor: 0 };

  // Aynı anda önce açılışlar işlensin ki tepe doğru ölçülsün
  olaylar.sort((a, b) => a.t - b.t || b.d - a.d);

  let sayac = 0;
  let enIyi = 0;
  let enIyiBas = 0;
  let enIyiSon = 0;
  for (let i = 0; i < olaylar.length; i++) {
    sayac += olaylar[i].d;
    if (sayac > enIyi) {
      enIyi = sayac;
      enIyiBas = olaylar[i].t;
      enIyiSon = olaylar[i + 1]?.t ?? olaylar[i].t;
    }
  }

  return { an: Math.max(0, Math.round((enIyiBas + enIyiSon) / 2)), skor: enIyi / icerik.size };
}

/** Belirli bir anın çevresinde kavramların ne kadarı geçiyor */
function anSkoru(
  icerik: Set<string>,
  dizin: Map<string, number[]>,
  an: number,
  yariPencere: number
): number {
  if (!icerik.size) return 0;
  let bulunan = 0;
  for (const k of icerik) {
    const yerler = dizin.get(k);
    if (yerler?.some((t) => Math.abs(t - an) <= yariPencere)) bulunan++;
  }
  return bulunan / icerik.size;
}

/**
 * Sorunun videoda anlatıldığı anı belirler.
 *
 * Modelin önerisi geçerli aralıktaysa ve bulduğumuz en iyi noktaya yakın kadar
 * isabetliyse korunur (model daha hassas nokta verebiliyor); değilse transkriptten
 * hesaplanan an kullanılır.
 */
export function damgaBelirle(
  soruMetni: string,
  dizin: Map<string, number[]>,
  modelDegeri: unknown,
  videoSuresi: number,
  yariPencere = 90
): number {
  const icerik = icerikKelimeleri(soruMetni);
  const onerilen =
    typeof modelDegeri === "number" && Number.isFinite(modelDegeri)
      ? Math.floor(modelDegeri)
      : null;
  const gecerliOneri =
    onerilen !== null && onerilen >= 0 && (videoSuresi <= 0 || onerilen <= videoSuresi);

  if (!icerik.size) return gecerliOneri ? onerilen! : 0;

  const enIyi = enYogunAn(icerik, dizin, yariPencere);
  if (!enIyi.skor) return gecerliOneri ? onerilen! : 0;

  if (gecerliOneri && anSkoru(icerik, dizin, onerilen!, yariPencere) >= enIyi.skor * 0.75) {
    return onerilen!;
  }

  return videoSuresi > 0 ? Math.min(enIyi.an, videoSuresi) : enIyi.an;
}

export function toplamSure(segments: Segment[]): number {
  if (!segments.length) return 0;
  const sonuncu = segments[segments.length - 1];
  return Math.round((sonuncu.o + sonuncu.d) / 1000);
}
