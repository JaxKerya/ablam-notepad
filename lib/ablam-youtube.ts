// Ablam YouTube — paylaşılan tipler, sabitler ve saf yardımcılar.
// Arayüz (app/youtube) buradan okur; üretimi yapan stüdyo Python (gece/gece/worker.py)
// aynı durum sözlüğünü kendi tarafında tutar — ikisini birlikte değiştir.

/**
 * Bölüm ablama açık mı? Vercel'de NEXT_PUBLIC_YOUTUBE_ACIK=false iken ana
 * sayfada görünmez, /youtube "yakında" ekranı gösterir. Geliştiren kişi
 * /youtube?onizleme=1 ile açar (tarayıcıda kalıcı). Kariyer ile aynı desen.
 */
export const YOUTUBE_ACIK = process.env.NEXT_PUBLIC_YOUTUBE_ACIK !== "false";
export const YT_ONIZLEME_ANAHTARI = "youtube-onizleme";

/** Stüdyo bu süre sessiz kalırsa "çevrimdışı" sayılır (her turda nabız atıyor, tur 20 sn) */
export const NABIZ_ESIGI_MS = 3 * 60_000;

export type Durum =
  | "bekliyor"
  | "senaryo"
  | "senaryo_onay"
  | "onaylandi"
  | "ses"
  | "render"
  | "hazir"
  | "yayinla"
  | "yayinda"
  | "hata";

export type Gizlilik = "unlisted" | "public" | "private";
export type LoopDurum = "bekliyor" | "uretiliyor" | "hazir" | "hata";

/** Sahne — bölümlerin arkasında dönen loop görsel (tablo: youtube_sahneler) */
export interface Sahne {
  id: string;
  ad: string;
  aciklama: string | null;
  sahne: string;
  loop_dosya: string | null;
  loop_durum: LoopDurum;
  kapak_url: string | null;
  /** loop'un 3 tur oynayan 720p önizlemesi (Storage); null = henüz yok, "" = üretilemedi */
  onizleme_url: string | null;
  hata: string | null;
  created_at: string;
  updated_at: string;
}

/** Senaryo ve başlık üslubu */
export type Kalip = "aciklayici" | "deneyim";
export const KALIP_ETIKETI: Record<Kalip, string> = {
  aciklayici: "Açıklayıcı — soru sorar, adım adım cevaplar",
  deneyim: "Deneyim — bir mekânda bir gece, saat saat",
};

