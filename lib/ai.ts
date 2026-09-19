// Ablam Ders — OpenAI uyumlu sağlayıcı istemcisi.
//
// Sağlayıcı değiştirmek istersen değişecek tek dosya burası; geri kalan kod
// sağlayıcıdan habersiz. (Proje yapayzekalab.org ile başlayıp OpenRouter'a
// taşındı ve tek satır kod değişmedi.)
//
// Sağlayıcıdan bağımsız savunmalar:
//   • json_schema (structured outputs) her sağlayıcıda güvenilir değil — bir
//     sağlayıcıda şema tamamen yok sayılıyordu. Bu yüzden json_object + kendi
//     doğrulamamız kullanılıyor.
//   • Bazı modeller çıktıyı ```json bloğuna sarıyor  -> parseJsonLoose temizliyor.
//   • Sağlayıcılar ara sıra 429/503 dönüyor          -> artan gecikmeyle 3 deneme.
//
// Ölçümler (OpenRouter, 52 dakikalık gerçek KPSS dersi, aynı prompt):
//   openai/gpt-5.6-sol-pro   üretim 72 sn / $0.165   değerlendirme 9.0 sn / 5-5 isabet
//   google/gemini-3.7-flash  (eski sağlayıcıda) üretim 12 sn      değerlendirme 2.7 sn / 5-5
// sol-pro "pro reasoning" sürümü: aynı istem üzerinde birden fazla dahili geçiş
// yaptığı için 18 bin tokenlık transkript 62 bin token olarak faturalanıyor.

const BASE_URL = process.env.AI_BASE_URL;
const API_KEY = process.env.AI_API_KEY;

/** Uzun transkriptten soru üretimi */
const URETIM_MODELI = process.env.AI_MODEL ?? "openai/gpt-5.6-sol";

/**
 * Cevap değerlendirme — küçük ama en sık tekrarlanan iş, hız burada daha çok önemli.
 * Üretimden ayrı tutuldu ki ileride biri değişirken diğeri sabit kalabilsin.
 */
const DEGERLENDIRME_MODELI = process.env.AI_GRADE_MODEL ?? "openai/gpt-5.6-sol";

/**
 * Cevap anahtarı denetimi — bkz. generate route'taki `denetle`. Ölçüm: kasten
 * bozulmuş bir anahtarı luna 2/2 yakaladı, yanlış alarm vermedi ve çağrı başına
 * $0.0007-0.0031'e mal oldu (aynı işi sol $0.0276'ya yapıyor).
 */
const DENETIM_MODELI = process.env.AI_AUDIT_MODEL ?? "openai/gpt-5.6-luna";

/**
 * Öz-denetim (soru geliştirme) modeli. BOŞSA ADIM HİÇ ÇALIŞMAZ — bu bir
 * deney: üretim modeli kendi sorularını transkriptle birlikte ikinci kez
 * okuyup zayıf çeldiricileri güçlendiriyor. Genelde üretim modelinin kendisi
 * verilir ("self-reflection"); farklı bir model de verilebilir.
 */
const GELISTIRME_MODELI = process.env.AI_REFINE_MODEL?.trim() ?? "";

/**
 * Ablam Kariyer profil çıkarma. Nadir çağrı (profil bir kez kurulur, ara sıra
 * yenilenir) ama sonucu her ilanın puanlamasına giriyor — burada pahalı model
 * ödenebilir. Boşsa üretim modeli.
 */
const PROFIL_MODELI = process.env.AI_PROFIL_MODEL?.trim() ?? "";

/**
 * Düşünme derinliği (low | medium | high | xhigh). Yalnızca ÜRETİM ve ÖZ-DENETİM
 * rollerine gidiyor; denetim (Luna) ve diğerleri sağlayıcı varsayılanında.
 * Boşsa parametre hiç gönderilmez. OpenRouter bunu `reasoning.effort` olarak
 * modele geçiriyor (Anthropic'te output_config.effort, OpenAI'da reasoning_effort).
 * Ölçüm: Sonnet 5'te 13 dk dersin 2. adımı 7.588 çıktı token'ı — ders
 * maliyetinin %56'sı düşünmeye gidiyor; `medium` bunun ilk düğmesi.
 */
const EFFORT = process.env.AI_EFFORT?.trim() ?? "";
export const gelistirmeAcikMi = () => GELISTIRME_MODELI.length > 0;

