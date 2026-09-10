// Ablam Ders — paylaşılan tipler, sabitler ve yardımcılar

export type SessionStatus = "hazirlaniyor" | "hazir" | "hata";
export type OturumTuru = "ders" | "tekrar";
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
  /**
   * Oturumun videosu. TEKRAR oturumlarında bu alan yalnızca ilk kaynak videoyu
   * gösterir ve soru düzeyinde hiçbir karar buna bakarak verilmez — soru-video
   * ilişkisi ders_questions.video_id üzerinden kurulur.
   */
  video_id: string;
  title: string | null;
  summary: string | null;
  topics: string[];
  /** Tarih, Coğrafya, Vatandaşlık... Üretimde model belirler. */
  kategori: string | null;
  /** 'ders' bir videodan üretildi, 'tekrar' kategoriden karıştırıldı */
  tur: OturumTuru;
  status: SessionStatus;
  error: string | null;
  /** Denetimin bu oturumda ne yaptığı — şeffaflık için sonuç ekranında gösterilir */
  denetim: DenetimOzeti;
  created_at: string;
  updated_at: string;
}

export interface DersQuestion {
  id: string;
  session_id: string;
  /** Sorunun kendi videosu; tekrar oturumlarında oturumunkinden farklı olabilir */
  video_id: string | null;
  /** Tekrar kopyasıysa kaynak sorunun kimliği */
  kaynak_soru_id: string | null;
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

// --- Denetim kaydı ----------------------------------------------------------
//
// Denetimin verdiği kararlar eskiden yalnızca console.warn'a gidiyordu ve API
// kayıtlarıyla ~24 saatte siliniyordu; oturumda sadece iki sayı kalıyordu
// ("2 düzeltme, 1 eleme"). Hangi soruya ne yapıldığı, hangi gerekçeyle, hangi
// katmanın bulduğu görünmüyordu. En kötüsü: emniyet valfi devreye girip bütün
// bulguları attığında bu, "denetim hiçbir şey bulmadı" ile birebir aynı
// görünüyordu. Artık hepsi ders_sessions.denetim içine yazılıyor ve
// /ders/aiview sayfasında gösteriliyor.

/** Bir kaydın gerekçesi bu uzunlukta kırpılır — oturum satırı şişmesin */
export const DENETIM_GEREKCE_SINIRI = 300;
/** Bir oturumda saklanacak en fazla kayıt sayısı */
export const DENETIM_KAYIT_SINIRI = 80;
/**
 * Ham model çıktısı bu uzunlukta kırpılır. Ham çıktı YALNIZCA bir şey ters
 * gittiğinde saklanıyor (valf devreye girdi, ya da soru elendi) — her derste
 * saklamak oturum başına ~25 KB demekti ve her okumayı şişiriyordu.
 */
export const HAM_CIKTI_SINIRI = 20000;

export type DenetimKatmani = "transkript" | "olgu" | "bicim";

export type DenetimIslemi =
  | "anahtar"              // cevap anahtarı değiştirildi (en kritik olanı)
  | "sik"                  // doğru şıkkın metni düzeltildi
  | "aciklama"             // açıklama düzeltildi
  | "aciklama-dusuruldu"   // açıklama düzeltilemedi, kaldırıldı, soru kaldı
  | "anahtar-duzeltildi"   // açık uçlunun beklenen cevabı düzeltildi
  | "elendi"               // soru atıldı
  | "bicim-elendi";        // soru daha denetime girmeden biçim şartına takıldı

export interface DenetimKaydi {
  katman: DenetimKatmani;
  soru: string;
  islem: DenetimIslemi;
  /** elendi/bicim-elendi için kısa sebep etiketi */
  sebep?: string;
  eski?: string;
  yeni?: string;
  gerekce?: string;
  /**
   * Yalnızca ELENEN sorularda dolu: sorunun tam hâli (kök + şıklar + işaretli
   * cevap). "Bu eleme doğru muydu?" sorusuna 120 karakterlik kırpılmış kökle
   * bakılamıyordu. Eleme nadir olduğu için maliyeti düşük.
   */
  tamMetin?: string;
}

/** Bir denetim geçişinin özeti — valf devreye girdiyse bulgular UYGULANMADI */
export interface DenetimGecisi {
  katman: "transkript" | "olgu";
  bulgu: number;
  valf: boolean;
  sn: number;
  girdiToken: number;
  ciktiToken: number;
  model?: string;
  /**
   * Valf devreye girdiğinde denetimin ham cevabı. Bunlar atılan bulgular:
   * başka hiçbir yerde iz bırakmıyorlar, oysa "denetim ne iddia etmişti"
   * sorusunun cevabı tam olarak burada.
   */
  hamCevap?: string;
}

export interface DenetimAdimi {
  adim: "acik" | "coktan" | "not";
  /** Modelin döndürdüğü ham öğe sayısı */
  uretilen: number;
  /** Biçim şartına takılanların sebep kırılımı */
  bicimElenen?: Record<string, number>;
  hedef: number;
  nihai: number;
  uretimSn?: number;
  uretimGirdiToken?: number;
  uretimCiktiToken?: number;
  uretimModeli?: string;
  /** Üretim modelinin ham çıktısı — yalnızca bu adımda bir şey ters gittiyse */
  hamUretim?: string;
  gecisler: DenetimGecisi[];
  kayitlar: DenetimKaydi[];
}

export interface DenetimOzeti {
  duzeltilen: number;
  elenen: number;
  /** Eski oturumlarda yok — sayfa bu alanın olmamasını tolere eder */
  adimlar?: DenetimAdimi[];
}

/** Uzun gerekçeleri kırpar; boşsa alanı hiç yazmamak için undefined döner */
export function gerekceKirp(metin: string | undefined): string | undefined {
  const t = (metin ?? "").trim();
  if (!t) return undefined;
  return t.length > DENETIM_GEREKCE_SINIRI
    ? t.slice(0, DENETIM_GEREKCE_SINIRI - 1) + "…"
    : t;
}

/** Soru metnini kayda yazarken kısaltır */
export function soruKirp(metin: string): string {
  const t = metin.trim();
  return t.length > 120 ? t.slice(0, 119) + "…" : t;
}

/** Ham çıktıyı sınırında kırpar ve kırpıldığını metnin içinde belli eder */
export function hamKirp(metin: string): string {
  return metin.length > HAM_CIKTI_SINIRI
    ? metin.slice(0, HAM_CIKTI_SINIRI) + "\n\n…(kırpıldı)"
    : metin;
}

// --- Sabitler ---------------------------------------------------------------

/**
 * Soru sayısı sabit değil, dersin uzunluğuna göre hesaplanıyor: kabaca her üç
 * dakikalık anlatım için bir soru, 8 ile 26 arasında sıkıştırılmış.
 *
 * Ağırlık çoktan seçmelide (%80): KPSS'nin kendisi çoktan seçmeli, sınav
 * refleksi orada kazanılıyor. Açık uçlular kalan %20 — onlar da öğrenmeyi
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
  const acik = Math.max(2, Math.round(toplam * 0.2));
  return { toplam, coktan: toplam - acik, acik };
}

/** Bir oturumun anlamlı sayılması için gereken en az soru sayısı */
export const EN_AZ_SORU = 4;

/**
 * Kategoriler kapalı bir liste. Serbest bırakılsaydı model aynı dersi bir gün
 * "Tarih", ertesi gün "T.C. İnkılap Tarihi" diye adlandırır, liste dağılır ve
 * "Soru Gönder" havuzu bölünürdü. Prompt da doğrulama da bu listeyi kullanıyor.
 */
export const KATEGORILER = [
  "Tarih",
  "Coğrafya",
  "Vatandaşlık",
  "Türkçe",
  "Matematik",
  "Eğitim Bilimleri",
  "Güncel Bilgiler",
] as const;

/** Listeye girmeyen ya da belirlenemeyen dersler burada toplanır */
export const KATEGORI_DIGER = "Diğer";

/** Modelden gelen kategoriyi kapalı listeye oturtur */
export function kategoriDogrula(ham: unknown): string {
  const t = typeof ham === "string" ? ham.trim() : "";
  const eslesen = KATEGORILER.find((k) => k.toLocaleLowerCase("tr") === t.toLocaleLowerCase("tr"));
  return eslesen ?? KATEGORI_DIGER;
}

/**
 * Tekrar oturumuna kaç soru konur. Tek dersin 26 soruluk tavanının altında
 * tutuldu: tekrar oturumu bir sınav değil, karışık bir gözden geçirme.
 */
export const TEKRAR_SORU_SAYISI = 20;

/**
 * Ders özetlerinin kaydedildiği klasör. Mevcut klasör sistemi kullanılıyor:
 * özetler bu klasöre düşüyor, ana not listesinde görünmüyor, kendi
 * "Ders notlarını görüntüle" düğmesinin altında listeleniyor.
 */
export const DERS_NOTLARI_KLASORU = "Ders Notları";

/**
 * Supadata ücretsiz katmanının aylık transkript kotası. Kota dolunca transkript
 * elle yapıştırmaya kalıyor; aiview'deki sayaç bunu ayın ortasında görünür
 * kılmak için var, ay sonunda sürpriz olmasın diye.
 */
export const SUPADATA_AYLIK_KOTA = 100;

/** Günlük soru üretimi tavanı — sızan bir linkin faturayı şişirmesini engeller */
export const GUNLUK_URETIM_LIMITI = 40;

// --- Üretim kuyruğu ---------------------------------------------------------
//
// Ablam birkaç dersi arka arkaya izleyip hepsini birden işleme koymak istiyor;
// önceki akışta ilk ders bitene kadar ikinci linki yapıştıramıyordu. Kuyruk
// istemcide (bkz. components/ders/DersKuyrugu.tsx) yaşıyor, buradakiler ise
// React dışında da ölçülebilsin diye ayrılmış saf parçalar.

/**
 * Aynı anda kaç ders üretimi çalışsın.
 *
 * 3, ÖLÇÜLEN tek sert tavana göre seçildi: tarayıcı bir kaynağa http/1.1
 * üzerinden yalnızca 6 isteği aynı anda gönderiyor. (Ölçüm: 12 paralel istekten
 * 6'sı yola çıktı, kalanı 1789 ms'ye kadar kuyrukta bekledi; yerel geliştirme
 * sunucusu http/1.1 konuşuyor. Canlıda Vercel h2 verdiği için bu tavan orada
 * yok.) Üretim dışındaki istekler — ders listesi, transkript araması, notlar —
 * aynı 6'lık havuzu paylaştığı için 3 üretim üstü ablamın arama kutusunu
 * takılmaya başlatır.
 *
 * BİLMEDİĞİM SINIR: sağlayıcının ani yükte 429 dönüp dönmediği ölçülmedi.
 * OpenRouter anahtarında tanımlı bir istek sınırı yok (ücretli katman,
 * limit: null); Vercel'in eşzamanlı fonksiyon tavanı da sorgulanamadı. 429
 * gelirse iş "hata" kartında durur, "Tekrar dene" kurtarır — sessiz kayıp yok.
 *
 * Faydası (benzetim, ders başına 2-4 dk, 5 ders): sıralı 14:57 → 2 ile 8:29 →
 * 3 ile 6:08. Yukarısı hızla doyuyor ve asıl önemli sayı olan "ilk ders hazır"
 * süresi zaten eşzamanlılıktan bağımsız (~2,5 dk).
 *
 * MALİYETİ DEĞİŞTİRMİYOR: paralellik aynı işi daha kısa sürede yapıyor, ders
 * başına ~$0,20 aynı kalıyor. Günlük tavan hâlâ GUNLUK_URETIM_LIMITI.
 */
export const ES_ZAMANLI_URETIM = 3;

/** Kuyruktaki bir işin durumu */
export type IsDurumu =
  | "bekliyor"
  | "transkript"
  | "acik"
  | "coktan"
  | "hazir"
  | "elle"
  | "hata";

/** Model çağıran, yani hem para hem süre harcayan durumlar */
export const IS_CALISIYOR: IsDurumu[] = ["transkript", "acik", "coktan"];

export interface UretimIsi {
  id: string;
  /** "yeni": linkten baştan üretim · "tamamla": yarım kalmış oturumun 2. adımı */
  tur: "yeni" | "tamamla";
  url: string;
  videoId: string | null;
  sessionId: string | null;
  baslik: string | null;
  sure: number;
  durum: IsDurumu;
  hata: string | null;
  /** Otomatik transkript düşerse ablamın yapıştırdığı metin */
  elleTranskript?: string;
}

/**
 * Sırada başlatılabilecek ilk iş — yoksa null.
 *
 * İki kural var:
 *   1. Aynı anda en fazla `sinir` kadar iş çalışır.
 *   2. Video kimliği bilinen bir iş, aynı videoyu işleyen başka bir iş
 *      çalışırken başlatılmaz. Sebebi para değil VERİ: generate ucu 1. adımda
 *      aynı videonun yarım kalmış oturumlarını siliyor, aynı video iki kez
 *      paralel işlenirse biri diğerinin oturumunu süpürebilir.
 *
 * "yeni" işlerin video kimliği transkript gelene kadar null olduğu için ikinci
 * kural burada her şeyi yakalayamaz; transkript döndükten sonraki kontrol
 * DersKuyrugu içinde.
 */
export function baslatilacakIs(isler: UretimIsi[], sinir = ES_ZAMANLI_URETIM): UretimIsi | null {
  const calisan = isler.filter((i) => IS_CALISIYOR.includes(i.durum));
  if (calisan.length >= sinir) return null;

  const mesgul = new Set(calisan.map((i) => i.videoId).filter(Boolean));
  return isler.find((i) => i.durum === "bekliyor" && !(i.videoId && mesgul.has(i.videoId))) ?? null;
}

/**
 * Yapıştırılan metinden linkleri ayıklar. Ablam beş dersin linkini tek seferde
 * yapıştırabilsin diye: satır, boşluk ya da virgülle ayrılmış her parça bir iş.
 * Aynı link iki kez yazılmışsa bir kez alınıyor.
 */
export function linkleriAyikla(metin: string): string[] {
  const parcalar = metin
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return [...new Set(parcalar)];
}

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

/** Çıkarılan ders notunun yapısı — modelin döndürdüğü şema */
export interface NotBolumu {
  baslik: string;
  maddeler: string[];
  /** Bu bölümün videoda anlatıldığı an (saniye) */
  saniye: number;
}

export interface NotTerimi {
  terim: string;
  aciklama: string;
}

export interface DersNotIcerigi {
  giris: string;
  bolumler: NotBolumu[];
  terimler: NotTerimi[];
}

/**
 * Şık metninin başındaki harf önekini temizler: "A) İltizam" -> "İltizam".
 *
 * Arayüz şıkları kendisi A-E diye harfliyor. Prompt'ta şık sayısını beşe
 * çıkarıp harfleri (A, B, C, D, E) açıkça yazınca model harfleri şık
 * METNİNE de koymaya başladı ve ekranda "A) A) İltizam" çıktı. Prompt'a
 * yasak eklendi ama tek başına ona güvenmiyoruz — bu oturumda tutmayan
 * prompt kuralı gördük, ucuz olan yerde kural kodda dursun.
 */
export function sikOnekiniAt(sik: string): string {
  // Sınıf bilerek DAR: yalnızca A-E. Türkçe harfleri de kapsasaydı
  // "İ. Ahmed dönemi" gibi bir şık "Ahmed dönemi"ne kırpılırdı. Roma
  // rakamları (I., II., IV., V.) zaten A-E dışında kaldığı için güvende.
  return sik.replace(/^[A-Ea-e][)\.\-:]\s*/, "").trim();
}

