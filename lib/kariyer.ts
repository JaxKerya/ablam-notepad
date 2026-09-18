// Ablam Kariyer — paylaşılan tipler, sabitler ve saf yardımcılar.
// Hem arayüz (app/kariyer) hem tarayıcı (worker/) buradan okur.

// --- Tipler -----------------------------------------------------------------

/**
 * Modelin ablamın serbest metninden çıkardığı profil. Ablam düzenleyebilir;
 * eşleştirme BUNU okur, serbest metni değil. Bütün alanlar düz Türkçe, kısa
 * maddeler — ekranda "seni şöyle anladım" diye gösterilecek.
 */
export interface KariyerProfili {
  /** 1-2 cümle: kim, ne arıyor */
  ozet: string;
  /** Doğrudan yapabildiği işler ve pozisyonlar */
  yapabildigi: string[];
  /** Kendi alanı değil ama kabul edeceği işler — "ilgini çekebilir" buradan çıkıyor */
  kabulEder: string[];
  /** Açıkça istemedikleri — sert dışlama değil, modele güçlü olumsuz sinyal */
  istemez: string[];
  /** Öne çıkan beceri, deneyim, belge */
  guclu: string[];
  /** Kaynaklarda arama yapmak için kısa terimler (İŞKUR arama kutusuna gidecek) */
  aramaTerimleri: string[];
}

/**
 * Bölüm ablama açık mı? Vercel'de NEXT_PUBLIC_KARIYER_ACIK=false iken ana
 * sayfada "yakında" olarak durur, /kariyer "yakında" ekranı gösterir. Tarayıcı
 * (worker) bundan bağımsız çalışmaya devam eder — açıldığı gün liste dolu olsun.
 * Geliştiren kişi /kariyer?onizleme=1 ile açar (tarayıcıda kalıcı).
 */
export const KARIYER_ACIK = process.env.NEXT_PUBLIC_KARIYER_ACIK !== "false";
export const ONIZLEME_ANAHTARI = "kariyer-onizleme";

export type Kaynak = "iskur" | "ilangov" | "kariyerkapisi" | "linkedin" | "jooble" | "careerjet" | "kariyer" | "indeed" | "eposta";
export type Karar = "bildir" | "ozet" | "listele" | "ele";

/** Arayüzde ve e-postada görünen kaynak adı */
export const KAYNAK_ETIKETI: Record<string, string> = {
  iskur: "İŞKUR",
  ilangov: "ilan.gov.tr",
  kariyerkapisi: "Kariyer Kapısı",
  linkedin: "LinkedIn",
  jooble: "Jooble",
  careerjet: "Careerjet",
};
export const kaynakEtiketi = (k: string) => KAYNAK_ETIKETI[k] ?? k;
export type GeriBildirim = "ilgilendim" | "ilgilenmedim";

export interface KariyerIlani {
  id: string;
  kaynak: Kaynak;
  kaynak_id: string | null;
  parmak_izi: string;
  baslik: string;
  sirket: string | null;
  sehir: string | null;
  aciklama: string | null;
  url: string | null;
  yayin_tarihi: string | null;
  son_basvuru: string | null;
  gorulme: string;
}

export interface KariyerEslesmesi {
  ilan_id: string;
  puan: number;
  gerekce: string | null;
  uyusan: string[];
  uyusmayan: string[];
  karar: Karar;
  bildirildi: string | null;
  geri_bildirim: GeriBildirim | null;
  geri_bildirim_notu: string | null;
  degerlendirildi: string;
}

/** Kaynaktan gelen, henüz kaydedilmemiş ilan */
export interface HamIlan {
  kaynak: Kaynak;
  kaynakId?: string;
  baslik: string;
  sirket?: string;
  sehir?: string;
  aciklama?: string;
  url?: string;
  yayinTarihi?: string;
  sonBasvuru?: string;
  /** Kaynağın verdiği maaş metni (Jooble/Careerjet); modele gider, kolon değil */
  maas?: string;
  ham?: unknown;
}

// --- Eşikler ----------------------------------------------------------------