/**
 * İçerik parçası. Düz metin yerine parça listesi göndermenin tek sebebi
 * `cache_control`: Anthropic modellerinde bir parçayı önbellek sınırı olarak
 * işaretler (OpenRouter bunu olduğu gibi Anthropic'e geçirir; OpenAI
 * modellerinde yok sayılır, onların önbelleği otomatik). Önbellek ÖN-EK
 * eşleşmesiyle çalışır: işaretli parça ve öncesi iki istekte bayt bayt aynıysa
 * ikinci istekte o kısım okuma fiyatından gelir. Bu yüzden generate route
 * transkripti prompt'un ÖNÜNE koyuyor — prompt adımdan adıma değişiyor,
 * transkript değişmiyor.
 */
export interface ChatParca {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface ChatMesaj {
  role: "system" | "user" | "assistant";
  content: string | ChatParca[];
}

export class AiHatasi extends Error {}

/**
 * Bir çağrının ölçümü. /ders/aiview sayfası bunu gösteriyor: denetimin ne
 * yaptığını görmek maliyeti ve süreyi de görmeden yarım kalıyordu. Sağlayıcıdan
 * bağımsız: OpenAI uyumlu her uç `usage` döndürüyor, dönmeyende sıfır kalır.
 */
export interface AiOlcum {
  girdiToken: number;
  ciktiToken: number;
  /** Girdinin önbellekten okunan kısmı (girdiToken'a dahil). Sağlayıcı bildirmezse 0. */
  onbellekToken: number;
  /**
   * Sağlayıcının bildirdiği gerçek ücret (USD). OpenRouter `usage.include`
   * ile döndürüyor; fiyat tablosunu koda gömmekten güvenilir — model
   * değişince eskimiyor. Bildirilmezse undefined.
   */
  maliyetUsd?: number;
  sn: number;
  /** İsteği hangi modelin karşıladığı. Model env'den geldiği için kayıtta
   *  durmazsa eski kayıtlar hangi modele ait olduğunu söyleyemez — bu projede
   *  model karşılaştırması yöntemin kendisi olduğu için önemli. */
  model: string;
}

const olcumTopla = (a: AiOlcum, b: AiOlcum): AiOlcum => ({
  girdiToken: a.girdiToken + b.girdiToken,
  ciktiToken: a.ciktiToken + b.ciktiToken,
  onbellekToken: a.onbellekToken + b.onbellekToken,
  maliyetUsd:
    a.maliyetUsd === undefined && b.maliyetUsd === undefined
      ? undefined
      : (a.maliyetUsd ?? 0) + (b.maliyetUsd ?? 0),
  sn: a.sn + b.sn,
  model: b.model || a.model,
});

/** Rol -> model. Hem istek gövdesi hem ölçüm aynı yerden okusun diye ayrıldı. */
function rolModeli(rol: ChatSecenekleri["rol"]): string {
  return rol === "degerlendirme"
    ? DEGERLENDIRME_MODELI
    : rol === "denetim"
      ? DENETIM_MODELI
      : rol === "gelistirme"
        ? GELISTIRME_MODELI || URETIM_MODELI
        : rol === "profil"
          ? PROFIL_MODELI || URETIM_MODELI
          : URETIM_MODELI;
}

/** Yeniden denemeye değer geçici hata */
class GeciciHata extends AiHatasi {}

/**
 * Model çıktısını JSON'a çevirir. Düz JSON gelmeyebilir:
 * ```json bloğu, önünde/arkasında açıklama metni vs. hepsini toparlar.
 */
export function parseJsonLoose<T = unknown>(text: string): T {
  let t = text.trim();

  if (t.startsWith("```")) {
    const ilkSatirSonu = t.indexOf("\n");
    if (ilkSatirSonu !== -1) t = t.slice(ilkSatirSonu + 1);
    if (t.trimEnd().endsWith("```")) t = t.trimEnd().slice(0, -3);
    t = t.trim();
  }

  try {
    return JSON.parse(t) as T;
  } catch {
    // Metnin içine gömülü ilk/son süslü parantez arasını dene
    const bas = t.indexOf("{");
    const son = t.lastIndexOf("}");
    if (bas !== -1 && son > bas) {
      // Burası da bozuksa AiHatasi fırlat: chatJsonOlculu yalnızca AiHatasi'nde
      // "düz JSON gönder" diye ikinci deneme yapıyor; çıplak SyntaxError kaçıp
      // yeniden denemeyi atlatıyordu (denetim bulgusu).
      try {
        return JSON.parse(t.slice(bas, son + 1)) as T;
      } catch (e) {
        throw new AiHatasi(`Model çıktısı JSON değil: ${(e as Error).message}`);
      }
    }
    throw new AiHatasi("Model geçerli JSON döndürmedi.");
  }
}

interface ChatSecenekleri {
  mesajlar: ChatMesaj[];
  maxTokens?: number;
  timeoutMs?: number;
  /** Hangi işin modeli kullanılsın — her rolün kendi env değişkeni var */
  rol?: "uretim" | "degerlendirme" | "denetim" | "gelistirme" | "profil";
}

async function chatOnce({
  mesajlar,
  maxTokens = 8000,
  timeoutMs = 240_000,
  rol = "uretim",
}: ChatSecenekleri): Promise<{ icerik: string; olcum: AiOlcum }> {
  if (!BASE_URL || !API_KEY) {
    throw new AiHatasi("AI_BASE_URL ve AI_API_KEY ortam değişkenleri tanımlı değil.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const baslangic = Date.now();
  const model = rolModeli(rol);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        messages: mesajlar,
        ...(EFFORT && (rol === "uretim" || rol === "gelistirme")
          ? { reasoning: { effort: EFFORT } }
          : {}),
        // Cevaba gerçek ücreti ve önbellek sayımını ekletir (OpenRouter'a
        // özgü; başka sağlayıcı bilmiyorsa yok sayar, alanlar 0 kalır).
        usage: { include: true },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const govde = await res.text().catch(() => "");
      const mesaj = `Sağlayıcı ${res.status} döndü. ${govde.slice(0, 200)}`;
      // 429 ve 5xx geçici — yeniden denemeye değer
      if (res.status === 429 || res.status >= 500) throw new GeciciHata(mesaj);
      throw new AiHatasi(mesaj);
    }

    const data = await res.json();
    const icerik: string | undefined = data?.choices?.[0]?.message?.content;
    if (!icerik) throw new GeciciHata("Sağlayıcı boş cevap döndürdü.");
    const kullanim = data?.usage ?? {};
    const maliyet = Number(kullanim.cost);
    return {
      icerik,
      olcum: {
        girdiToken: Number(kullanim.prompt_tokens) || 0,
        ciktiToken: Number(kullanim.completion_tokens) || 0,
        onbellekToken: Number(kullanim.prompt_tokens_details?.cached_tokens) || 0,
        maliyetUsd: Number.isFinite(maliyet) ? maliyet : undefined,
        sn: (Date.now() - baslangic) / 1000,
        model,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GeciciHata("Sağlayıcı zaman aşımına uğradı.");
    }
    if (err instanceof AiHatasi) throw err;
    // Ağ hatası
    throw new GeciciHata(`Sağlayıcıya ulaşılamadı: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Geçici hatalarda artan gecikmeyle yeniden dener */
async function chatDayanikli(
  secenekler: ChatSecenekleri,
  deneme = 3
): Promise<{ icerik: string; olcum: AiOlcum }> {
  let sonHata: unknown;

  for (let i = 0; i < deneme; i++) {
    try {
      return await chatOnce(secenekler);
    } catch (err) {
      sonHata = err;
      if (!(err instanceof GeciciHata) || i === deneme - 1) throw err;
      await bekle(1000 * Math.pow(2, i)); // 1 sn, 2 sn
    }
  }

  throw sonHata;
}

/**
 * JSON bekleyen bir istek atar; veriyle birlikte ölçümü de döndürür.
 * - Geçici sağlayıcı hatalarında (429/5xx/zaman aşımı) yeniden dener.
 * - Çıktı ayrıştırılamazsa düz JSON isteyerek bir kez daha dener.
 *
 * İkinci deneme yapılırsa ölçümler TOPLANIR — o istek de para harcadı, aiview'de
 * görünmezse "bu ders neden pahalıya geldi" sorusunun cevabı eksik kalır.
 */
export async function chatJsonOlculu<T = unknown>(
  secenekler: ChatSecenekleri
): Promise<{ veri: T; olcum: AiOlcum; ham: string }> {
  const ilk = await chatDayanikli(secenekler);

  try {
    return { veri: parseJsonLoose<T>(ilk.icerik), olcum: ilk.olcum, ham: ilk.icerik };
  } catch (ilkHata) {
    if (!(ilkHata instanceof AiHatasi)) throw ilkHata;

    const ikinci = await chatDayanikli({
      ...secenekler,
      mesajlar: [
        ...secenekler.mesajlar,
        { role: "assistant", content: ilk.icerik.slice(0, 500) },
        {
          role: "user",
          content:
            "Bu cevap geçerli JSON değildi. Aynı içeriği SADECE geçerli JSON olarak, " +
            "kod bloğu işareti veya açıklama metni olmadan tekrar gönder.",
        },
      ],
    });
    return {
      veri: parseJsonLoose<T>(ikinci.icerik),
      olcum: olcumTopla(ilk.olcum, ikinci.olcum),
      ham: ikinci.icerik,
    };
  }
}

/** Ölçüme ihtiyacı olmayan çağrılar için sade sarmalayıcı. */
export async function chatJson<T = unknown>(secenekler: ChatSecenekleri): Promise<T> {
  return (await chatJsonOlculu<T>(secenekler)).veri;
}
