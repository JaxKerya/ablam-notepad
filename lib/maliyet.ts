// Sistem maliyeti — Ders, Kariyer ve YouTube'un model/servis harcamalarının
// ortak dili. Sayfa (app/maliyet) ve toplayan uç (app/api/maliyet) buradan okur.
//
// Üç sistem parayı üç ayrı yerde tutuyor ve birleştirmek için tablo eklemedik:
//   Ders     ders_sessions.denetim      (adım başına uretimMaliyetUsd + geçişler)
//   Kariyer  kariyer_eslesmeler.olcum   (ilan başına maliyetUsd + oncekiMaliyetUsd)
//   YouTube  youtube_maliyet            (kendi tablosu, kalem kırılımlı)
// Uç nokta üçünü okuyup aşağıdaki tek biçime çeviriyor; sayfa yalnızca bunu bilir.

export type Sistem = "ders" | "kariyer" | "youtube";

export const SISTEM_ETIKETI: Record<Sistem, string> = {
  ders: "Ablam Ders",
  kariyer: "Ablam Kariyer",
  youtube: "Ablam YouTube",
};

/** Kartlardaki renk; tema değişkenleriyle değil, sistemi ayırt etmek için sabit tonlar */
export const SISTEM_RENGI: Record<Sistem, string> = {
  ders: "bg-sky-400/70",
  kariyer: "bg-emerald-400/70",
  youtube: "bg-rose-400/70",
};

export const SISTEM_YOLU: Record<Sistem, string> = {
  ders: "/ders",
  kariyer: "/kariyer",
  youtube: "/youtube",
};

/**
 * Tek harcama satırı. "kalem" sistemin kendi iş adımı (senaryo, denetim,
 * ön eleme…); etiketler KALEM_ETIKETI'nde. Kariyer'de satır GÜNLÜKTÜR
 * (2500+ ilan tek tek gönderilmesin), diğerlerinde tek iş.
 */
export interface Harcama {
  sistem: Sistem;
  kalem: string;
  /** Ekranda görünen iş adı: ders başlığı, bölüm adı, "142 ilan" */
  ad: string;
  tutar: number;
  zaman: string;
  /** Aynı işi tek satırda toplamak için kimlik (ders/bölüm id'si, Kariyer'de gün) */
  grup: string;
}

export const KALEM_ETIKETI: Record<string, string> = {
  // Ders
  cozumleme: "Ders çözümleme",
  soru: "Soru üretimi",
  denetim: "Cevap anahtarı denetimi",
  gelistirme: "Soru geliştirme",
  not: "Çalışma notu",
  // Kariyer
  puanlama: "İlan puanlama",
  oneleme: "Ön eleme",
  // YouTube
  arastirma: "Araştırma",
  senaryo: "Senaryo",
  ses: "Seslendirme",
  sahne: "Sahne",
  kapak: "Kapak",
  metin: "Başlık ve diğer metinler",
};
export const kalemEtiketi = (k: string) => KALEM_ETIKETI[k] ?? k;

/** Uç noktanın döndürdüğü tam cevap */
export interface MaliyetCevabi {
  harcamalar: Harcama[];
  /** Okunamayan kaynaklar — sayfa "kayıt yok" ile "okunamadı"yı karıştırmasın */
  hatalar: { sistem: Sistem; mesaj: string }[];
  /** Sayılmayanlar; sayfada dipnot olarak gösteriliyor */
  kapsamDisi: string[];
}

export const dolar = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Küçük tutarlar için: $0,003 gibi kaybolmasın */
export const dolarInce = (n: number) =>
  n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : dolar(n);

export type Donem = "7" | "30" | "ay" | "tum";
export const DONEM_ETIKETI: Record<Donem, string> = {
  "7": "Son 7 gün",
  "30": "Son 30 gün",
  ay: "Bu ay",
  tum: "Tümü",
};

/** Dönemin başlangıç anı (ms). "tum" → 0 */
export function donemBaslangici(donem: Donem, simdi: number): number {
  if (donem === "tum") return 0;
  if (donem === "7") return simdi - 7 * 86_400_000;
  if (donem === "30") return simdi - 30 * 86_400_000;
  const ay = new Date(simdi);
  ay.setDate(1);
  ay.setHours(0, 0, 0, 0);
  return ay.getTime();
}

export const topla = (liste: Harcama[]) => liste.reduce((t, h) => t + h.tutar, 0);

/** Anahtara göre toplam; en büyükten küçüğe */
export function grupla<T extends string>(liste: Harcama[], anahtar: (h: Harcama) => T): { ad: T; tutar: number; adet: number }[] {
  const m = new Map<T, { tutar: number; adet: number }>();
  for (const h of liste) {
    const k = anahtar(h);
    const g = m.get(k) ?? { tutar: 0, adet: 0 };
    g.tutar += h.tutar;
    g.adet += 1;
    m.set(k, g);
  }
  return [...m.entries()]
    .map(([ad, g]) => ({ ad, ...g }))
    .sort((a, b) => b.tutar - a.tutar);
}

/** Günlük toplamlar (yerel gün), eskiden yeniye — küçük sütun grafiği için */
export function gunlukSeri(liste: Harcama[], gun: number, simdi: number): { gun: string; tutar: number }[] {
  const kova = new Map<string, number>();
  for (let i = gun - 1; i >= 0; i--) {
    const d = new Date(simdi - i * 86_400_000);
    kova.set(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, 0);
  }
  for (const h of liste) {
    const d = new Date(h.zaman);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (kova.has(k)) kova.set(k, (kova.get(k) ?? 0) + h.tutar);
  }
  return [...kova.entries()].map(([gun, tutar]) => ({ gun, tutar }));
}

/** Günlük ortalamadan aylık tempo — "bu gidişle ayda ne kadar" */
export function aylikTempo(liste: Harcama[], simdi: number): number | null {
  const son30 = liste.filter((h) => new Date(h.zaman).getTime() >= simdi - 30 * 86_400_000);
  if (!son30.length) return null;
  const enEski = Math.min(...son30.map((h) => new Date(h.zaman).getTime()));
  const gun = Math.max(1, Math.min(30, Math.ceil((simdi - enEski) / 86_400_000)));
  return (topla(son30) / gun) * 30;
}
