// Ablam Ders — paylaşılan tipler, sabitler ve yardımcılar

export type SessionStatus = "hazirlaniyor" | "hazir" | "hata";
export type QuestionKind = "acik" | "coktan";
export type Verdict = "dogru" | "eksik" | "yanlis" | "pas";

/** Transkript parçası — alanlar kısa tutuldu, satır sayısı yüksek */
export interface Segment {
  o: number; // başlangıç (ms)
  d: number; // süre (ms)
  t: string; // metin
}

export interface DersVideo {
  video_id: string;
  url: string;
  title: string | null;
  duration_seconds: number;
  lang: string | null;
  source: "supadata" | "manuel";
  segments: Segment[];
  created_at: string;
}

export interface DersSession {
  id: string;
  video_id: string;
  title: string | null;
  summary: string | null;
  topics: string[];
  status: SessionStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DersQuestion {
  id: string;
  session_id: string;
  position: number;
  kind: QuestionKind;
  question: string;
  answer_key: string | null;
  key_points: string[];
  choices: string[] | null;
  correct_index: number | null;
  explanation: string | null;
  topic: string | null;
  start_seconds: number;
  /** Ablam "bu soru saçma" dediyse true — prompt'u iyileştirmek için toplanıyor */
  flagged: boolean;
}

export interface DersAnswer {
  id: string;
  session_id: string;
  question_id: string;
  user_answer: string | null;
  verdict: Verdict | null;
  feedback: string | null;
  missing: string[];
  created_at: string;
}

// --- Sabitler ---------------------------------------------------------------

/**
 * Soru sayısı sabit değil, dersin uzunluğuna göre hesaplanıyor: kabaca her üç
 * dakikalık anlatım için bir soru, 8 ile 26 arasında sıkıştırılmış.
 *
 * Ağırlık çoktan seçmelide (%70): KPSS'nin kendisi çoktan seçmeli, sınav
 * refleksi orada kazanılıyor. Açık uçlular kalan %30 — onlar da öğrenmeyi
 * asıl pekiştiren kısım olduğu için hiç eksilmiyor, en az ikisi garanti.
 *
 * Bu bir ÜST SINIR: ders bu kadar soruyu taşımıyorsa model daha az üretir,
 * doğrulama katmanı da fazlasını kırpar.
 */
export function hedefSoruSayisi(sureSaniye: number): {
  toplam: number;
  coktan: number;
  acik: number;
} {
  const dakika = Math.max(0, sureSaniye) / 60;
  const toplam = Math.round(Math.min(26, Math.max(8, dakika / 3)));
  const acik = Math.max(2, Math.round(toplam * 0.3));
  return { toplam, coktan: toplam - acik, acik };
}

/** Bir oturumun anlamlı sayılması için gereken en az soru sayısı */
export const EN_AZ_SORU = 4;

/** Günlük soru üretimi tavanı — sızan bir linkin faturayı şişirmesini engeller */
export const GUNLUK_URETIM_LIMITI = 40;

export const VERDICT_LABEL: Record<Verdict, string> = {
  dogru: "Doğru",
  eksik: "Eksik",
  yanlis: "Yanlış",
  pas: "Pas geçildi",
};

/** Tailwind sınıfları — sonuç rozetleri */
export const VERDICT_STYLE: Record<Verdict, string> = {
  dogru: "border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent-light)]",
  eksik: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  yanlis: "border-red-400/40 bg-red-400/10 text-red-300",
  pas: "border-white/15 bg-white/[0.04] text-white/50",
};

// --- Yardımcılar ------------------------------------------------------------

/** 1394 -> "23:14", 3821 -> "1:03:41" */
export function formatSure(saniye: number): string {
  const s = Math.max(0, Math.floor(saniye));
  const sa = Math.floor(s / 3600);
  const dk = Math.floor((s % 3600) / 60);
  const sn = s % 60;
  const iki = (n: number) => String(n).padStart(2, "0");
  return sa > 0 ? `${sa}:${iki(dk)}:${iki(sn)}` : `${dk}:${iki(sn)}`;
}

/** Videonun ilgili anına açılan YouTube linki */
export function videoLinki(videoId: string, saniye: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(saniye))}s`;
}

export function tarihMetni(dateStr: string): string {
  const fark = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (fark < 60) return "az önce";
  const dk = Math.floor(fark / 60);
  if (dk < 60) return `${dk} dk önce`;
  const sa = Math.floor(dk / 60);
  if (sa < 24) return `${sa} saat önce`;
  const gun = Math.floor(sa / 24);
  if (gun < 7) return `${gun} gün önce`;
  const hafta = Math.floor(gun / 7);
  if (hafta < 4) return `${hafta} hafta önce`;
  return `${Math.floor(gun / 30)} ay önce`;
}

const TR_HARF: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
  Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
};

/** "Temel Hukuk Bilgisi" -> "temel-hukuk-bilgisi" */
export function slugla(metin: string, enFazla = 60): string {
  const sade = metin
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (h) => TR_HARF[h] ?? h)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (sade || "ders").slice(0, enFazla).replace(/-+$/, "");
}

/**
 * Ders özetini not defterinin (TipTap) belge biçimine çevirir.
 * Böylece özet tek tıkla mevcut /note sistemine kaydedilebiliyor.
 */
export function ozetiNotBelgesine(
  baslik: string,
  ozet: string | null,
  konular: string[],
  videoUrl: string
) {
  const paragraf = (metin: string) => ({
    type: "paragraph",
    content: [{ type: "text", text: metin }],
  });

  const icerik: unknown[] = [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: baslik }] },
  ];

  if (ozet) icerik.push(paragraf(ozet));

  if (konular.length) {
    icerik.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Konular" }],
    });
    icerik.push({
      type: "bulletList",
      content: konular.map((k) => ({ type: "listItem", content: [paragraf(k)] })),
    });
  }

  icerik.push({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "Dersin videosu",
        marks: [{ type: "link", attrs: { href: videoUrl, target: "_blank" } }],
      },
    ],
  });

  return { type: "doc", content: icerik };
}

/** Oturumun skoru — pas geçilenler yanlış sayılmaz, ayrı gösterilir */
export function skorHesapla(answers: DersAnswer[]) {
  const dogru = answers.filter((a) => a.verdict === "dogru").length;
  const eksik = answers.filter((a) => a.verdict === "eksik").length;
  const yanlis = answers.filter((a) => a.verdict === "yanlis").length;
  const pas = answers.filter((a) => a.verdict === "pas").length;
  const puanli = dogru + eksik * 0.5;
  const toplam = answers.length;
  return {
    dogru,
    eksik,
    yanlis,
    pas,
    toplam,
    yuzde: toplam ? Math.round((puanli / toplam) * 100) : 0,
  };
}