/**
 * Açıklamanın başındaki hüküm sözünü atar: "Doğru! Avarız..." -> "Avarız...".
 *
 * Açıklama, öğrencinin cevabından BAĞIMSIZ olarak üretim sırasında yazılıyor;
 * hükmü ise grade ucu cevaba bakarak veriyor. Model açıklamayı hüküm sözüyle
 * başlatınca ikisi çakışıyor ve YANLIŞ cevap veren öğrenci
 * "Doğru cevap B) ... Doğru! ..." okuyor. Ölçüldü: açıklamaların %26'sı böyle
 * başlıyordu. Prompt'a yasak eklendi, ama tek başına ona güvenmiyoruz.
 */
export function hukumOneksizAciklama(aciklama: string): string {
  const sade = aciklama
    .replace(/^(doğru|yanlış|evet|hayır|tebrikler|maalesef)\s*[!.,;:—-]+\s*/i, "")
    .trim();
  return sade ? sade[0].toLocaleUpperCase("tr") + sade.slice(1) : aciklama;
}

/**
 * Şıkları karıştırır ve doğru şıkkın yeni indeksini döndürür.
 *
 * Ölçüldü: modeller doğru şıkkı A'ya koymaya eğilimli. 26 üretilmiş soruda
 * dağılım A:19 B:3 C:2 D:1 E:1 çıktı — beklenen her biri ~5. Model bazında
 * daha da net: luna 8/8, opus-5 9/9 hep A; sol dağıtıyor (A:2 B:3 C:2 D:1 E:1).
 * Yani şu anki modelimizde sorun görünmüyor, ama bu modelin huyuna bağlı bir
 * güvence ve model değişince sessizce kaybolur. Kodda karıştırınca sınav
 * geçerliliği modelden bağımsız hâle geliyor: ablam soruyu okumadan A
 * işaretleyerek puan alamaz.
 *
 * Not: "yukarıdakilerin hepsi" gibi konuma bağlı şıklar karıştırmayı bozardı;
 * coktanPrompt böyle şık istemiyor ve üretilenlerde de hiç görülmedi.
 */
