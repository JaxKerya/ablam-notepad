// Düz HTTP ile çalışan kaynakların ortak parçaları (ilan.gov.tr, LinkedIn,
// Jooble, Careerjet). Tarayıcı gerektiren tek kaynak İŞKUR; o playwright'ta.
//
// fetch Node'un kendisinden değil undici paketinden: ilan.gov.tr sunucusu
// TLS zincirinde ara sertifikayı (GeoTrust TLS RSA CA G1) göndermiyor.
// Tarayıcılar ve Windows curl'ü ara sertifikayı kendileri indiriyor, Node ve
// Ubuntu OpenSSL indirmiyor -> "unable to verify the first certificate".
// Çözüm: DigiCert'in herkese açık ara sertifikası depoda, güvenilen kök
// listesine ekleniyor. Sertifika 2027-11'de doluyor; o zaman yenilenmeli.

import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

const ARA_SERTIFIKA = readFileSync(new URL("../sertifikalar/geotrust-tls-rsa-ca-g1.pem", import.meta.url), "utf8");
const dagitici = new Agent({ connect: { ca: [...rootCertificates, ARA_SERTIFIKA] } });

/** Gerçek bir tarayıcı gibi görünen istek başlıkları — bazı siteler boş UA'yı reddediyor */
const TARAYICI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kaynak siteyi yormamak için istekler arası rastgele 1,5–3,5 sn */
export const nazikBekle = () => bekle(1500 + Math.random() * 2000);

/**
 * fetch sarmalayıcısı: zaman aşımı, tarayıcı başlıkları, HTTP hatasında
 * anlaşılır mesaj. Kaynak kırıldığında kariyer_taramalar'a düşen hata bu mesaj.
 */
export async function getir(url: string, init: UndiciRequestInit = {}, zamanAsimiMs = 30_000) {
  const denetim = new AbortController();
  const sayac = setTimeout(() => denetim.abort(), zamanAsimiMs);
  try {
    const cevap = await undiciFetch(url, {
      ...init,
      dispatcher: dagitici,
      signal: denetim.signal,
      headers: {
        "user-agent": TARAYICI_UA,
        "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!cevap.ok) {
      throw new Error(`HTTP ${cevap.status} — ${url.slice(0, 120)}`);
    }
    return cevap;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`zaman aşımı (${zamanAsimiMs / 1000} sn) — ${url.slice(0, 120)}`);
    throw e;
  } finally {
    clearTimeout(sayac);
  }
}

const VARLIKLAR: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ccedil: "ç", Ccedil: "Ç", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü",
  scedil: "ş", Scedil: "Ş", inodot: "ı", gbreve: "ğ", Gbreve: "Ğ", Idot: "İ",
};

/** &amp; &#231; &#x131; gibi HTML varlıklarını çözer */
export function varliklariCoz(metin: string): string {
  return metin
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, ad) => VARLIKLAR[ad] ?? m);
}

/**
 * HTML -> düz metin. Blok etiketlerini satır sonuna çevirir ki ilan
 * açıklamasındaki liste maddeleri birbirine yapışmasın; modele giden metin bu.
 */
export function metneCevir(html: string): string {
  return varliklariCoz(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|ul|ol|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
