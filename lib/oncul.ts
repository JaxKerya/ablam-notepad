// Öncüllü soruların (I, II, III) dengelenmesi.
//
// SORUN (canlı veritabanında ölçüldü): üretilen öncüllü soruların %61-83'ünde
// doğru cevap "I ve II", harf olarak da ~%65'inde C idi. Gerçek ÖSYM sorularında
// (kategori "KPSS", 39 soru) "I ve II" %38, "I, II ve III" %23, teklerin toplamı
// %28. Model doğru öncülleri başa, yanlışı sona yazıyor; ablam öncülleri okumadan
// "I ve II"yi işaretleyip doğru yapmaya başlamıştı.
//
// ÇÖZÜM: öncüllerin İÇERİKLERİ üç etiket arasında rastgele yer değiştiriyor
// (etiketler yukarıdan aşağı I, II, III kalıyor), doğru kombinasyon aynı
// eşlemeden geçiyor, çeldiriciler yeniden çekiliyor, açıklamadaki numaralı
// göndermeler de tek geçişte eşleniyor.
//
// BU ANLAMI DEĞİŞTİRMEZ: doğru şıkkın işaret ettiği öncül METİNLERİ aynı kalır.
// Tek doğru cevap sabitken doğru olmayan her kombinasyon zaten yanlıştır, yani
// çeldiriciyi yedi kombinasyonun geri kalanından çekmek güvenlidir. (Tek karşı örnek
// anahtarı açıklamayla çelişen bozuk soru; geçiş onu ayrıca dışarıda tutuyor.)
//
// ŞIK LİSTESİ DE İPUCU VERİR, doğru cevap dağılımına bağlı olarak. Eşit olasılıkla
// çekiliş ancak doğru öncül sayısı dengeliyse tarafsızdır: hedef dağılımda listeye
// bakarak en iyi tahmin ~%27. Eski soruların %95'i iki doğrulu olduğu için orada
// listede kalan tek ikili %90 tutuyordu (58 soru). Bu yüzden eski soruların üç ikilisi
// de listede kalıyor (ucIkiliKoru ve geçiş); o zaman tahmin 1/3'e iniyor. Yeni soruda
// üç ikiliyi zorlamak ise "üçlü listedeyse işaretle" oranını yükseltir, orada yok.
//
// EMİN OLUNMAYAN SORUYA DOKUNULMUYOR. Yanlış numaralı bir açıklama, dengesiz bir
// sorudan daha kötü: ablam açıklamaya güvenerek yanlış öğrenir. Bu yüzden kalıp
// tanınmıyorsa soru olduğu gibi dönüyor ve sebebi kayda geçiyor.
import { ONCUL_SIKLARI, oncullariSirala, onculluSiklarMi, sikSadelestir } from "@/lib/ders";

/** Gerçek ÖSYM sorularının kategorisi. Bu sorulara ne kod ne geçiş dokunur. */
export const OSYM_KATEGORISI = "KPSS";

/** [0, 1) aralığında sayı veren kaynak. Canlıda Math.random, testte tohumlu. */
export type Rastgele = () => number;

/**
 * Kombinasyonlar bit maskesi: I = 1, II = 2, III = 4. Sıra ONCUL_SIKLARI ile
 * aynı, yani sınav sırası (önce tekler, sonra ikililer, en sonda üçlü).
 */
const KOMBINASYONLAR = [
  { maske: 1, metin: "Yalnız I" },
  { maske: 2, metin: "Yalnız II" },
  { maske: 4, metin: "Yalnız III" },
  { maske: 3, metin: "I ve II" },
  { maske: 5, metin: "I ve III" },
  { maske: 6, metin: "II ve III" },
  { maske: 7, metin: "I, II ve III" },
] as const;

const SADEDEN_MASKEYE = new Map<string, number>(
  ONCUL_SIKLARI.map((sade, i) => [sade, KOMBINASYONLAR[i].maske])
);
const MASKEDEN_METNE = new Map<number, string>(KOMBINASYONLAR.map((k) => [k.maske, k.metin]));

/** "I ve III" -> 5; öncül kombinasyonu değilse null */
export function kombinasyonMaskesi(sik: string): number | null {
  return SADEDEN_MASKEYE.get(sikSadelestir(sik)) ?? null;
}

/** Üç bitlik maskeyi permütasyondan geçirir (perm[eskiKonum] = yeniKonum) */
function maskeyiEsle(maske: number, perm: readonly number[]): number {
  let yeni = 0;
  for (let i = 0; i < 3; i++) if (maske & (1 << i)) yeni |= 1 << perm[i];
  return yeni;
}

/**
 * Tohumlu kaynak (FNV-1a + mulberry32). Geçiş aynı soru kimliğiyle her seferinde
 * aynı sonucu versin, testler tekrar edilebilir olsun diye.
 */