/**
 * Türkçe/aksan duyarsız sadeleştirme. Şıkların birbirinin aynısı olup olmadığı
 * buna göre karşılaştırılıyor.
 *
 * Projenin başka yerlerindeki altı harflik eşleme tablosu (slugla,
 * icerikKelimeleri) şapkalı harfleri (â, î, û) tanımıyor ve onları "a-z değil"
 * diye tamamen siliyor — "millî" -> "mill", "milli" -> "milli", karşılaştırma
 * tutmuyor. Unicode ayrıştırması bütün aksanları katlıyor; ayrıca ele alınması
 * gereken tek harf, ayrışmayan noktasız "ı".
 */
export function sikSadelestir(metin: string): string {
  return metin
    .toLowerCase()
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * İki metin birbirinden yeterince farklı mı? Tekrar varyantlarında kullanılıyor.
 *
 * Ölçümle eklendi: ilk denemede açık uçlu varyantın soru kökü yeniden yazılmıştı
 * ama CEVAP ANAHTARI kaynağınkinin kopyasıydı — ilk cümlesi değiştirilmiş, gerisi
 * aynen alınmıştı. Çoktan seçmelide "çeldiricileri yeniden yaz" kuralı varyantı
 * zaten değiştiriyor; açık uçluda böyle bir zorlama yok.
 *
 * ÖLÇÜT KELİME ÖRTÜŞMESİ, kapsama değil. Önce kapsama denendi ve motive eden
 * vakayı YAKALAMADI: varyant kaynağın birebir alt dizesi değildi ("ciddi bir
 * baskı" -> "baskı"). Örtüşme oranı (varyantın kelimelerinin kaçı kaynakta var)
 * 20 gerçek çift üzerinde ölçüldü:
 *   kabul edilebilir varyantlar : 0,14 - 0,67  (ortanca 0,30)
 *   elenmesi istenen vaka       : 0,94
 * Eşik 0,80: en yüksek kabul edilebilir değerin de, elenmesi gerekenin de
 * uzağında. Takılan varyant düzeltilmiyor, o slot kaynağın kopyasına dönüyor.
 */
export function yeterinceFarkli(varyant: string, kaynak: string, esik = 0.8): boolean {
  const kelimeler = (m: string) =>
    new Set(
      m
        .toLowerCase()
        .replace(/ı/g, "i")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4)
    );
  const a = kelimeler(varyant);
  if (a.size < 4) return true; // çok kısa metinde oran gürültülü
  const b = kelimeler(kaynak);
  let ortak = 0;
  for (const w of a) if (b.has(w)) ortak++;
  return ortak / a.size < esik;
}

/**
 * Bir çoktan seçmeli soruyu şık kuralına göre doğrular ve şıkları karıştırır.
 * Geçmezse null döner — çağıran soruyu eler.
 *
 * Beş TANE değil, beş AYRI ve DOLU şık aranıyor:
 *   - Harf öneki temizlendikten SONRA sayılıyor; "A)" gibi tek başına önekten
 *     ibaret bir şık temizlenince boşalır ve ortada dört şık artı bir boşluk kalır.
 *   - Boş şık ekranda harfi olan ama metni olmayan bir satır bırakır.
 *   - Aynı metinli iki şık hem soruyu iki doğru cevaplı yapar hem de
 *     siklariKaristir'daki indexOf'u belirsizleştirir (ilk kopyayı bulur).
 *
 * Hem ders üretimi hem tekrar varyantları buradan geçiyor: kural tek yerde.
 */
export function sikSetiniDogrula(
  hamSecenekler: unknown,
  dogru: unknown,
  sikSayisi: number
): { secenekler: string[]; dogruIndeks: number } | null {
  const sec = (Array.isArray(hamSecenekler) ? hamSecenekler : [])
    .filter((x): x is string => typeof x === "string" && !!x.trim())
    .map(sikOnekiniAt);

  if (sec.length !== sikSayisi) return null;
  if (!sec.every((o) => o.length > 0)) return null;
  if (new Set(sec.map(sikSadelestir)).size !== sikSayisi) return null;
  if (!(typeof dogru === "number" && Number.isInteger(dogru) && dogru >= 0 && dogru < sec.length)) {
    return null;
  }
  return siklariKaristir(sec, dogru);
}

export function siklariKaristir(
  secenekler: string[],
  dogruIndeks: number
): { secenekler: string[]; dogruIndeks: number } {
  const dogruMetin = secenekler[dogruIndeks];
  const kopya = [...secenekler];
  for (let i = kopya.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kopya[i], kopya[j]] = [kopya[j], kopya[i]];
  }
  return { secenekler: kopya, dogruIndeks: kopya.indexOf(dogruMetin) };
}

