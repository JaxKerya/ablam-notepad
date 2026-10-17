/**
 * Ablam Kanvas — sonsuz, ortak çizim tahtası. Şema: db/kanvas.sql.
 *
 * Bütün koordinatlar "dünya" biriminde: yakınlaştırma 1 iken bir dünya birimi
 * bir CSS pikseli. Her öğe (çizgi, şekil, yazı, resim) kendi satırı; ikisi aynı
 * anda çizse bile çakışma yok, silmek o satırı kaldırmak.
 */

export type Desen = "kareli" | "noktali" | "bos";
export type Ton = "koyu" | "acik";

export interface Kanvas {
  id: string;
  ad: string;
  desen: Desen;
  ton: Ton;
  olusturan: string | null;
  onizleme: string | null;
  created_at: string;
  updated_at: string;
}

/** Renkler anahtar olarak saklanıyor; ekrandaki tonu zemine göre seçiliyor */
export const RENKLER = ["m", "sari", "mercan", "yesil", "mavi", "mor"] as const;
export type Renk = (typeof RENKLER)[number];
export const RENK_ADI: Record<Renk, string> = {
  m: "Mürekkep",
  sari: "Sarı",
  mercan: "Mercan",
  yesil: "Yeşil",
  mavi: "Mavi",
  mor: "Mor",
};
const RENK_HEX: Record<Ton, Record<Renk, string>> = {
  // Koyu zeminde mürekkep tebeşir beyazı, açık zeminde koyu yeşil-siyah
  koyu: { m: "#F0F2ED", sari: "#F3CC5C", mercan: "#F2917A", yesil: "#8FD6A0", mavi: "#7DBBEE", mor: "#C3A6EE" },
  acik: { m: "#1F2A24", sari: "#C98F0A", mercan: "#D2553C", yesil: "#2E9A55", mavi: "#2A78C2", mor: "#7C55C9" },
};
export const renkHex = (r: string, ton: Ton) => RENK_HEX[ton][r as Renk] ?? RENK_HEX[ton].m;

export const ZEMIN: Record<Ton, { zemin: string; ince: string; kalin: string }> = {
  koyu: { zemin: "#2F3D33", ince: "rgba(255,255,255,0.055)", kalin: "rgba(255,255,255,0.10)" },
  acik: { zemin: "#F7F5EE", ince: "rgba(40,70,55,0.08)", kalin: "rgba(40,70,55,0.16)" },
};

/** Üç kalınlık; her araç kendi ölçeğini kullanıyor */
export const KALINLIKLAR = {
  kalem: [2.5, 4.5, 8],
  fosfor: [14, 22, 32],
  sekil: [2, 3.5, 6],
  yazi: [20, 28, 40],
} as const;

export type SekilTuru = "cizgi" | "ok" | "dikdortgen" | "elips";

/**
 * Kalem: düz nokta dizisi [x0,y0,x1,y1,…]; f = fosforlu kalem (yarı saydam, kalın);
 * z = çizildiği andaki yakınlık. Fare noktaları o yakınlıktaki ekran piksellerine
 * oturuyor, düzleştirme bu ölçüye göre yapılıyor (bkz. components/kanvas/ciz.ts).
 * Eski çizgilerde yok; noktaların ızgarasından tahmin ediliyor.
 */
export interface KalemVeri { n: number[]; r: string; k: number; f?: 1; z?: number }
export interface SekilVeri { s: SekilTuru; a: [number, number]; b: [number, number]; r: string; k: number }
/** Yazı: (x, y) sol üst köşe; w/h yazanın ölçtüğü kutu (seçim ve kırpma için) */
export interface YaziVeri { x: number; y: number; m: string; r: string; b: number; w: number; h: number }
export interface ResimVeri { x: number; y: number; w: number; h: number; u: string }

interface OgeTemel { id: string; kanvas_id: string; sira: number; olusturan: string | null }
export type Oge =
  | (OgeTemel & { tur: "kalem"; veri: KalemVeri })
  | (OgeTemel & { tur: "sekil"; veri: SekilVeri })
  | (OgeTemel & { tur: "yazi"; veri: YaziVeri })
  | (OgeTemel & { tur: "resim"; veri: ResimVeri });

export interface Kutu { x0: number; y0: number; x1: number; y1: number }

export const yeniKimlik = () => crypto.randomUUID();
/** Üst üste binme sırası: zaman + kırıntı, iki kişi aynı milisaniyede çizse de ayrışsın */
export const yeniSira = () => Date.now() + Math.random() / 1000;
/** Nokta dizisini kaydederken bir ondalık yeter; satır boyu yarıya iniyor */
export const yuvarla = (v: number) => Math.round(v * 10) / 10;

/** Yazının satır yüksekliği (yazı boyutunun katı) — çizim ve ölçüm aynı değeri kullanmalı */
export const SATIR = 1.3;

export function sinirKutusu(o: Oge): Kutu {
  switch (o.tur) {
    case "kalem": {
      const n = o.veri.n;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n.length; i += 2) {
        if (n[i] < x0) x0 = n[i];
        if (n[i] > x1) x1 = n[i];
        if (n[i + 1] < y0) y0 = n[i + 1];
        if (n[i + 1] > y1) y1 = n[i + 1];
      }
      const p = o.veri.k / 2 + 1;
      return { x0: x0 - p, y0: y0 - p, x1: x1 + p, y1: y1 + p };
    }
    case "sekil": {
      const { a, b, k, s } = o.veri;
      // Ok başı çizgiden biraz taşıyor
      const p = k / 2 + (s === "ok" ? 6 + k * 2.5 : 1);
      return { x0: Math.min(a[0], b[0]) - p, y0: Math.min(a[1], b[1]) - p, x1: Math.max(a[0], b[0]) + p, y1: Math.max(a[1], b[1]) + p };
    }
    case "yazi":
    case "resim":
      return { x0: o.veri.x, y0: o.veri.y, x1: o.veri.x + o.veri.w, y1: o.veri.y + o.veri.h };
  }
}

