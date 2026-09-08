import { NextResponse } from "next/server";
import { chatJson } from "@/lib/ai";
import { EN_AZ_SORU, hedefSoruSayisi, type Segment } from "@/lib/ders";
import { gunlukLimitAsildiMi, hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { damgaBelirle, kelimeDizini, transkriptMetni } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 300;

// Üretim iki isteğe bölünmüş durumda. Sebebi ölçüm: soru sayısı derse göre
// arttığı için tek çağrı 46 dakikalık bir derste 149 saniye sürüyordu, 78
// dakikalıkta 250 saniyeye çıkıyor. İki ayrı HTTP isteği demek, her birinin
// kendi süre bütçesi demek — hem sunucu tavanına takılma riski yarıya iniyor
// hem de ablam ilk adım biter bitmez ders özetini görebiliyor.
//
//   adim "acik"   -> oturumu açar, özet + konular + açık uçlu sorular
//   adim "coktan" -> çoktan seçmelileri ekler, oturumu "hazir" yapar

const ORTAK_KURALLAR = `Sana bir ders videosunun transkripti veriliyor. Transkript YouTube'un otomatik
altyazısından geliyor:
- İmla hataları, bozuk özel isimler ve yanlış yazılmış terimler içerebilir.
- Eğitmenin tahtaya yazdıkları metinde görünmez ("burayı şöyle yazalım" gibi ifadeler boş kalır).

Bu yüzden: EMİN OLMADIĞIN bir ayrıntıdan soru sorma. Sadece transkriptte açıkça ve tekrar tekrar
anlatılan, anlamı net olan konulardan soru üret. Sayılar ve özel isimler şüpheliyse o noktadan
soru sorma.

"saniye" alanı, o sorunun cevabının videoda anlatıldığı anı gösterir (transkriptteki [dk:sn]
işaretinden hesapla).

SADECE geçerli JSON döndür, başka hiçbir şey yazma, kod bloğu işareti kullanma.`;

const acikPrompt = (adet: number) =>
  `Sen KPSS'ye hazırlanan bir öğrenciye ders videosundan ölçme soruları hazırlayan bir eğitmensin.

${ORTAK_KURALLAR}

Şema:
{
  "baslik": "dersin kısa başlığı",
  "ozet": "3-4 cümlelik ders özeti",
  "konular": ["ana konu 1", "ana konu 2"],
  "acik_uclu": [
    {"soru": "...", "anahtar": "beklenen cevap, 2-3 cümle",
     "kilit_kavramlar": ["kavram1", "kavram2"], "konu": "hangi ana konu", "saniye": 123}
  ]
}

SORULARIN ZORLUĞU — gerçek KPSS seviyesinde olsun, ama DOLAMBAÇLI olmasın. Zorluk sorunun
derinliğinden gelsin, kaç parçadan oluştuğundan değil:
- TEK KONULU sor. "X ile Y'yi karşılaştırınız", "hem ... hem ...", "üç yönüyle değerlendiriniz"
  gibi birden çok şeyi aynı anda isteyen kalıplar KULLANMA. Öğrenci neyin sorulduğunu okur
  okumaz anlamalı.
- Soru kökü tek cümle ve net olsun; uzun senaryolu kurgu yazma.
- Ezber sorusu da sorma. Yalın tanım istemek yerine anlayıp anlamadığını gösterecek şekilde
  sor: neden böyle olduğu, nasıl işlediği, hangi sonucu doğurduğu.
- Beklenen cevap 2-3 cümle olsun — ne tek kelimelik ne de kompozisyon.
- Cevap derste anlatılanlara dayansın; derste hiç geçmemiş bir bilgiyi çıkarmasını isteme.

SORU SAYISI — en fazla ${adet} açık uçlu soru üret:
- Bu bir ÜST SINIR, doldurulması zorunlu bir kota değil. Ders bu kadar soruyu taşımıyorsa daha
  az üret. Sayıyı tutturmak için zayıf, tekrar eden ya da transkriptte net anlatılmayan konudan
  soru üretme — az ama sağlam soru, çok ama gevşek sorudan iyidir.
- Soruları derste anlatılan farklı ana konulara yay; tek konudan üst üste sorma.
- İki soru aynı bilgiyi ölçmesin.`;

const coktanPrompt = (adet: number, konular: string[], acikSorular: string[]) =>
  `Sen KPSS'ye hazırlanan bir öğrenciye ders videosundan ÇOKTAN SEÇMELİ sorular hazırlayan bir
eğitmensin.

BU BÖLÜMÜN AMACI: gerçek sınav pratiği. Sorular GERÇEK KPSS ZORLUĞUNDA olsun — ne
ezber sorusu kadar kolay, ne de bilmece gibi karmaşık.

- Zorluk ÇELDİRİCİLERDEN gelsin, soru kökünün karmaşıklığından değil. İyi bir çeldirici,
  konuyu yarım bilen birinin seçebileceği şeydir; bariz saçma şık soruyu değersizleştirir.
- Soru TEK ODAKLI olsun: tek bir kavramı, olayı ya da ayrımı sınasın. İki üç şeyi aynı anda
  ölçmeye çalışma.
- Çok adımlı çıkarım zinciri kurma. Şu kalıplardan kaçın: "...ortak amacı nedir",
  "...neyi gösterir", "hangi stratejik düşünceyle", uzun senaryolu neden-sonuç kurguları.
- Soru kökü tek cümle, en fazla iki satır olsun. Uzun paragraflı kök yazma.
- "Aşağıdakilerden hangisi ... değildir/yer almaz" gibi klasik KPSS kalıplarını kullanabilirsin.
- Kavramların birbirine karıştığı noktaları hedefle — sınavda ayırt edilmesi gereken yerler
  oralardır.
- Tek doğru cevap net olsun; iki şık birden savunulabilir olmasın.

${ORTAK_KURALLAR}

Şema:
{
  "coktan_secmeli": [
    {"soru": "...", "secenekler": ["A şıkkı", "B şıkkı", "C şıkkı", "D şıkkı"],
     "dogru": 0, "aciklama": "neden doğru", "konu": "...", "saniye": 123}
  ]
}

"aciklama" alanı öğrenciye DOĞRUDAN GERİ BİLDİRİM olarak gösterilecek. Bu yüzden ansiklopedi
maddesi gibi değil, öğrenciye hitap ederek yaz (sen dili), 1-2 cümle, sıcak ama dürüst bir tonda.
Neden o şıkkın doğru olduğunu açıkla. "...değerlendirilmiştir", "...açıklanmıştır" gibi edilgen
ve kişisiz yapılar kullanma.

SORU SAYISI — en fazla ${adet} çoktan seçmeli soru üret. Bu bir ÜST SINIR; ders taşımıyorsa daha
az üret, sayıyı doldurmak için zayıf soru üretme.

Dersin ana konuları: ${konular.join(", ") || "(belirtilmedi)"}
Soruları bu konulara yay, tek konuda yığılma.

Bu öğrenciye AYNI derste şu açık uçlu sorular zaten soruldu. Aynı bilgiyi tekrar ölçme, farklı
noktalara odaklan:
${acikSorular.map((s, i) => `${i + 1}. ${s}`).join("\n") || "(yok)"}`;

/**
 * İki denetim katmanı, tek ortak mekanizma.
 *
 * Bu sistemin en büyük riski yanlış bir cevap anahtarı: ablama doğrudan yanlış
 * bilgi öğretir ve değerlendirici de o anahtara baktığı için doğru cevabına
 * "yanlış" der — hata çoğalarak ilerler. Üretim modelinin kendi çıktısını
 * denetlemesi zayıf kalacağı için ayrı ve ucuz bir modelle, tek çağrıda, bütün
 * sorular birden denetleniyor.
 *
 *   1. TRANSKRİPT denetimi — bu iddia derste var mı?
 *   2. OLGU denetimi       — bu iddia gerçekte doğru mu?
 *
 * İkinci katman birincinin tanımı gereği göremediği hata sınıfı için: hoca
 * "1453" der, otomatik altyazı "1683" yazar, üretim modeli transkripte sadık
 * kalıp onu tekrarlar. İddia transkriptle TUTARLI olduğu için birinci katman
 * geçirir; ikinci katman transkripte hiç bakmadan yakalar.
 *
 * ELEME SON ÇARE. Bir soruyu atmak ablamı bir soru eksik bırakır; oysa çoğu
 * durumda bozuk olan soru değil, içindeki tek bir değer. O yüzden varsayılan
 * davranış DÜZELTMEK. Eleme yalnızca iki durumda:
 *   - Ders o konuyu hiç anlatmamış (tur: "yok"). Cevabı düzeltmek adaletsiz
 *     soruyu adil yapmaz, ablamın izlemediği konudan sorulmuş olur.
 *   - Çoktan seçmelide düzeltilmiş şık başka bir şıkla çakışıyor; soru artık
 *     iki doğru cevaplı olur, kurtarılamaz.
 */

const DENETIM_ORTAK = `Her sorunun cevabı iki parçadan oluşabilir ve hangi parçada sorun olduğunu
belirtmen gerekir:
- Açık uçlu sorularda tek parça vardır: "anahtar" (beklenen cevap).
- Çoktan seçmeli sorularda iki parça vardır: "sik" (doğru şıkkın metni) ve "aciklama".

Her bulduğun sorun için o parçanın DÜZELTİLMİŞ tam hâlini de yaz: yalnızca hatalı bilgiyi
düzelt, metnin geri kalanını olduğu gibi koru.

ŞÜPHE YETERLİ DEĞİLDİR. Emin değilsen bildirme. Boş liste dönmek tamamen normaldir.

SADECE geçerli JSON döndür, kod bloğu işareti kullanma.`;

const TRANSKRIPT_DENETIMI = `Sen bir ders materyali denetçisisin. Elinde bir dersin transkripti ve
o dersten üretilmiş sorular var. Görevin: cevapta derste HİÇ GEÇMEYEN ya da derste söylenenle
ÇELİŞEN bir iddia olup olmadığını bulmak.

İki tür sorun ayırt et:
- "yok"     : Ders bu konuyu hiç anlatmamış. Bilgi doğru olsa bile derste geçmiyor.
- "celiski" : Ders bu konuyu anlatmış ama BAŞKA türlü söylüyor.

Kurallar:
- Aynı şeyin farklı kelimelerle ifade edilmesi sorun DEĞİLDİR.
- Derste kısaca değinilen bir konunun cevapta biraz ayrıntılandırılması sorun DEĞİLDİR.
- Sorunun zor ya da kötü kurulmuş olması senin işin değil; sadece içeriğe bak.
- "celiski" için düzeltilmiş metin DERSİN SÖYLEDİĞİNE uymalı, kendi bilgine değil.

${DENETIM_ORTAK}

{"sorunlular": [{"no": 1, "tur": "celiski", "nerede": "anahtar", "gerekce": "derste 1453 deniyor", "duzeltilmis": "..."}]}`;

const OLGU_DENETIMI = `Sen bir KPSS ders materyali olgu denetçisisin. Sana soru–cevap çiftleri
veriliyor. Görevin: cevapta GERÇEKTE YANLIŞ olan bir bilgi var mı bulmak.

Bu materyal ders videolarının otomatik altyazısından üretiliyor. Öğretmen doğru söylemiş olsa
bile altyazı tarihleri, sayıları ve özel isimleri bozabiliyor. En sık bozulan yerler bunlardır.

Kurallar:
- Tarihler, kişi adları, yer adları ve sayılar özellikle şüpheli noktalardır.
- Yalnızca gerçekten yanlış olduğundan EMİN olduğun bilgileri bildir.
- Eksik ya da basitleştirilmiş anlatım yanlış DEĞİLDİR; bildirme.
- Yorum farkı yanlış DEĞİLDİR; bildirme.

${DENETIM_ORTAK}

{"hatalar": [{"no": 1, "nerede": "anahtar", "gerekce": "1683 değil 1453", "duzeltilmis": "..."}]}`;

type Nerede = "anahtar" | "sik" | "aciklama";

interface DenetimBulgusu {
  tur: "yok" | "celiski";
  nerede: Nerede;
  gerekce: string;
  duzeltilmis: string;
}

interface DenetimYaniti {
  sorunlular?: Record<string, unknown>[];
  hatalar?: Record<string, unknown>[];
}

/** Denetime gönderilen soru: parçaları ayrı ayrı etiketli */
interface DenetimGirdisi {
  question: string;
  anahtar?: string;
  sik?: string;
  aciklama?: string;
}

async function denetimCalistir(
  sistem: string,
  girdiler: DenetimGirdisi[],
  transkript?: string
): Promise<Map<number, DenetimBulgusu>> {
  if (!girdiler.length) return new Map();

  const liste = girdiler
    .map((g, i) => {
      const parcalar = [`${i + 1}. SORU: ${g.question}`];
      if (g.anahtar) parcalar.push(`   anahtar: ${g.anahtar}`);
      if (g.sik) parcalar.push(`   sik: ${g.sik}`);
      if (g.aciklama) parcalar.push(`   aciklama: ${g.aciklama}`);
      return parcalar.join("\n");
    })
    .join("\n\n");

  let yanit: DenetimYaniti;
  try {
    yanit = await chatJson<DenetimYaniti>({
      mesajlar: [
        { role: "system", content: sistem },
        {
          role: "user",
          content: transkript
            ? `${transkript}\n\n--- DENETLENECEK SORULAR ---\n\n${liste}`
            : liste,
        },
      ],
      maxTokens: 8000,
      rol: "denetim",
    });
  } catch {
    // Denetim bir güvenlik ağı; kendisi düşerse üretimi engellemesin.
    return new Map();
  }

  const gecerliNerede = (v: unknown): Nerede =>
    v === "sik" || v === "aciklama" ? v : "anahtar";

  const bulgular = new Map<number, DenetimBulgusu>();
  for (const h of yanit.sorunlular ?? yanit.hatalar ?? []) {
    const no = h?.no;
    if (typeof no !== "number" || no < 1 || no > girdiler.length) continue;
    bulgular.set(no - 1, {
      tur: h?.tur === "yok" ? "yok" : "celiski",
      nerede: gecerliNerede(h?.nerede),
      gerekce: metin(h?.gerekce) || "gerekçe belirtilmedi",
      duzeltilmis: metin(h?.duzeltilmis),
    });
  }

  // Soruların yarısından fazlası işaretlendiyse hatalı olan büyük ihtimalle
  // denetimin kendisidir; o durumda hiçbirine dokunmuyoruz.
  return bulgular.size > girdiler.length / 2 ? new Map() : bulgular;
}

interface DenetimOzeti {
  duzeltilen: number;
  elenen: number;
  notlar: string[];
}

/** Açık uçlu sorulara denetim uygular: "yok" elenir, geri kalanı düzeltilir. */
function acikUygula<T extends { question: string; answer_key: string | null }>(
  sorular: T[],
  bulgular: Map<number, DenetimBulgusu>,
  ozet: DenetimOzeti
): T[] {
  return sorular.filter((s, i) => {
    const b = bulgular.get(i);
    if (!b) return true;

    if (b.tur === "yok") {
      ozet.elenen++;
      ozet.notlar.push(`elendi (derste yok): ${s.question.slice(0, 60)} — ${b.gerekce}`);
      return false;
    }
    if (!b.duzeltilmis) {
      ozet.elenen++;
      ozet.notlar.push(`elendi (düzeltme gelmedi): ${s.question.slice(0, 60)}`);
      return false;
    }
    s.answer_key = b.duzeltilmis;
    ozet.duzeltilen++;
    ozet.notlar.push(`düzeltildi: ${s.question.slice(0, 60)} — ${b.gerekce}`);
    return true;
  });
}

/**
 * Çoktan seçmeliye denetim uygular. Açıklama düzeltmek her zaman güvenli;
 * doğru şıkkın metnini düzeltmek de güvenli, tek istisna düzeltilmiş metnin
 * başka bir şıkla çakışması — o zaman soru iki doğru cevaplı olur, elenir.
 */
function coktanUygula<
  T extends { question: string; choices: string[] | null; correct_index: number | null; explanation: string | null },
>(sorular: T[], bulgular: Map<number, DenetimBulgusu>, ozet: DenetimOzeti): T[] {
  return sorular.filter((s, i) => {
    const b = bulgular.get(i);
    if (!b) return true;

    if (b.tur === "yok") {
      ozet.elenen++;
      ozet.notlar.push(`elendi (derste yok): ${s.question.slice(0, 60)} — ${b.gerekce}`);
      return false;
    }
    if (!b.duzeltilmis) {
      ozet.elenen++;
      ozet.notlar.push(`elendi (düzeltme gelmedi): ${s.question.slice(0, 60)}`);
      return false;
    }

    if (b.nerede === "sik") {
      const secenekler = s.choices ?? [];
      const dogruIndeks = s.correct_index ?? 0;
      const carpisma = secenekler.some(
        (o, j) => j !== dogruIndeks && o.trim().toLowerCase() === b.duzeltilmis.trim().toLowerCase()
      );
      if (carpisma) {
        ozet.elenen++;
        ozet.notlar.push(`elendi (şık çakışması): ${s.question.slice(0, 60)}`);
        return false;
      }
      s.choices = secenekler.map((o, j) => (j === dogruIndeks ? b.duzeltilmis : o));
    } else {
      s.explanation = b.duzeltilmis;
    }

    ozet.duzeltilen++;
    ozet.notlar.push(`düzeltildi: ${s.question.slice(0, 60)} — ${b.gerekce}`);
    return true;
  });
}

interface UretilenAcik {
  soru?: string;
  anahtar?: string;
  kilit_kavramlar?: string[];
  konu?: string;
  saniye?: number;
}

interface UretilenCoktan {
  soru?: string;
  secenekler?: string[];
  dogru?: number;
  aciklama?: string;
  konu?: string;
  saniye?: number;
}

const metin = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const dizi = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];