/**
 * Puan -> karar. Bildirim yorgunluğuna karşı asıl savunma bu üç sayı:
 * günde 20 orta halli eşleşme gönderilirse bir haftada susturulur.
 *   bildir  — anında e-posta
 *   ozet    — akşam tek özet mesajında
 *   listele — yalnızca arayüzde
 *   ele     — kaydedilir ama gösterilmez (ölçüm ve geri dönüş için)
 * Değerler ilk haftalarda ablamın geri bildirimiyle ayarlanacak.
 */
export const ESIK = { bildir: 75, ozet: 50, listele: 25 } as const;

export function kararVer(puan: number): Karar {
  if (puan >= ESIK.bildir) return "bildir";
  if (puan >= ESIK.ozet) return "ozet";
  if (puan >= ESIK.listele) return "listele";
  return "ele";
}

export const KARAR_ETIKETI: Record<Karar, string> = {
  bildir: "Güçlü eşleşme",
  ozet: "Bakmaya değer",
  listele: "Zayıf",
  ele: "Uyumsuz",
};

// --- Metin yardımcıları -------------------------------------------------------

const TR_HARF: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
  Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
};

/** Türkçe harfleri katlar, küçültür, harf-rakam dışını tek boşluğa indirir */
export function sadelestir(metin: string): string {
  return metin
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (h) => TR_HARF[h] ?? h)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Tekilleştirme anahtarı: aynı ilan bir sonraki taramada ikinci kez
 * değerlendirilmesin.
 *
 * Kaynak kimlik veriyorsa kaynak#kimlik — kaynağın kendi "aynı ilan" tanımı.
 * İlk sürüm şirketli ilanda başlık+şirket+şehir kullanıyordu; aynı şirket aynı
 * unvanla YENİ ilan açınca eskiyle çakışıp kayboluyordu (denetim bulgusu).
 * Aynı ilanın iki kaynaktan iki kayıt olması kabul edilen bedel — kaynaklar
 * arası benzerlik tekilleştirmesi denenip kaldırılmıştı (worker/degerlendir.ts).
 * Kimlik yoksa başlık+şirket+şehir.
 */
export function parmakIzi(ilan: Pick<HamIlan, "kaynak" | "kaynakId" | "baslik" | "sirket" | "sehir">): string {
  if (ilan.kaynakId) return `${ilan.kaynak}#${ilan.kaynakId}`;
  return [ilan.kaynak, sadelestir(ilan.baslik), sadelestir(ilan.sirket ?? ""), sadelestir(sehirAdi(ilan.sehir ?? ""))].join("|");
}