export const kutularKesisir = (a: Kutu, b: Kutu) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
export const kutuIcinde = (ic: Kutu, dis: Kutu) => ic.x0 >= dis.x0 && ic.x1 <= dis.x1 && ic.y0 >= dis.y0 && ic.y1 <= dis.y1;

export function kutuBirlesimi(kutular: Kutu[]): Kutu | null {
  if (!kutular.length) return null;
  return kutular.reduce((t, k) => ({ x0: Math.min(t.x0, k.x0), y0: Math.min(t.y0, k.y0), x1: Math.max(t.x1, k.x1), y1: Math.max(t.y1, k.y1) }));
}

/** Noktanın doğru parçasına uzaklığı */
function parcaUzakligi(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * (x, y) bu öğeye "değiyor" mu — silgi ve tıklayarak seçme için. Çizgiler ve
 * şekiller yalnızca çizgilerinden yakalanıyor (dikdörtgenin içi boş), yazı ve
 * resim kutusunun her yerinden. `pay` dünya biriminde tolerans.
 */
export function isabet(o: Oge, x: number, y: number, pay: number): boolean {
  const k = sinirKutusu(o);
  if (x < k.x0 - pay || x > k.x1 + pay || y < k.y0 - pay || y > k.y1 + pay) return false;
  switch (o.tur) {
    case "kalem": {
      const n = o.veri.n, sinir = o.veri.k / 2 + pay;
      if (n.length === 2) return Math.hypot(x - n[0], y - n[1]) <= sinir;
      for (let i = 0; i + 3 < n.length; i += 2) {
        if (parcaUzakligi(x, y, n[i], n[i + 1], n[i + 2], n[i + 3]) <= sinir) return true;
      }
      return false;
    }
    case "sekil": {
      const { a, b, k: kal, s } = o.veri;
      const sinir = kal / 2 + pay;
      if (s === "cizgi" || s === "ok") return parcaUzakligi(x, y, a[0], a[1], b[0], b[1]) <= sinir;
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      if (s === "dikdortgen") {
        return (
          parcaUzakligi(x, y, x0, y0, x1, y0) <= sinir || parcaUzakligi(x, y, x1, y0, x1, y1) <= sinir ||
          parcaUzakligi(x, y, x1, y1, x0, y1) <= sinir || parcaUzakligi(x, y, x0, y1, x0, y0) <= sinir
        );
      }
      const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
      if (rx < 1 || ry < 1) return parcaUzakligi(x, y, x0, y0, x1, y1) <= sinir;
      const d = Math.hypot((x - (x0 + rx)) / rx, (y - (y0 + ry)) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= sinir;
    }
    case "yazi":
    case "resim":
      return true; // sınır kutusu kontrolü yukarıda
  }
}

/** Öğeyi (dx, dy) kadar kaydırılmış YENİ öğe olarak döndürür (eskisine dokunmaz) */
export function otele(o: Oge, dx: number, dy: number): Oge {
  switch (o.tur) {
    case "kalem":
      return { ...o, veri: { ...o.veri, n: o.veri.n.map((v, i) => yuvarla(v + (i % 2 ? dy : dx))) } };
    case "sekil":
      return { ...o, veri: { ...o.veri, a: [o.veri.a[0] + dx, o.veri.a[1] + dy], b: [o.veri.b[0] + dx, o.veri.b[1] + dy] } };
    case "yazi":
      return { ...o, veri: { ...o.veri, x: o.veri.x + dx, y: o.veri.y + dy } };
    case "resim":
      return { ...o, veri: { ...o.veri, x: o.veri.x + dx, y: o.veri.y + dy } };
  }
}

/** Veritabanından ya da yayından gelen satırı doğrular; bozuksa null (çizim çökmesin) */
export function ogeDogrula(h: unknown): Oge | null {
  if (!h || typeof h !== "object") return null;
  const o = h as Record<string, unknown>;
  const v = o.veri as Record<string, unknown> | null;
  if (typeof o.id !== "string" || typeof o.kanvas_id !== "string" || !v || typeof v !== "object") return null;
  const temel = { id: o.id, kanvas_id: o.kanvas_id, sira: Number(o.sira) || 0, olusturan: typeof o.olusturan === "string" ? o.olusturan : null };
  const sayi = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  switch (o.tur) {
    case "kalem":
      return Array.isArray(v.n) && v.n.length >= 2 && sayi(v.k) ? ({ ...temel, tur: "kalem", veri: v as unknown as KalemVeri }) : null;
    case "sekil":
      return Array.isArray(v.a) && Array.isArray(v.b) && sayi(v.k) ? ({ ...temel, tur: "sekil", veri: v as unknown as SekilVeri }) : null;
    case "yazi":
      return typeof v.m === "string" && sayi(v.x) && sayi(v.w) ? ({ ...temel, tur: "yazi", veri: v as unknown as YaziVeri }) : null;
    case "resim":
      return typeof v.u === "string" && sayi(v.x) && sayi(v.w) ? ({ ...temel, tur: "resim", veri: v as unknown as ResimVeri }) : null;
    default:
      return null;
  }
}

/** Kaydedilecek satır (tablo kolonları) */
export const satir = (o: Oge) => ({
  id: o.id,
  kanvas_id: o.kanvas_id,
  tur: o.tur,
  veri: o.veri,
  sira: o.sira,
  olusturan: o.olusturan,
  updated_at: new Date().toISOString(),
});