// --- Vurgu renkleri ---------------------------------------------------------

/**
 * Not İÇERİĞİNE yazılan renkler — tema tokenlarına bağlanmaz, birebir kalır.
 * Toolbar'daki HIGHLIGHT_COLORS ile aynı değerler; ablam elle vurguladığında
 * çıkan renkle üretilen not aynı görünsün diye.
 *
 * Üç renk, üç anlam. Daha fazlası vurguyu vurgu olmaktan çıkarır:
 *   sarı  — ezberlenecek nicel bilgi (tarih, sayı, süre)
 *   mavi  — özel isim (kişi, yer, kurum, eser)
 *   yeşil — dersin anahtar kavramı
 */
const VURGU = {
  sari: "rgba(234, 179, 8, 0.25)",
  mavi: "rgba(56, 189, 248, 0.20)",
  yesil: "rgba(212, 228, 165, 0.30)",
} as const;

/** Modelin kullandığı işaretler -> vurgu rengi */
const ISARET: Record<string, string> = {
  t: VURGU.sari,
  i: VURGU.mavi,
  k: VURGU.yesil,
};

/**
 * Model maddeleri `[t]1683[/t]`, `[i]Kösem Sultan[/i]`, `[k]iltizam[/k]` gibi
 * işaretlerle yazıyor; burada TipTap vurgu işaretlemelerine çevriliyor.
 *
 * Ayrıştırıcı kasten toleranslı: gerçek çıktıda modelin kapanış parantezini
 * düşürdüğü görüldü ("[k]doğal sınırlara[/k ulaştı"). Kapanışın son köşeli
 * parantezi isteğe bağlı, ve hangi biçimde olursa olsun artakalan işaretler
 * metinden temizleniyor — ekranda "[/k" gibi bir kalıntı görünmesin.
 * Eşi hiç bulunmayan işaretlerde vurgu düşer, metin düz geçer.
 */