export function tohumluRastgele(tohum: string): Rastgele {
  let h = 0x811c9dc5;
  for (let i = 0; i < tohum.length; i++) {
    h ^= tohum.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates; girdi değişmez */
function karistirilmis<T>(dizi: readonly T[], rastgele: Rastgele): T[] {
  const k = [...dizi];
  for (let i = k.length - 1; i > 0; i--) {
    const j = Math.floor(rastgele() * (i + 1));
    [k[i], k[j]] = [k[j], k[i]];
  }
  return k;
}

// --- Öncül bloğu -------------------------------------------------------------

const ONCUL_SATIRI = /^(\s*)(III|II|I)(\s*[.)]\s*)([\s\S]*)$/;
const ROMA_DEVAMI = /^\s*(?:IV|V|VI|VII)\s*[.)]/;
/**
 * Satır sonu noktalaması içerikle değil KONUMLA gider: "I. A," / "II. B ve" /
 * "III. C" dizilişinde içerik yer değiştirince "ve" ortadaki satırda kalmalı.
 */
const SATIR_SONU = /(\s*(?:[,;:.…]+|\s(?:ve|ile|veya))?\s*)$/;

export interface OnculBlogu {
  /** Üç satırın ilkinin satır numarası (soru metni "\n" ile bölününce) */
  baslangic: number;
  satirlar: string[];
  /** Satır başı: girinti + işaret + boşluk ("I. ", "II) "); dokunulmuyor */
  onekler: [string, string, string];
  /** Sırayla I, II, III'ün içeriği, satır sonu noktalaması hariç */
  icerikler: [string, string, string];
  /** Satır sonu noktalaması, konumda kalıyor */
  sonekler: [string, string, string];
}

/**
 * Soru kökündeki öncül bloğu: SON kesintisiz I, II, III üçlüsü.
 *
 * "Son" olması şart: 39 soruda kök "II. Mahmut'un ...;" ya da "I. Dünya Savaşı
 * ...;" diye başlıyor ve bu satır bir öncül işaretine benziyor. Baştan aranınca
 * asıl üçlü kaçırılabilirdi; sondan aranınca bu satır kök olarak kalıyor.
 */
export function onculBlogunuBul(soru: string): OnculBlogu | null {
  const satirlar = soru.split("\n");
  const eslesme = satirlar.map((s) => ONCUL_SATIRI.exec(s));
  for (let i = satirlar.length - 3; i >= 0; i--) {
    if (eslesme[i]?.[2] !== "I" || eslesme[i + 1]?.[2] !== "II" || eslesme[i + 2]?.[2] !== "III") continue;
    const parcalar = [eslesme[i]!, eslesme[i + 1]!, eslesme[i + 2]!].map((m) => {
      const ham = m[4];
      const son = SATIR_SONU.exec(ham)?.[1] ?? "";
      return { onek: m[1] + m[2] + m[3], icerik: ham.slice(0, ham.length - son.length), son };
    });
    if (parcalar.some((p) => !p.icerik)) return null;
    return {
      baslangic: i,
      satirlar,
      onekler: [parcalar[0].onek, parcalar[1].onek, parcalar[2].onek],
      icerikler: [parcalar[0].icerik, parcalar[1].icerik, parcalar[2].icerik],
      sonekler: [parcalar[0].son, parcalar[1].son, parcalar[2].son],
    };
  }
  return null;
}

// --- Numara sınıflandırma ----------------------------------------------------
//
// Metindeki I, II, III ya bir öncül göndermesidir ("III. yargı yanlıştır") ya da
// bir addır ("III. Selim"). Karşılaştırma listeleri bilerek KAPALI: tanınmayan
// kalıp "belirsiz" sayılıyor ve soru karıştırılmıyor.

type NumaraSinifi = "gonderme" | "isim" | "belirsiz";

interface NumaraYuvasi {
  /** Numaranın metindeki aralığı */
  bas: number;
  son: number;
  deger: 0 | 1 | 2;
  /** Numaranın ardından gelen ek ("'ye" -> "ye"); yoksa null */
  ek: string | null;
  ekBas: number;
  ekSon: number;
}

interface NumaraZinciri {
  yuvalar: NumaraYuvasi[];
  sinif: NumaraSinifi;
}