/** Seri — konu evreni + senaryo kalıbı + sahne (tablo: youtube_seriler) */
export interface Seri {
  id: string;
  ad: string;
  aciklama: string | null;
  kalip: Kalip;
  sahne_id: string | null;
  sure_dk: number;
  /** Seriye özel kapak stili (İngilizce, teknik + palet). Boşsa stil konudan seçilir. */
  kapak_stil: string | null;
  oynatma_listesi: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bolum {
  id: string;
  seri_id: string | null;
  /** üretimde kullanılan sahne; boşsa serininki */
  sahne_id: string | null;
  konu: string;
  sure_dk: number;
  durum: Durum;
  adim: string | null;
  ilerleme: number;
  baslik: string | null;
  senaryo_md: string | null;
  kelime: number | null;
  sure_sn: number | null;
  bolumler: { title: string; start: number }[] | null;
  yt_baslik: string | null;
  yt_aciklama: string | null;
  yt_etiketler: string[];
  gizlilik: Gizlilik;
  /** Planlı yayın (ISO). Dolu: gizli yüklenir, YouTube o anda herkese açar. */
  yayin_zamani: string | null;
  /** Tam otomasyon: senaryo onayı beklenmez, video hazır olunca düğme beklemeden yüklenir */
  otomatik_yukle: boolean;
  onizleme_url: string | null;
  youtube_id: string | null;
  youtube_url: string | null;
  drive_url: string | null;
  thumbnail_url: string | null;
  /** true: stüdyo kapağı (yeniden) üretiyor; bitince false + thumbnail_url */
  kapak_istek: boolean;
  /** true: stüdyo başlık/açıklamayı YouTube'a yazıyor; bitince false */
  yt_guncelle: boolean;
  hata: string | null;
  gunluk: string[];
  created_at: string;
  updated_at: string;
}

export interface Nabiz {
  son_gorulme: string | null;
  mesaj: string | null;
  makine: string | null;
}

/** Ekranda görünen durum etiketi ve rengi. Renk sınıfları Tailwind; tema değişkenleri accent. */
export const DURUM_BILGISI: Record<Durum, { etiket: string; ton: "bekle" | "calis" | "onay" | "hazir" | "yayin" | "hata" }> = {
  bekliyor: { etiket: "Sırada", ton: "bekle" },
  senaryo: { etiket: "Senaryo yazılıyor", ton: "calis" },
  senaryo_onay: { etiket: "Onayını bekliyor", ton: "onay" },
  onaylandi: { etiket: "Sırada", ton: "bekle" },
  ses: { etiket: "Seslendiriliyor", ton: "calis" },
  render: { etiket: "Video hazırlanıyor", ton: "calis" },
  hazir: { etiket: "Yüklemeye hazır", ton: "hazir" },
  yayinla: { etiket: "YouTube'a yükleniyor", ton: "calis" },
  yayinda: { etiket: "YouTube'a yüklendi", ton: "yayin" },
  hata: { etiket: "Hata", ton: "hata" },
};

/** Stüdyonun çalıştığı (ilerleme çubuğu anlamlı) durumlar */
export const CALISAN_DURUMLAR: Durum[] = ["senaryo", "ses", "render", "yayinla"];

export const SURE_SECENEKLERI = [30, 45, 60, 90, 120] as const;

/** Yeni bölüm formundaki yayın seçimi */
export type YayinModu = "elle" | "hemen" | "planli";
export const YAYIN_MODU_ETIKETI: Record<YayinModu, string> = {
  elle: "Hazır olunca ben yüklerim",
  hemen: "Hazır olunca hemen yayınla",
  planli: "Hazır olunca şu tarihte yayınla",
};

/** Yayındaki bölümün gerçek durumu: yüklenmiş olmak ile herkese açık olmak aynı şey değil. */
export function yayinDurumu(b: Pick<Bolum, "durum" | "gizlilik" | "yayin_zamani">): string {
  if (b.yayin_zamani && new Date(b.yayin_zamani).getTime() > Date.now()) {
    return `Planlandı · ${tarihBicimle(b.yayin_zamani)}`;
  }
  return { public: "Herkese açık", unlisted: "Yüklendi · liste dışı", private: "Yüklendi · gizli" }[b.gizlilik];
}

/** yayinda + gelecekte yayin_zamani → YouTube'da planlı bekliyor */
export function planliMi(b: Pick<Bolum, "durum" | "yayin_zamani">): boolean {
  return b.durum === "yayinda" && !!b.yayin_zamani && new Date(b.yayin_zamani).getTime() > Date.now();
}

/** "24 Eyl 21:00" */
export function tarihBicimle(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** datetime-local girdisi için yerel saatte "YYYY-MM-DDTHH:mm" (varsayılan: yarın 21:00) */
export function yerelTarihGirdisi(d: Date = varsayilanYayinZamani()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function varsayilanYayinZamani(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(21, 0, 0, 0);
  return d;
}

export const GIZLILIK_ETIKETI: Record<Gizlilik, string> = {
  unlisted: "Liste dışı (linki olan görür)",
  public: "Herkese açık",
  private: "Gizli",
};

/** 3725 → "1:02:05", 185 → "3:05" */
export function sureBicimle(saniye: number | null | undefined): string {
  if (saniye == null) return "";
  const s = Math.round(saniye);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sn = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sn).padStart(2, "0")}` : `${m}:${String(sn).padStart(2, "0")}`;
}

export function zamanOnce(iso: string): string {
  const sn = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sn < 60) return "az önce";
  const dk = Math.floor(sn / 60);
  if (dk < 60) return `${dk} dk önce`;
  const saat = Math.floor(dk / 60);
  if (saat < 24) return `${saat} saat önce`;
  const gun = Math.floor(saat / 24);
  if (gun < 7) return `${gun} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
}

/**
 * Senaryo markdown'ının kaba sağlaması — ablam düzenlerken başlığı ya da
 * bölüm başlıklarını silerse stüdyo bölümleyemez. Boş dizi = sorun yok.
 */
export function senaryoyuDogrula(md: string): string[] {
  const sorunlar: string[] = [];
  const satirlar = md.split("\n");
  if (!satirlar.some((s) => /^#\s+\S/.test(s))) sorunlar.push('Başlık satırı yok ("# Başlık" ile başlamalı).');
  const bolum = satirlar.filter((s) => /^##\s+\S/.test(s)).length;
  if (bolum < 2) sorunlar.push('En az iki "## Bölüm" başlığı olmalı.');
  const kelime = md.replace(/^#.*$/gm, "").split(/\s+/).filter(Boolean).length;
  if (kelime < 200) sorunlar.push("Metin çok kısa.");
  return sorunlar;
}

export const kelimeSay = (md: string) => md.replace(/^#.*$/gm, "").split(/\s+/).filter(Boolean).length;

/**
 * Hata sonrası "tekrar dene" hangi durumdan sürsün? Stüdyo hatayı aşama ön
 * ekiyle yazar ("[yukleme] ...", "[uretim] ...", "[senaryo] ..."); yükleme
 * hatasında video zaten hazır, baştan üretmek gereksiz.
 */
export function tekrarDeneDurumu(b: Pick<Bolum, "hata" | "senaryo_md" | "onizleme_url">): Durum {
  const h = b.hata ?? "";
  // Yükleme düştüyse video hazır: panele dön, ablam düğmeye yeniden basar
  if (h.startsWith("[yukleme]") && b.onizleme_url) return "hazir";
  if (h.startsWith("[senaryo]") || !b.senaryo_md) return "bekliyor";
  return "onaylandi";
}

/** Ekranda ön ek gösterilmesin */
export const hataMetni = (h: string | null) => (h ?? "").replace(/^\[[a-z]+\]\s*/, "");