export function satiriDugumlere(metin: string): unknown[] {
  const dugumler: unknown[] = [];
  const desen = /\[([tik])\]([\s\S]*?)\[\/\1\]?/g;
  let son = 0;
  let eslesme: RegExpExecArray | null;

  const duzMetin = (ham: string) => ham.replace(/\[\/?[tik]\]?/g, "");

  while ((eslesme = desen.exec(metin)) !== null) {
    const onces = duzMetin(metin.slice(son, eslesme.index));
    if (onces) dugumler.push({ type: "text", text: onces });

    const icerik = duzMetin(eslesme[2]);
    if (icerik) {
      dugumler.push({
        type: "text",
        text: icerik,
        marks: [{ type: "highlight", attrs: { color: ISARET[eslesme[1]] } }],
      });
    }
    son = eslesme.index + eslesme[0].length;
  }

  const kalan = duzMetin(metin.slice(son));
  if (kalan) dugumler.push({ type: "text", text: kalan });

  return dugumler.length ? dugumler : [{ type: "text", text: duzMetin(metin) || " " }];
}

/**
 * Kavram vurgularını sözlükle sınırlar: `[k]...[/k]` işareti yalnızca "terimler"
 * listesinde tanımı verilen bir kavramı sarıyorsa kalır, aksi hâlde düz metne
 * dönüşür. Tarih ve isim vurgularına dokunulmaz.
 *
 * Bunu prompt'a bırakmak yetmedi — ölçüldü: modelden gelen 24 farklı kavram
 * vurgusunun 16'sı sözlükte olmayan sıradan kelimelerdi ("israf", "rüşvet",
 * "pozitif bilimler"). 45 maddelik bir notta 25 yeşil vurgu, vurguyu vurgu
 * olmaktan çıkarıyordu. Kural artık kodda: vurgulanan kavramlarla sözlük
 * aynı kümedir.
 */