const ROMA = ["I", "II", "III"] as const;
const NUMARA = /(?<![\p{L}\p{N}'’])(III|II|I)(?![\p{L}\p{N}])/gu;
const ZINCIR_BAGI = /(?:\s*,\s*(?:ve\s+)?|\s+(?:ve|ile|veya|ya da)\s+|\s*[-–/]\s*)(III|II|I)(?![\p{L}\p{N}])/uy;
const EK = /\.?(['’])(\p{L}+)/uy;

/** "III'üncü" gibi sıra sayısı ekleri: numara değil, olduğu gibi kalır */
const SIRA_EKI = /^(?:inci|ıncı|nci|ncı|uncu|üncü|ncu|ncü)/;

/**
 * Numaranın okunuşuna göre ek. Bir -> "I'e", iki -> "II'ye", üç -> "III'e".
 * Numara değişince ekin de uyumu değişiyor; aynı ailede kalıp yenisi yazılıyor.
 */
const EK_AILELERI: { uyanlar: string[]; yazim: [string, string, string] }[] = [
  { uyanlar: ["e", "a", "ye", "ya"], yazim: ["e", "ye", "e"] },
  { uyanlar: ["i", "ı", "u", "ü", "yi", "yı", "yu", "yü"], yazim: ["i", "yi", "ü"] },
  { uyanlar: ["in", "ın", "un", "ün", "nin", "nın", "nun", "nün"], yazim: ["in", "nin", "ün"] },
  { uyanlar: ["de", "da", "te", "ta"], yazim: ["de", "de", "te"] },
  { uyanlar: ["den", "dan", "ten", "tan"], yazim: ["den", "den", "ten"] },
  { uyanlar: ["deki", "daki", "teki", "taki"], yazim: ["deki", "deki", "teki"] },
  { uyanlar: ["dir", "dır", "dur", "dür", "tir", "tır", "tur", "tür"], yazim: ["dir", "dir", "tür"] },
  { uyanlar: ["le", "la", "yle", "yla"], yazim: ["le", "yle", "le"] },
  { uyanlar: ["se", "sa", "yse", "ysa"], yazim: ["se", "yse", "se"] },
];

const ekAilesi = (ek: string) => EK_AILELERI.find((a) => a.uyanlar.includes(ek.toLocaleLowerCase("tr")));

/** Numaradan sonra geldiğinde kesin gönderme olan adlar (ek almış hâlleri dahil) */
const GONDERME_ADI = /^(?:öncül|yargı|ifade|madde|bilgi|cümle|seçenek|şık|önerme|satır|numaralı|nolu|no'lu|no’lu)/;
/** Numaradan sonra gelen yüklem ve bağlaçlar */
const GONDERME_YUKLEMI =
  /^(?:doğr|yanlış|hariç|geçerli|geçersiz|değil|dışında|kronolojik|uymaz|uyar|uygun|olamaz|olmaz|ise$|de$|da$|için$|bu$|o$|gibi$|ile$)/;
/** Sıra sayısı alan adlar: "II. yüzyıl", "I. derece" — öncülle ilgisi yok */
const SIRA_ADI =
  /^(?:yüzyıl|asır|asr|derece|grup|grub|bölge|dönem|sınıf|kısım|kısm|bölüm|ordu|kolordu|mevki|tabaka|kuşak|devre|aşama|evre|etap|kademe|nesil|nesl|hafta|basamak|mertebe|çeyrek|tümen|alay|dalga|sektör|ay$|ayda$|gün$|günde$|yıl$|yılda$|yılı$|kat$|katta$|tip$|tipi$|tür$|türü$|lig$|ligi$|faz$|fazı$)/;
/** Noktadan sonra büyük harfle cümle başlatan sözler: "... I ve III. Çünkü ..." */
const CUMLE_BASI =
  /^(?:bu|bunun|buna|bunlar|bunlardan|bununla|çünkü|zira|ancak|fakat|ama|oysa|ayrıca|diğer|diğerleri|dolayısıyla|öte|sadece|yalnız|yani|şu|o|üstelik|böylece|sonuç|kalan|aynı|doğru|yanlış|hem|her|ikisi|hepsi|öncüller|yargılar)$/;
/** Numaradan hemen önce gelince "bu bir öncül" dedirten söz */
const GUCLU_ONCE = /^(?:yalnız|yalnızca|sadece|öncül|yargı|ifade|madde|önerme|cevap|yanıt|hem)$/;

const kucult = (s: string) => s.toLocaleLowerCase("tr");
const buyukMu = (s: string) => s !== kucult(s);

/**
 * Roma rakamıyla sıra alan adlar: "II. TBMM", "I. Meşrutiyet", "III. Selim".
 * Liste KAPALI: "I. Sipahilerin azalması doğrudur" gibi burada olmayan söz ad
 * sayılmıyor, belirsiz kalıyor ve soru karıştırılmıyor.
 */
const HUKUMDAR_ADI =
  /^(?:Mahmut|Mahmud|Selim|Murat|Murad|Mehmet|Mehmed|Ahmet|Ahmed|Bayezid|Bayezit|Beyazıt|Osman|Mustafa|Süleyman|Mesut|Mesud|Kılıçarslan|Alaeddin|Keykubat|Gıyaseddin|Wilhelm|Napolyon|Katerina|Nikola|Petro|Aleksandr)(?![\p{L}])/u;
const SIRALI_AD =
  /^(?:Abdül\p{L}*|TBMM|BMM|Meşrutiyet|Balkan|Dünya|Cihan|Körfez|Kosova|Viyana|Haçlı|Göktürk|İnönü|Kalkınma|Mebusan|Kılıç)(?![\p{L}])/u;
/** Ek alabilen sıradan adlar: "III. Ordunun", "II. Meclisin", "I. Dönemin" */
const SIRALI_CINS_AD = /^(?:Meclis|Ordu|Kolordu|Dönem|Cumhuriyet|Beylikler)/u;

const romaAdiMi = (kelime: string) =>
  HUKUMDAR_ADI.test(kelime) || SIRALI_AD.test(kelime) || SIRALI_CINS_AD.test(kelime);

/**
 * Öncül içeriği bu sözle başlıyorsa etiketle birleşip başka bir ad gibi okunur:
 * "I. TBMM'nin ..." -> "II. TBMM'nin ...", "II. Meşrutiyet ..." -> "III. Meşrutiyet ...".
 * Yukarıdaki listeden DAR: "Dünya'nın şekli", "Dönemin koşulları", "Meclis-i Âli",
 * "Kalkınma projesi", "Cumhuriyet rejimi" etiketle ad oluşturmuyor, karıştırılabilir.
 */
const ETIKETLE_AD_OLUR =
  /^(?:Abdül\p{L}*|TBMM|BMM|Meşrutiyet|Balkan|Cihan|Körfez|Kosova|Viyana|Haçlı|Göktürk|İnönü|Mebusan|Kılıç|Meclis|Meclisin|Ordu|Ordunun|Kolordu|Dönem)(?![\p{L}-])|^Dünya\s+(?:Savaş|Harb)|^Kalkınma\s+Plan/u;

/** Hükümdar adından sonra başka ad geliyorsa okunmaz: "II. Mustafa Kemal'in ..." */
function etiketleAdOlur(icerik: string): boolean {
  const metin = icerik.trim();
  if (ETIKETLE_AD_OLUR.test(metin)) return true;
  const [ilk, ikinci] = metin.split(/\s+/);
  return HUKUMDAR_ADI.test(ilk) && !(ikinci && buyukMu(ikinci[0]));
}

/** Metin içindeki numaraları zincirleyerek sınıflandırır; tek geçiş, sırayla */
function numaralariTara(metin: string, icerikler: readonly string[] = []): NumaraZinciri[] {
  const sonuc: NumaraZinciri[] = [];
  const desen = new RegExp(NUMARA);
  let m: RegExpExecArray | null;
  while ((m = desen.exec(metin))) {
    const yuvalar: NumaraYuvasi[] = [];
    let bas = m.index;
    let numara = m[1];
    let konum: number;
    let noktaVar: boolean;
    for (;;) {
      const yuva: NumaraYuvasi = {
        bas,
        son: bas + numara.length,
        deger: ROMA.indexOf(numara as (typeof ROMA)[number]) as 0 | 1 | 2,
        ek: null,
        ekBas: 0,
        ekSon: 0,
      };
      yuvalar.push(yuva);
      konum = yuva.son;
      noktaVar = false;
      const ekDeseni = new RegExp(EK);
      ekDeseni.lastIndex = konum;
      const ekM = ekDeseni.exec(metin);
      if (ekM) {
        yuva.ek = ekM[2];
        yuva.ekSon = ekM.index + ekM[0].length;
        yuva.ekBas = yuva.ekSon - ekM[2].length;
        konum = yuva.ekSon;
      } else if (metin[konum] === ".") {
        noktaVar = true;
        konum++;
      }
      const bagDeseni = new RegExp(ZINCIR_BAGI);
      bagDeseni.lastIndex = konum;
      const bag = bagDeseni.exec(metin);
      if (!bag) break;
      numara = bag[1];
      bas = bag.index + bag[0].length - numara.length;
    }
    desen.lastIndex = konum;
    sonuc.push({ yuvalar, sinif: zinciriSiniflandir(metin, m.index, konum, yuvalar, noktaVar, icerikler) });
  }
  return sonuc;
}

function zinciriSiniflandir(
  metin: string,
  bas: number,
  son: number,
  yuvalar: NumaraYuvasi[],
  noktaVar: boolean,
  icerikler: readonly string[]
): NumaraSinifi {
  // "III'üncü" sıra sayısı; bilinmeyen ek ise tahmin edilmiyor
  for (const y of yuvalar) {
    if (y.ek === null) continue;
    if (SIRA_EKI.test(kucult(y.ek))) return "isim";
    if (!ekAilesi(y.ek)) return "belirsiz";
  }

  const onceki = /(\p{L}+)[\s(]*$/u.exec(metin.slice(Math.max(0, bas - 30), bas))?.[1] ?? "";
  const guclu = GUCLU_ONCE.test(kucult(onceki));
  const zincir = yuvalar.length >= 2;
  // Numaradan önce özel ad: "Napolyon III'ün", "Wilhelm II'nin" öncül olmayabilir.
  // Cümle başı sözleri ("Ancak III'ün") büyük harfli olsa da özel ad değil.
  const onceOzelAd = !!onceki && buyukMu(onceki[0]) && !guclu && !CUMLE_BASI.test(kucult(onceki));
  if (yuvalar[yuvalar.length - 1].ek !== null) return onceOzelAd ? "belirsiz" : "gonderme";

  const kalan = metin.slice(son);
  const kelimeM = /^\s*(\p{L}[\p{L}'’]*)/u.exec(kalan);

  if (!kelimeM) {
    const ilk = kalan.trimStart()[0];
    if (ilk !== undefined && !/[.,;:!?)\]»"”’]/.test(ilk)) return "belirsiz";
    // "Selim III." biçimi: numaradan önce özel ad varsa bu bir öncül olmayabilir
    if (!zincir && !guclu && onceki && buyukMu(onceki[0])) return "belirsiz";
    return "gonderme";
  }

  const kelime = kelimeM[1];
  const kucuk = kucult(kelime);
  // Küçük harfle kesin gönderme; büyük harfle ad olabilir ("III. Yargı Paketi", "II. Madde")
  if (GONDERME_ADI.test(kucuk)) return buyukMu(kelime[0]) ? "belirsiz" : "gonderme";

  if (!buyukMu(kelime[0])) {
    if (SIRA_ADI.test(kucuk)) return "isim";
    if (GONDERME_YUKLEMI.test(kucuk)) return "gonderme";
    // Noktasız ve önünde "yalnız/öncül" ya da "I ve II" zinciri varsa: küçük harfli
    // söz bir ada ait olamaz ("I ve II birlikte", "Yalnız II bu döneme aittir")
    if (!noktaVar && (zincir || guclu)) return "gonderme";
    return "belirsiz";
  }

  // Büyük harf: nokta varsa ad ya da yeni cümle; yoksa tahmin edilmiyor
  if (!noktaVar) return "belirsiz";
  if (CUMLE_BASI.test(kucuk)) return "gonderme";
  if (!zincir) {
    // "I. Sipahi sayısının azalması doğrudur": öncül metni aynen tekrarlanmış
    const icerik = icerikler[yuvalar[0].deger];
    if (icerik && ayniBaslangic(kalan, icerik)) return "gonderme";
  }
  // "Yalnız II. Mahmut" hem "yalnızca II. Mahmut" hem "yalnız II." olabilir
  if (guclu) return "belirsiz";
  // Kapalı liste: "III. Fırat yanlıştır", "Doğru olanlar I ve II. Fırat ise ..." ad değil
  return romaAdiMi(kelime) ? "isim" : "belirsiz";
}

/** Metin, öncül içeriğinin ilk iki kelimesiyle mi sürüyor? */
function ayniBaslangic(metin: string, icerik: string): boolean {
  const ilkIki = (s: string) => kucult(s).trim().split(/\s+/).slice(0, 2).join(" ");
  const a = ilkIki(icerik);
  return a.includes(" ") && ilkIki(metin) === a;
}

// Sözle yapılan sıra göndermeleri. "Üçüncü yargı" güvenle eşlenebiliyor; "ilk
// öncül", "son ikisi", "ikincisi" ve "ikinci madde" (Anayasa maddesi de olabilir)
// eşlenemiyor, bunlar sorunun karıştırılmasını engelliyor.
const SOZLE_GONDERME = /(?<![\p{L}])(birinci|Birinci|ikinci|İkinci|üçüncü|Üçüncü)(?=\s+(?:öncül|yargı|ifade|önerme))/gu;
const SOZLE_BELIRSIZ =
  /(?<![\p{L}])(?:(?:[İi]lk|[Ss]on|[Ss]onuncu)\s+(?:iki\s+)?(?:öncül|yargı|ifade|önerme)|(?:[İi]lk|[Ss]on)\s+iki(?:si|sini|sinin|sinde)(?![\p{L}])|[Bb]irincisi|[İi]kincisi|[Üü]çüncüsü|[İi]lki(?![\p{L}])|[Ss]onuncusu|(?:birinci|Birinci|ikinci|İkinci|üçüncü|Üçüncü)\s+(?:madde|bilgi|cümle|seçenek|şık))/u;
/**
 * Açıklamada sıra sözü + herhangi bir ad: "Birinci uygulama ...", "üçüncü gerekçe",
 * "İlk iki hüküm". Ölçümde üç soruda çıktı; adı öncül olmasa da öncülü gösteriyor.
 * Serbest bırakılanlar öncülle ilgisiz kalıplar ("ikinci dönem", "birinci elden").
 * Yalnız açıklamada aranıyor: kök ve öncülde bu sözler genelde konunun kendisi.
 */
const SIRA_SOZU_VE_AD = /(?<![\p{L}])(?:birinci|Birinci|ikinci|İkinci|üçüncü|Üçüncü|(?:[İi]lk|[Ss]on)\s+iki)\s+(\p{Ll}+)/gu;
const SERBEST_SIRA_ADI = /^(?:el|elden|eli|kez|defa|savaş|yarı|öncül|yargı|ifade|önerme)/;
const siraSozuBelirsizMi = (metin: string) =>
  [...metin.matchAll(SIRA_SOZU_VE_AD)].some((m) => {
    const ad = kucult(m[1]);
    return !SERBEST_SIRA_ADI.test(ad) && !SIRA_ADI.test(ad);
  });
/** Şıklar yeniden yazıldığı için harfe gönderme ("C şıkkı", "B)", "Cevap D") geçersiz kalır */
const HARF_GONDERMESI =
  /(?<![\p{L}])(?:[A-E](?:\)|['’]?\s*(?:şıkk|şık(?![\p{L}])|seçene)|['’](?:d[ıi]r|t[ıi]r)(?![\p{L}]))|(?:[Cc]evap|[Yy]anıt)\s+[A-E](?![\p{L}\p{N}]))/u;
/**
 * Yalnız açıklamada aranan konum sözleri: "Son hüküm", "İlk madde", "Sonuncu",
 * "Ortadaki yargı", "İlkinde", "1. öncül". Numara taşımadıkları için karıştırma
 * sonrası sessizce başka öncülü gösterirlerdi. "ilk" tek başına serbest: veride hep
 * içerikle ilgili ("ilk devlet"), ad listesi de bu yüzden kapalı.
 */
const ACIKLAMA_KONUM_SOZU =
  /(?<![\p{L}\p{N}])(?:(?:[İi]lk|[Ss]on)\s+(?:iki\s+|üç\s+)?(?:madde|seçenek|şık|cümle|bilgi|hüküm|uygulama|gerekçe|özellik|gelişme|etken|neden)(?![\p{L}])|(?:[Ss]onuncu|[Ss]ondaki|[Bb]aştaki|[Oo]rtadaki|[Üü]stteki|[Aa]lttaki|[İi]lkinde|[İi]kincide|[Üü]çüncüde)(?![\p{L}])|[123]\.?\s*(?:ve\s*[123]\.?\s*)?(?:öncül|yargı|ifade|önerme))/u;

const SOZ_SAYILAR = ["birinci", "ikinci", "üçüncü"] as const;
const buyukBasla = (s: string) => s[0].toLocaleUpperCase("tr") + s.slice(1);

export interface AciklamaEslemesi {
  metin: string;
  /** Sınıflandırılamayan numara kaldıysa true; metin o zaman değiştirilmemiştir */
  belirsiz: boolean;
  degisti: boolean;
  /** Bulunan öncül göndermesi sayısı (zincir başına bir) */
  gonderme: number;
}

/**
 * Açıklamadaki öncül göndermelerini permütasyondan geçirir (perm[eski] = yeni).
 *
 * TEK GEÇİŞ: bütün değişiklikler ilk metin üzerinde hesaplanıp birleştiriliyor.
 * Art arda replace zinciri "I -> II", ardından "II -> III" diye çift eşlerdi.
 * Zincirler artan sırada kalıyor ("III ve I" yerine "I ve III"), ek numaraya
 * uyduruluyor ("III'e" -> "II'ye"). Numara dışında hiçbir metin yeniden yazılmıyor.
 */
export function aciklamaNumaralariniEsle(
  aciklama: string,
  perm: readonly number[],
  icerikler: readonly string[] = []
): AciklamaEslemesi {
  const degismedi = (belirsiz: boolean, gonderme = 0): AciklamaEslemesi => ({
    metin: aciklama,
    belirsiz,
    degisti: false,
    gonderme,
  });
  if (
    SOZLE_BELIRSIZ.test(aciklama) ||
    ACIKLAMA_KONUM_SOZU.test(aciklama) ||
    siraSozuBelirsizMi(aciklama) ||
    HARF_GONDERMESI.test(aciklama)
  ) {
    return degismedi(true);
  }

  const zincirler = numaralariTara(aciklama, icerikler);
  if (zincirler.some((z) => z.sinif === "belirsiz")) return degismedi(true);
  const gondermeler = zincirler.filter((z) => z.sinif === "gonderme");
  // "I ve II sırasıyla A ve B'dir": sıralanınca karşılıklar yer değiştirir
  if (/sırasıyla/i.test(aciklama) && gondermeler.some((z) => z.yuvalar.length > 1)) return degismedi(true);

  const degisiklikler: { bas: number; son: number; metin: string }[] = [];
  for (const z of gondermeler) {
    const yeniler = z.yuvalar.map((y) => perm[y.deger]).sort((a, b) => a - b);
    z.yuvalar.forEach((y, i) => {
      const yeni = yeniler[i];
      if (yeni === y.deger) return;
      degisiklikler.push({ bas: y.bas, son: y.son, metin: ROMA[yeni] });
      if (y.ek !== null) {
        const aile = ekAilesi(y.ek);
        if (aile) degisiklikler.push({ bas: y.ekBas, son: y.ekSon, metin: aile.yazim[yeni] });
      }
    });
  }
  let sozGonderme = 0;
  for (const m of aciklama.matchAll(SOZLE_GONDERME)) {
    sozGonderme++;
    const eski = SOZ_SAYILAR.indexOf(kucult(m[1]) as (typeof SOZ_SAYILAR)[number]);
    const yeni = SOZ_SAYILAR[perm[eski]];
    if (perm[eski] === eski) continue;
    const metin = buyukMu(m[1][0]) ? buyukBasla(yeni) : yeni;
    degisiklikler.push({ bas: m.index, son: m.index + m[1].length, metin });
  }

  degisiklikler.sort((a, b) => a.bas - b.bas);
  let sonuc = "";
  let imlec = 0;
  for (const d of degisiklikler) {
    sonuc += aciklama.slice(imlec, d.bas) + d.metin;
    imlec = d.son;
  }
  sonuc += aciklama.slice(imlec);
  return { metin: sonuc, belirsiz: false, degisti: sonuc !== aciklama, gonderme: gondermeler.length + sozGonderme };
}

/** Metinde öncüle numarayla gönderme ya da tanınmayan numara var mı? */
function gondermeVarMi(metin: string): boolean {
  if (SOZLE_BELIRSIZ.test(metin)) return true;
  if (new RegExp(SOZLE_GONDERME).test(metin)) return true;
  return numaralariTara(metin).some((z) => z.sinif !== "isim");
}

// --- Dengeleme ---------------------------------------------------------------

export type OnculAtlamaSebebi =
  | "oncullu-degil" // şıklar öncül kombinasyonu değil (numaralı cümle şıkları dahil)
  | "gecersiz-sik" // beş ayrı kombinasyon ya da geçerli doğru indeks yok
  | "uclu-blok-yok" // satır satır I, II, III yok (satır içi öncül vb.)
  | "dort-oncul"
  | "kokte-gonderme" // kök metni öncüllere numarayla gönderme yapıyor
  | "onculde-gonderme" // bir öncül başka bir öncüle numarayla gönderme yapıyor
  | "oncul-bagimli" // "Bunun sonucunda ...", "Her ikisi ..." gibi başka öncüle yaslanıyor
  | "oncul-ad-bitisik" // "TBMM'nin ...": yeni etiketle "II. TBMM" gibi başka bir ad okunur
  | "aciklama-belirsiz"
  | "zorunlu-sik-fazla"; // geçişte daha önce seçilmiş şıklar beş yuvaya sığmıyor

export interface OnculSoru {
  soru: string;
  secenekler: string[];
  dogruIndeks: number;
  aciklama: string | null;
}

export interface OnculSonuc extends OnculSoru {
  durum: "karistirildi" | "atlandi";
  sebep: OnculAtlamaSebebi | null;
  aciklamaBelirsiz: boolean;
  aciklamaDegisti: boolean;
  /** perm[eskiEtiket] = yeniEtiket (0 = I); atlandıysa null */
  permutasyon: number[] | null;
  /** Eski şık indeksi -> yeni şık indeksi; karşılığı listede yoksa null */
  eskidenYeniye: (number | null)[];
}

export interface OnculSecenekleri {
  rastgele?: Rastgele;
  /**
   * Yeni listede mutlaka bulunacak şıklar, ESKİ etiketlerle yazılmış ("I ve III").
   * Geçiş için: daha önce işaretlenmiş şık yeni listede de var olmalı ki cevap
   * yeni indeksine taşınabilsin.
   */
  zorunluSiklar?: string[];
  /**
   * Girdi listesinde üç ikili de varsa yeni listede de kalsın. Kopya yolları için:
   * geçişle dengelenen eski sorularda "tek ikili" ipucu kopyada geri gelmesin.
   * Yeni üretimde kapalı: orada model listeyi seçmiş olur, çekiliş eşit kalmalı.
   */
  ucIkiliKoru?: boolean;
  /** perm[eskiEtiket] = yeniEtiket. Geçiş dengeli atama için verir; yoksa rastgele. */
  permutasyon?: readonly number[];
}

const IKILI_MASKELER = [3, 5, 6] as const;

/** Önceki öncüle yaslanan başlangıçlar. "Bu tarihten sonra" köke yaslanır, serbest. */
const BAGIMLI_BASLANGIC = /^(?:Bunun|Buna|Bunlar|Bununla|Ayrıca|Böylece|Dolayısıyla|Öte yandan)(?![\p{L}])/u;
/**
 * "Her ikisi Orta Asya'da ...": kök iki şeyi adıyla saymıyorsa gönderme diğer iki
 * öncüledir, öncül onların önüne geçince okunmaz. Kök sayıyorsa ("A ve B ...") köke
 * yaslanır, serbest.
 */
const IKISINE_GONDERME = /^(?:Her\s+iki(?:si\p{L}*)?|İkisi\p{L}*)(?![\p{L}])/u;
const KOK_IKI_SEY_SAYIYOR = /\s(?:ve|ile)\s/u;

/**
 * Öncüllü soruyu dengeler: içerikler rastgele yer değiştirir, doğru kombinasyon
 * aynı eşlemeden geçer, dört çeldirici geri kalan altı kombinasyondan eşit
 * olasılıkla çekilir (zorunlu şıklar ve ucIkiliKoru hariç), açıklamadaki numaralar
 * eşlenir. Şıklar sınav sırasında.
 *
 * Öncüllü olmayan ya da emin olunamayan soru girdiyle aynı döner; çağıranın ayrıca
 * süzmesi gerekmiyor, her soruyu buradan geçirebilir.
 */
export function onculDengele(girdi: OnculSoru, secenek: OnculSecenekleri = {}): OnculSonuc {
  const rastgele = secenek.rastgele ?? Math.random;
  const atla = (sebep: OnculAtlamaSebebi, aciklamaBelirsiz = false): OnculSonuc => ({
    ...girdi,
    durum: "atlandi",
    sebep,
    aciklamaBelirsiz,
    aciklamaDegisti: false,
    permutasyon: null,
    eskidenYeniye: girdi.secenekler.map((_, i) => i),
  });

  const { soru, secenekler, dogruIndeks, aciklama } = girdi;
  if (!onculluSiklarMi(secenekler)) return atla("oncullu-degil");
  const eskiMaskeler = secenekler.map((s) => kombinasyonMaskesi(s) as number);
  if (
    secenekler.length !== 5 ||
    new Set(eskiMaskeler).size !== 5 ||
    !Number.isInteger(dogruIndeks) ||
    dogruIndeks < 0 ||
    dogruIndeks >= 5
  ) {
    return atla("gecersiz-sik");
  }

  const blok = onculBlogunuBul(soru);
  if (!blok) return atla("uclu-blok-yok");
  if (ROMA_DEVAMI.test(blok.satirlar[blok.baslangic + 3] ?? "")) return atla("dort-oncul");

  const disarisi = [...blok.satirlar.slice(0, blok.baslangic), ...blok.satirlar.slice(blok.baslangic + 3)].join("\n");
  if (gondermeVarMi(disarisi)) return atla("kokte-gonderme");
  if (blok.icerikler.some(gondermeVarMi)) return atla("onculde-gonderme");
  if (blok.icerikler.some((c, i) => i > 0 && BAGIMLI_BASLANGIC.test(c))) return atla("oncul-bagimli");
  if (blok.icerikler.some((c) => IKISINE_GONDERME.test(c)) && !KOK_IKI_SEY_SAYIYOR.test(disarisi)) {
    return atla("oncul-bagimli");
  }
  if (blok.icerikler.some(etiketleAdOlur)) return atla("oncul-ad-bitisik");

  const perm = secenek.permutasyon ? [...secenek.permutasyon] : karistirilmis([0, 1, 2], rastgele);

  // Açıklama eşlenemiyorsa soru karıştırılmıyor; belirsizlik permütasyona bağlı
  // değil, bu yüzden sonuç çekilen sıraya göre değişmiyor.
  let yeniAciklama = aciklama;
  let aciklamaDegisti = false;
  if (aciklama) {
    const e = aciklamaNumaralariniEsle(aciklama, perm, blok.icerikler);
    if (e.belirsiz) return atla("aciklama-belirsiz", true);
    yeniAciklama = e.metin;
    aciklamaDegisti = e.degisti;
  }

  // İçerik eski etiketten yeni etikete gidiyor; önek ve satır sonu yerinde kalıyor
  const yeniSatirlar = [...blok.satirlar];
  for (let eski = 0; eski < 3; eski++) {
    const yeni = perm[eski];
    yeniSatirlar[blok.baslangic + yeni] = blok.onekler[yeni] + blok.icerikler[eski] + blok.sonekler[yeni];
  }

  const yeniDogru = maskeyiEsle(eskiMaskeler[dogruIndeks], perm);
  const zorunlu = new Set<number>();
  for (const s of secenek.zorunluSiklar ?? []) {
    const m = kombinasyonMaskesi(s);
    if (m !== null) zorunlu.add(maskeyiEsle(m, perm));
  }
  // İkililer permütasyonda yine ikiliye gider, eşlemeye gerek yok
  if (secenek.ucIkiliKoru && IKILI_MASKELER.every((m) => eskiMaskeler.includes(m))) {
    for (const m of IKILI_MASKELER) zorunlu.add(m);
  }
  zorunlu.delete(yeniDogru);
  if (zorunlu.size > 4) return atla("zorunlu-sik-fazla");

  const havuz = KOMBINASYONLAR.map((k) => k.maske as number).filter((m) => m !== yeniDogru && !zorunlu.has(m));
  const celdiriciler = [...zorunlu, ...karistirilmis(havuz, rastgele).slice(0, 4 - zorunlu.size)];
  const metinler = [yeniDogru, ...celdiriciler].map((m) => MASKEDEN_METNE.get(m) as string);
  const sirali = oncullariSirala(metinler, 0);

  return {
    soru: yeniSatirlar.join("\n"),
    secenekler: sirali.secenekler,
    dogruIndeks: sirali.dogruIndeks,
    aciklama: yeniAciklama,
    durum: "karistirildi",
    sebep: null,
    aciklamaBelirsiz: false,
    aciklamaDegisti,
    permutasyon: perm,
    eskidenYeniye: eskiMaskeler.map((m) => {
      const i = sirali.secenekler.indexOf(MASKEDEN_METNE.get(maskeyiEsle(m, perm)) as string);
      return i >= 0 ? i : null;
    }),
  };
}

// --- Ölçüm -------------------------------------------------------------------

export interface OnculDagilimi {
  toplam: number;
  /** Doğru kombinasyon metni -> soru sayısı */
  kombinasyon: Record<string, number>;
  /** Doğru harf -> soru sayısı */
  harf: Record<string, number>;
  /** Doğru öncül sayısı (1, 2, 3) -> soru sayısı */
  dogruOnculSayisi: Record<string, number>;
}

/** Doğru cevapların dağılımı. Öncüllü olmayan sorular sayılmaz. */
export function onculDagilimi(sorular: { secenekler: string[]; dogruIndeks: number }[]): OnculDagilimi {
  const d: OnculDagilimi = { toplam: 0, kombinasyon: {}, harf: {}, dogruOnculSayisi: {} };
  for (const s of sorular) {
    const maske = kombinasyonMaskesi(s.secenekler[s.dogruIndeks] ?? "");
    if (maske === null) continue;
    d.toplam++;
    const metin = MASKEDEN_METNE.get(maske) as string;
    d.kombinasyon[metin] = (d.kombinasyon[metin] ?? 0) + 1;
    const harf = "ABCDE"[s.dogruIndeks] ?? "?";
    d.harf[harf] = (d.harf[harf] ?? 0) + 1;
    const sayi = String((maske & 1) + ((maske >> 1) & 1) + ((maske >> 2) & 1));
    d.dogruOnculSayisi[sayi] = (d.dogruOnculSayisi[sayi] ?? 0) + 1;
  }
  return d;
}