// Modelin verdiği "saniye" güvenilmez (bkz. lib/youtube.ts -> damgaBelirle).
// Sorunun kavramlarının transkriptte en yoğun geçtiği anı kendimiz buluyoruz.
type Dizin = Map<string, number[]>;

function acikDogrula(ham: UretilenAcik[], adet: number, sure: number, dizin: Dizin) {
  return (ham ?? [])
    .filter((s) => metin(s.soru) && metin(s.anahtar))
    .slice(0, adet)
    .map((s) => ({
      kind: "acik" as const,
      question: metin(s.soru),
      answer_key: metin(s.anahtar),
      key_points: dizi(s.kilit_kavramlar),
      choices: null,
      correct_index: null,
      explanation: null,
      topic: metin(s.konu) || null,
      start_seconds: damgaBelirle(
        [metin(s.soru), metin(s.anahtar), dizi(s.kilit_kavramlar).join(" ")].join(" "),
        dizin,
        s.saniye,
        sure
      ),
    }));
}

function coktanDogrula(ham: UretilenCoktan[], adet: number, sure: number, dizin: Dizin) {
  return (ham ?? [])
    .filter((s) => {
      const sec = dizi(s.secenekler);
      return (
        metin(s.soru) &&
        sec.length >= 2 &&
        typeof s.dogru === "number" &&
        s.dogru >= 0 &&
        s.dogru < sec.length
      );
    })
    .slice(0, adet)
    .map((s) => ({
      kind: "coktan" as const,
      question: metin(s.soru),
      answer_key: null,
      key_points: [] as string[],
      choices: dizi(s.secenekler),
      correct_index: s.dogru!,
      explanation: metin(s.aciklama) || null,
      topic: metin(s.konu) || null,
      start_seconds: damgaBelirle(
        [metin(s.soru), dizi(s.secenekler).join(" "), metin(s.aciklama)].join(" "),
        dizin,
        s.saniye,
        sure
      ),
    }));
}