export function kavramVurgulariniSuz(maddeler: string[], terimler: NotTerimi[]): string[] {
  const sadelestir = (m: string) =>
    m
      .replace(/[çğıöşüÇĞİÖŞÜ]/g, (h) => TR_HARF[h] ?? h)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const sozluk = terimler.map((t) => sadelestir(t.terim)).filter(Boolean);

  return maddeler.map((madde) =>
    madde.replace(/\[k\]([\s\S]*?)\[\/k\]?/g, (tam, icerik: string) => {
      const aday = sadelestir(icerik);
      // Ek almış hâlleri de kabul et: "enflasyonla" -> "Enflasyon"
      const sozlukte = sozluk.some(
        (t) => t.length > 2 && (aday.startsWith(t) || t.startsWith(aday))
      );
      return sozlukte ? tam : icerik;
    })
  );
}

// --- TipTap belge parçaları -------------------------------------------------

const paragraf = (metin: string) => ({
  type: "paragraph",
  content: [{ type: "text", text: metin }],
});

/** Vurgu işaretlerini çözerek paragraf üretir */
const vurgulu = (metin: string) => ({
  type: "paragraph",
  content: satiriDugumlere(metin),
});

const maddeListesi = (ogeler: unknown[]) => ({
  type: "bulletList",
  content: ogeler.map((o) => ({ type: "listItem", content: [o] })),
});

