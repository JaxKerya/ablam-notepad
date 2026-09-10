// Ablam Ders — API koruması
//
// SiteGate tarayıcı tarafında çalışıyor (localStorage), yani API uçlarını
// korumuyordu: adresi bilen herkes soru üretimi tetikleyip AI faturasını
// şişirebilirdi. Burası kapıyı geçenlere imzalı bir httpOnly çerez verir,
// /api/ders/* uçları da bu çerezi arar.
//
// Not: çok şahane kelime tarayıcı paketinde de geçtiği için bu, kararlı birine
// karşı mutlak bir engel değil. Yanında çalışan ikinci koruma günlük üretim
// tavanıydı; o KAPATILDI (bkz. ders.ts GUNLUK_URETIM_LIMITI = 0), çünkü ablamın
// toplu çalışmasını kesiyordu. Yani fatura tarafında tek durak burası kaldı.

import crypto from "node:crypto";

export const GATE_COOKIE = "ablam-ders-gate";

/** 30 gün */
const OMUR_MS = 30 * 24 * 60 * 60 * 1000;

function gizliAnahtar(): string {
  const s = process.env.SITE_GATE_SECRET;
  if (!s) {
    throw new Error(
      "SITE_GATE_SECRET ortam değişkeni tanımlı değil. Rastgele uzun bir metin atayın."
    );
  }
  return s;
}

function imzala(govde: string): string {
  return crypto.createHmac("sha256", gizliAnahtar()).update(govde).digest("hex");
}

export function gateTokenUret(): string {
  const govde = String(Date.now());
  return `${govde}.${imzala(govde)}`;
}

export function gateTokenGecerli(token: string | undefined): boolean {
  if (!token) return false;

  const [govde, imza] = token.split(".");
  if (!govde || !imza) return false;

  const beklenen = imzala(govde);
  const a = Buffer.from(imza);
  const b = Buffer.from(beklenen);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const zaman = Number(govde);
  return Number.isFinite(zaman) && Date.now() - zaman < OMUR_MS;
}

export const COOKIE_SECENEKLERI = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: Math.floor(OMUR_MS / 1000),
};

/** Türkçe karakterleri normalleştirip küçük harfe çevirir */
export function turkceNormalize(str: string): string {
  return str
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .replace(/Ğ/g, "ğ")
    .replace(/Ü/g, "ü")
    .replace(/Ş/g, "ş")
    .replace(/Ö/g, "ö")
    .replace(/Ç/g, "ç")
    .toLocaleLowerCase("tr")
    .trim();
}

export const COK_SAHANE_KELIME = "helikopter";