/**
 * Denetim sayılarını oturuma yazar. Bu yalnızca şeffaflık içindir — `denetim`
 * kolonu eklenmemişse ders üretimi bundan etkilenmemeli, o yüzden hata yutuluyor.
 * `ekle` true ise mevcut sayıların üstüne ekler (iki adımın toplamı).
 */
async function denetimOzetiYaz(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  sessionId: string,
  ozet: DenetimOzeti,
  ekle: boolean
) {
  try {
    let taban = { duzeltilen: 0, elenen: 0 };
    if (ekle) {
      const { data } = await supabase
        .from("ders_sessions")
        .select("denetim")
        .eq("id", sessionId)
        .maybeSingle();
      const onceki = (data?.denetim ?? {}) as { duzeltilen?: number; elenen?: number };
      taban = { duzeltilen: onceki.duzeltilen ?? 0, elenen: onceki.elenen ?? 0 };
    }
    await supabase
      .from("ders_sessions")
      .update({
        denetim: {
          duzeltilen: taban.duzeltilen + ozet.duzeltilen,
          elenen: taban.elenen + ozet.elenen,
        },
      })
      .eq("id", sessionId);
  } catch {
    // kolon yoksa sessizce geç
  }
}

async function videoGetir(videoId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ders_videos")
    .select("video_id, title, duration_seconds, segments")
    .eq("video_id", videoId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || !Array.isArray(data.segments) || !data.segments.length) return null;
  return data;
}