/**
 * Çıkarılan ders notunu not defterinin (TipTap) belge biçimine çevirir.
 *
 * Biçim çalışmak için kurgulandı, okumak için değil: maddeler kısa, ezberlenecek
 * bilgi renkle işaretli, her bölüm başlığının yanında videodaki anına giden
 * bağlantı var. Zaman damgasını ayrı bir satır yerine başlığa koymak sayfadan
 * bölüm sayısı kadar paragraf eksiltiyor — göz maddelerin üstünde kalıyor.
 */
export function notlariNotBelgesine(
  baslik: string,
  notlar: DersNotIcerigi,
  videoId: string
) {
  const icerik: unknown[] = [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: baslik }] },
  ];

  if (notlar.giris) icerik.push(paragraf(notlar.giris));

  for (const bolum of notlar.bolumler) {
    if (!bolum.baslik || !bolum.maddeler.length) continue;
    icerik.push({
      type: "heading",
      attrs: { level: 2 },
      content: [
        { type: "text", text: `${bolum.baslik}  ` },
        {
          type: "text",
          text: formatSure(bolum.saniye),
          marks: [
            {
              type: "link",
              attrs: { href: videoLinki(videoId, bolum.saniye), target: "_blank" },
            },
          ],
        },
      ],
    });
    icerik.push(maddeListesi(bolum.maddeler.map(vurgulu)));
  }

  if (notlar.terimler.length) {
    icerik.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Kilit terimler" }],
    });
    icerik.push(
      maddeListesi(
        notlar.terimler.map((t) => ({
          type: "paragraph",
          content: [
            { type: "text", text: t.terim, marks: [{ type: "bold" }] },
            { type: "text", text: ` — ${t.aciklama}` },
          ],
        }))
      )
    );
  }

  icerik.push({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "Dersin videosu",
        marks: [{ type: "link", attrs: { href: videoLinki(videoId, 0), target: "_blank" } }],
      },
    ],
  });

  return { type: "doc", content: icerik };
}

/**
 * Oturumun skoru. Sonuç, derslerdeki gibi 100 ÜZERİNDEN PUAN olarak veriliyor —
 * yüzde işaretiyle değil, sınav notu gibi. Eksik cevap yarım puan; pas geçilenler
 * yanlış sayılmaz ama puandan düşer, çünkü bölen toplam soru sayısıdır.
 */
export function skorHesapla(answers: DersAnswer[]) {
  const dogru = answers.filter((a) => a.verdict === "dogru").length;
  const eksik = answers.filter((a) => a.verdict === "eksik").length;
  const yanlis = answers.filter((a) => a.verdict === "yanlis").length;
  const pas = answers.filter((a) => a.verdict === "pas").length;
  const toplam = answers.length;
  return {
    dogru,
    eksik,
    yanlis,
    pas,
    toplam,
    puan: toplam ? Math.round(((dogru + eksik * 0.5) / toplam) * 100) : 0,
  };
}