/** "İSTANBUL / FATİH" -> "İSTANBUL", "Ankara (Çankaya)" -> "Ankara". Parmak izi için; filtre için değil. */
export function sehirAdi(ham: string): string {
  return ham.split(/[\/(,\-–]/)[0].trim();
}

/** 81 il, sadeleştirilmiş. Filtre yalnızca bu adlardan birini görünce karar veriyor. */
const ILLER = new Set(
  [
    "adana", "adiyaman", "afyonkarahisar", "afyon", "agri", "amasya", "ankara", "antalya", "artvin", "aydin",
    "balikesir", "bilecik", "bingol", "bitlis", "bolu", "burdur", "bursa", "canakkale", "cankiri", "corum",
    "denizli", "diyarbakir", "edirne", "elazig", "erzincan", "erzurum", "eskisehir", "gaziantep", "giresun",
    "gumushane", "hakkari", "hatay", "isparta", "mersin", "icel", "istanbul", "izmir", "kars", "kastamonu",
    "kayseri", "kirklareli", "kirsehir", "kocaeli", "konya", "kutahya", "malatya", "manisa", "kahramanmaras",
    "maras", "mardin", "mugla", "mus", "nevsehir", "nigde", "ordu", "rize", "sakarya", "samsun", "siirt",
    "sinop", "sivas", "tekirdag", "tokat", "trabzon", "tunceli", "sanliurfa", "urfa", "usak", "van", "yozgat",
    "zonguldak", "aksaray", "bayburt", "karaman", "kirikkale", "batman", "sirnak", "bartin", "ardahan",
    "igdir", "yalova", "karabuk", "kilis", "osmaniye", "duzce",
  ]
);

/**
 * Konum metninin içindeki il adları. Kaynaklar üç biçimde veriyor:
 * "Küçükçekmece, İstanbul" (Careerjet, ilçe önce), "Sincan" (LinkedIn, yalnız
 * ilçe), "Üsküdar, Kuzguncuk" (Jooble, ilçe+semt), "ANKARA / SİNCAN" (İŞKUR).
 * Parçalara bölünür, il listesinde olanlar döner. "İstanbul Avrupa" gibi
 * çok kelimeli parçalar için kelime kelime de bakılır.
 */
export function konumdakiIller(konum: string): string[] {
  const bulunan = new Set<string>();
  for (const parca of konum.split(/[\/(),\-–|]/)) {
    const sade = sadelestir(parca);
    if (!sade) continue;
    if (ILLER.has(sade)) bulunan.add(sade);
    for (const kelime of sade.split(" ")) if (ILLER.has(kelime)) bulunan.add(kelime);
  }
  return [...bulunan];
}

// Hibrit uzaktan DEĞİL: "haftada 3 gün İstanbul ofisi" Ankara'daki kişiye uymaz.
const UZAKTAN = /\b(uzaktan|remote|home ?office|evden)\b/i;

export function uzaktanMi(ilan: Pick<HamIlan, "baslik" | "aciklama" | "sehir">): boolean {
  return UZAKTAN.test([ilan.baslik, ilan.aciklama ?? "", ilan.sehir ?? ""].join(" "));
}

// --- Sert filtre ----------------------------------------------------------------

export interface FiltreProfili {
  /** Boş = her yer. Birden fazla olabilir; ilan bunlardan birine uyarsa geçer. */
  sehirler: string[];
  uzaktan_olur: boolean;
  /**
   * TL/ay. Sert filtre DEĞİL — ilanların çoğu maaş yazmıyor, yazmayanı elemek
   * yanlış olurdu. Modele şart olarak gider: yazıyorsa ve altındaysa düşük puan.
   */
  asgari_maas: number | null;
}

/** Modelin "bunlar da uyabilir" dediği yakın işler — ablam tıklayıp ekler, eklemezse yok sayılır */
export interface ProfilOnerisi {
  is: string;
  neden: string;
}

/**
 * Model çağrılmadan önce uygulanan filtre. Yargı değil, mekanik eleme:
 * şehir uyuşmuyorsa ve ilan uzaktan değilse modele hiç sorulmaz — para da
 * gürültü de burada kesiliyor. Elenme sebebini döndürür, geçerse null.
 *
 * Bilerek dar: yalnızca kesin olarak bilinen şeyleri eliyor. Şehri boş ilan
 * elenmez, model bakar. Yanlış eleme yanlış bildirimden daha kötü — elenen
 * ilan bir daha görülmüyor.
 */
export function sertFiltre(ilan: HamIlan, profil: FiltreProfili): string | null {
  if (!profil.sehirler.length || !ilan.sehir) return null;
  // İl adı yoksa ("Sincan", "Üsküdar, Kuzguncuk") elenmez — model ilçeyi bilir.
  // İlk sürüm virgülden önceki parçayı il sanıp "Küçükçekmece, İstanbul"ı eliyordu.
  const ilanin = konumdakiIller(ilan.sehir);
  if (!ilanin.length) return null;
  const istenen = profil.sehirler.map(sadelestir);
  if (ilanin.some((il) => istenen.includes(il))) return null;
  if (profil.uzaktan_olur && uzaktanMi(ilan)) return null;
  return `şehir uyuşmuyor (${ilan.sehir})`;
}

/** Şehir listesini temizler: boşları atar, "ankara" -> "Ankara", tekrarları siler */
export function sehirleriDogrula(ham: unknown): string[] {
  if (!Array.isArray(ham)) return [];
  const gorulen = new Set<string>();
  const sonuc: string[] = [];
  for (const x of ham) {
    if (typeof x !== "string") continue;
    const ad = x.trim().replace(/\s+/g, " ");
    if (!ad) continue;
    const anahtar = sadelestir(ad);
    if (gorulen.has(anahtar)) continue;
    gorulen.add(anahtar);
    sonuc.push(ad.charAt(0).toLocaleUpperCase("tr") + ad.slice(1).toLocaleLowerCase("tr"));
  }
  return sonuc.slice(0, 10);
}

// --- Boş profil ----------------------------------------------------------------

export const BOS_PROFIL: KariyerProfili = {
  ozet: "",
  yapabildigi: [],
  kabulEder: [],
  istemez: [],
  guclu: [],
  aramaTerimleri: [],
};

/** Modelden gelen profil nesnesini güvenli hâle getirir */
export function profilDogrula(ham: unknown): KariyerProfili {
  const o = (ham && typeof ham === "object" ? ham : {}) as Record<string, unknown>;
  const dizi = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, 20)
      : [];
  return {
    ozet: typeof o.ozet === "string" ? o.ozet.trim() : "",
    yapabildigi: dizi(o.yapabildigi),
    kabulEder: dizi(o.kabulEder),
    istemez: dizi(o.istemez),
    guclu: dizi(o.guclu),
    aramaTerimleri: dizi(o.aramaTerimleri).slice(0, 12),
  };
}

