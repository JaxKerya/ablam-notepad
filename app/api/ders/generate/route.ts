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

Sorular ezber değil ANLAMA ölçsün. Öğrenci videoyu izlemiş olmalı ve cevabı kendi cümleleriyle
yazabilmeli.

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

SORU SAYISI — en fazla ${adet} açık uçlu soru üret:
- Bu bir ÜST SINIR, doldurulması zorunlu bir kota değil. Ders bu kadar soruyu taşımıyorsa daha
  az üret. Sayıyı tutturmak için zayıf, tekrar eden ya da transkriptte net anlatılmayan konudan
  soru üretme — az ama sağlam soru, çok ama gevşek sorudan iyidir.
- Soruları derste anlatılan farklı ana konulara yay; tek konudan üst üste sorma.
- İki soru aynı bilgiyi ölçmesin.`;

const coktanPrompt = (adet: number, konular: string[], acikSorular: string[]) =>
  `Sen KPSS'ye hazırlanan bir öğrenciye ders videosundan ÇOKTAN SEÇMELİ sorular hazırlayan bir
eğitmensin. Sorular gerçek KPSS tarzında olsun: çeldiriciler makul, tek doğru cevap net.

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
 * Cevap anahtarı denetimi.
 *
 * Bu sistemin en büyük riski yanlış bir cevap anahtarı: ablama doğrudan yanlış
 * bilgi öğretir ve değerlendirici de o anahtara baktığı için doğru cevabına
 * "yanlış" der — hata çoğalarak ilerler. Üretim modelinin kendi çıktısını
 * denetlemesi zayıf kalacağı için ayrı ve hızlı bir modelle, tek çağrıda,
 * bütün sorular birden denetleniyor.
 *
 * Yalnızca AÇIK çelişkiler ayıklanır; şüphe elemeye yetmez. Boş yere elenen bir
 * soru ablamı bir soru eksik bırakır, yanlış bırakılan bir soru ise ona yanlış
 * bilgi öğretir — ikincisi daha pahalı, ama ilki de bedava değil.
 */
const DENETIM_SISTEM = `Sen bir ders materyali denetçisisin. Elinde bir dersin transkripti ve o
dersten üretilmiş sorular var. Görevin tek şey: bir sorunun cevap anahtarında derste HİÇ
GEÇMEYEN ya da derste söylenenle ÇELİŞEN bir iddia olup olmadığını bulmak.

Kurallar:
- Sadece AÇIK sorunları bildir: derste geçmeyen bir bilgi ya da derste söylenenin tersi.
- Aynı şeyin farklı kelimelerle ifade edilmesi sorun DEĞİLDİR.
- Derste kısaca değinilen bir konunun cevapta biraz ayrıntılandırılması sorun DEĞİLDİR.
- Sorunun zor ya da kötü kurulmuş olması senin işin değil; sadece doğruluğa bak.
- ŞÜPHE YETERLİ DEĞİLDİR. Emin değilsen bildirme. Boş liste dönmek tamamen normaldir.

SADECE geçerli JSON döndür, kod bloğu işareti kullanma:
{"sorunlular": [{"no": 1, "gerekce": "derste bu tarih hiç geçmiyor"}]}`;

interface Denetim {
  sorunlular?: { no?: number; gerekce?: string }[];
}

async function denetle<T extends { question: string }>(
  sorular: T[],
  anahtarMetni: (s: T) => string,
  transkript: string
): Promise<{ kalan: T[]; atilan: { soru: string; gerekce: string }[] }> {
  if (!sorular.length) return { kalan: sorular, atilan: [] };

  const liste = sorular
    .map((s, i) => `${i + 1}. SORU: ${s.question}\n   CEVAP: ${anahtarMetni(s)}`)
    .join("\n\n");

  let sonuc: Denetim;
  try {
    sonuc = await chatJson<Denetim>({
      mesajlar: [
        { role: "system", content: DENETIM_SISTEM },
        { role: "user", content: `${transkript}\n\n--- DENETLENECEK SORULAR ---\n\n${liste}` },
      ],
      maxTokens: 8000,
      rol: "denetim", // ucuz ve hızlı model yeter
    });
  } catch {
    // Denetim bir güvenlik ağı; kendisi düşerse üretimi engellemesin.
    return { kalan: sorular, atilan: [] };
  }

  const sorunlu = new Map<number, string>();
  for (const x of sonuc.sorunlular ?? []) {
    if (typeof x?.no === "number" && x.no >= 1 && x.no <= sorular.length) {
      sorunlu.set(x.no - 1, metin(x.gerekce) || "gerekçe belirtilmedi");
    }
  }

  // Denetim soruların yarısından fazlasını işaretlediyse büyük ihtimalle hatalı
  // olan denetimin kendisidir; o durumda hiçbirini elemiyoruz.
  if (sorunlu.size > sorular.length / 2) return { kalan: sorular, atilan: [] };

  return {
    kalan: sorular.filter((_, i) => !sorunlu.has(i)),
    atilan: [...sorunlu.entries()].map(([i, g]) => ({ soru: sorular[i].question, gerekce: g })),
  };
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
    const govde = await request.json();
    const videoId: string = govde?.videoId ?? "";
    const adim: string = govde?.adim ?? "acik";
    const sessionId: string | undefined = govde?.sessionId;

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

      const { kalan: acik, atilan } = await denetle(
        acikDogrula(uretilen.acik_uclu ?? [], hedef.acik, sure, dizin),
        (s) => s.answer_key ?? "",
        transkript
      );
      if (atilan.length) console.warn("[ders] denetim eledi (açık uçlu):", atilan);

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

      const { kalan: coktan, atilan: atilanCoktan } = await denetle(
        coktanDogrula(uretilen.coktan_secmeli ?? [], hedef.coktan, sure, dizin),
        (s) => `${(s.choices ?? [])[s.correct_index ?? 0] ?? ""} — ${s.explanation ?? ""}`,
        transkript
      );
      if (atilanCoktan.length) console.warn("[ders] denetim eledi (çoktan seçmeli):", atilanCoktan);

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

      return NextResponse.json({ sessionId, soruSayisi: toplam, coktanSayisi: coktan.length });
    }

    return NextResponse.json({ hata: "Geçersiz adım." }, { status: 400 });
  } catch (err) {
    return hataCevabi(err);
  }
}