/**
 * Gövde: { videoId, adim: "acik" } -> { sessionId, ... }
 *        { videoId, adim: "coktan", sessionId } -> { soruSayisi }
 */
export async function POST(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    let govde: Record<string, unknown>;
    try {
      govde = await request.json();
    } catch {
      return NextResponse.json({ hata: "Geçersiz istek gövdesi." }, { status: 400 });
    }
    const videoId = typeof govde.videoId === "string" ? govde.videoId : "";
    const adim = typeof govde.adim === "string" ? govde.adim : "acik";
    const sessionId = typeof govde.sessionId === "string" ? govde.sessionId : undefined;

    if (!videoId) {
      return NextResponse.json({ hata: "videoId gerekli." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const video = await videoGetir(videoId);
    if (!video) {
      return NextResponse.json(
        { hata: "Bu videonun transkripti bulunamadı. Baştan başlar mısın?" },
        { status: 404 }
      );
    }

    const segments = video.segments as Segment[];
    const sure = video.duration_seconds ?? 0;
    const hedef = hedefSoruSayisi(sure);
    const dizin = kelimeDizini(segments);
    // Video başlığı modele dönemi ve özel isimleri veriyor. Otomatik altyazıda
    // özel isimler bozuluyor ("ahlak" -> "Aylak" gibi); başlık bunu azaltıyor.
    const transkript =
      (video.title ? `Video başlığı: ${video.title}\n` : "") +
      `Ders süresi: ${Math.round(sure / 60)} dakika\n\n` +
      `Ders transkripti:\n\n${transkriptMetni(segments)}`;

    // ------------------------------------------------------------ 1. adım
    if (adim === "acik") {
      if (await gunlukLimitAsildiMi()) {
        return NextResponse.json(
          { hata: "Bugünlük ders hazırlama sınırına ulaşıldı. Yarın devam edebilirsin." },
          { status: 429 }
        );
      }

      // Yarım kalmış eski denemeleri temizle
      await supabase
        .from("ders_sessions")
        .delete()
        .eq("video_id", videoId)
        .eq("status", "hazirlaniyor");

      const uretilen = await chatJson<{
        baslik?: string;
        ozet?: string;
        konular?: string[];
        acik_uclu?: UretilenAcik[];
      }>({
        mesajlar: [
          { role: "system", content: acikPrompt(hedef.acik) },
          { role: "user", content: transkript },
        ],
        // Akıl yürüten modellerde düşünme tokenları da bu bütçeden düşüyor.
        // Dar bırakılınca model bütçeyi düşünmeye harcayıp boş cevap dönüyordu
        // (glm-5.3 ve kimi-k3 ölçümü). max_tokens yalnızca tavan — kullanılmayan
        // token ücretlendirilmediği için cömert olmak bedava.
        maxTokens: 32000,
      });

      const ozet: DenetimOzeti = { duzeltilen: 0, elenen: 0, notlar: [] };
      const girdi = (s: { question: string; answer_key: string | null }) => ({
        question: s.question,
        anahtar: s.answer_key ?? "",
      });

      // 1. katman: derste var mı? 2. katman: gerçekte doğru mu?
      // İkisi de önce düzeltmeye çalışır, eleme son çare.
      let acik = acikDogrula(uretilen.acik_uclu ?? [], hedef.acik, sure, dizin);
      acik = acikUygula(
        acik,
        await denetimCalistir(TRANSKRIPT_DENETIMI, acik.map(girdi), transkript),
        ozet
      );
      acik = acikUygula(acik, await denetimCalistir(OLGU_DENETIMI, acik.map(girdi)), ozet);
      if (ozet.notlar.length) console.warn("[ders] denetim (açık uçlu):", ozet.notlar);

      const { data: oturum, error: oturumHatasi } = await supabase
        .from("ders_sessions")
        .insert({
          video_id: videoId,
          title: metin(uretilen.baslik) || video.title || "Ders",
          summary: metin(uretilen.ozet) || null,
          topics: dizi(uretilen.konular),
          status: "hazirlaniyor",
        })
        .select("id")
        .single();

      if (oturumHatasi || !oturum) {
        throw new Error(`Oturum oluşturulamadı: ${oturumHatasi?.message ?? "bilinmiyor"}`);
      }

      // Denetim özeti şeffaflık için; kolon henüz eklenmemişse ders üretimi
      // bundan etkilenmesin diye ayrı ve hatası yutulan bir güncelleme.
      await denetimOzetiYaz(supabase, oturum.id, ozet, false);

      if (acik.length) {
        const { error } = await supabase
          .from("ders_questions")
          .insert(acik.map((s, i) => ({ ...s, session_id: oturum.id, position: i })));
        if (error) throw new Error(`Sorular kaydedilemedi: ${error.message}`);
      }

      return NextResponse.json({
        sessionId: oturum.id,
        acikSayisi: acik.length,
        coktanHedef: hedef.coktan,
      });
    }

    // ------------------------------------------------------------ 2. adım
    if (adim === "coktan") {
      if (!sessionId) {
        return NextResponse.json({ hata: "sessionId gerekli." }, { status: 400 });
      }

      const { data: oturum } = await supabase
        .from("ders_sessions")
        .select("id, topics, status")
        .eq("id", sessionId)
        .maybeSingle();

      if (!oturum) {
        return NextResponse.json({ hata: "Oturum bulunamadı." }, { status: 404 });
      }

      const { data: mevcut } = await supabase
        .from("ders_questions")
        .select("question, kind, position")
        .eq("session_id", sessionId)
        .order("position");

      const acikSorular = (mevcut ?? []).filter((s) => s.kind === "acik").map((s) => s.question);
      const sonrakiPozisyon = (mevcut ?? []).length;

      const uretilen = await chatJson<{ coktan_secmeli?: UretilenCoktan[] }>({
        mesajlar: [
          {
            role: "system",
            content: coktanPrompt(
              hedef.coktan,
              (oturum.topics as string[]) ?? [],
              acikSorular
            ),
          },
          { role: "user", content: transkript },
        ],
        maxTokens: 32000,
      });

      const ozet: DenetimOzeti = { duzeltilen: 0, elenen: 0, notlar: [] };
      // Şık ve açıklama ayrı ayrı gönderiliyor ki denetim hangisini düzelttiğini
      // söyleyebilsin. Çeldiriciler gönderilmiyor — onların yanlış olması zaten
      // beklenen şey, denetime sokmak yanlış alarm üretir.
      const girdi = (s: {
        question: string;
        choices: string[] | null;
        correct_index: number | null;
        explanation: string | null;
      }) => ({
        question: s.question,
        sik: (s.choices ?? [])[s.correct_index ?? 0] ?? "",
        aciklama: s.explanation ?? "",
      });

      let coktan = coktanDogrula(uretilen.coktan_secmeli ?? [], hedef.coktan, sure, dizin);
      coktan = coktanUygula(
        coktan,
        await denetimCalistir(TRANSKRIPT_DENETIMI, coktan.map(girdi), transkript),
        ozet
      );
      coktan = coktanUygula(coktan, await denetimCalistir(OLGU_DENETIMI, coktan.map(girdi)), ozet);
      if (ozet.notlar.length) console.warn("[ders] denetim (çoktan seçmeli):", ozet.notlar);

      if (coktan.length) {
        const { error } = await supabase.from("ders_questions").insert(
          coktan.map((s, i) => ({
            ...s,
            session_id: sessionId,
            position: sonrakiPozisyon + i,
          }))
        );
        if (error) throw new Error(`Sorular kaydedilemedi: ${error.message}`);
      }

      const toplam = sonrakiPozisyon + coktan.length;

      if (toplam < EN_AZ_SORU) {
        await supabase.from("ders_sessions").delete().eq("id", sessionId);
        throw new Error(
          "Bu videodan güvenilir soru üretilemedi. Altyazı çok bozuk olabilir; " +
            "başka bir video deneyebilir misin?"
        );
      }

      await supabase.from("ders_sessions").update({ status: "hazir" }).eq("id", sessionId);
      await denetimOzetiYaz(supabase, sessionId, ozet, true);

      return NextResponse.json({ sessionId, soruSayisi: toplam, coktanSayisi: coktan.length });
    }

    return NextResponse.json({ hata: "Geçersiz adım." }, { status: 400 });
  } catch (err) {
    return hataCevabi(err);
  }
}