/** Modelden gelen öneri listesini güvenli hâle getirir */
export function onerileriDogrula(ham: unknown): ProfilOnerisi[] {
  if (!Array.isArray(ham)) return [];
  return ham
    .map((o) => {
      const x = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
      return {
        is: typeof x.is === "string" ? x.is.trim() : "",
        neden: typeof x.neden === "string" ? x.neden.trim() : "",
      };
    })
    .filter((o) => o.is)
    .slice(0, 8);
}

export function profilBosMu(p: KariyerProfili | null | undefined): boolean {
  return !p || (!p.ozet && !p.yapabildigi.length && !p.kabulEder.length);
}

/** Profili değerlendirme prompt'una girecek düz metne çevirir */
export function profilMetni(p: KariyerProfili): string {
  const satir = (baslik: string, ogeler: string[]) =>
    ogeler.length ? `${baslik}:\n${ogeler.map((o) => `- ${o}`).join("\n")}` : "";
  return [
    p.ozet,
    satir("Yapabildiği işler", p.yapabildigi),
    satir("Kabul edeceği işler", p.kabulEder),
    satir("İstemedikleri", p.istemez),
    satir("Güçlü yanları", p.guclu),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Son başvuruya kalan gün (bugün dahil değil): 0 = bugün son gün, negatif = geçti, null = tarih yok */
export function kalanGun(sonBasvuru: string | null | undefined, simdi = new Date()): number | null {
  if (!sonBasvuru) return null;
  const son = new Date(sonBasvuru.slice(0, 10) + "T23:59:59+03:00"); // Türkiye günü
  if (Number.isNaN(son.getTime())) return null;
  return Math.floor((son.getTime() - simdi.getTime()) / 86_400_000);
}

/** "son başvuru 24 Eyl (5 gün)"; geçmişse "son başvuru geçti" */
export function sonBasvuruMetni(sonBasvuru: string | null | undefined): string | null {
  const kalan = kalanGun(sonBasvuru);
  if (kalan === null) return null;
  const tarih = new Date(sonBasvuru!.slice(0, 10) + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
  if (kalan < 0) return "son başvuru geçti";
  if (kalan === 0) return `son başvuru bugün (${tarih})`;
  return `son başvuru ${tarih} (${kalan} gün)`;
}

export function tarihMetni(dateStr: string): string {
  const fark = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (fark < 3600) return `${Math.max(1, Math.floor(fark / 60))} dk önce`;
  if (fark < 86400) return `${Math.floor(fark / 3600)} saat önce`;
  const gun = Math.floor(fark / 86400);
  return gun < 7 ? `${gun} gün önce` : `${Math.floor(gun / 7)} hafta önce`;
}
