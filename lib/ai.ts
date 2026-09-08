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

export interface ChatMesaj {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AiHatasi extends Error {}

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
      return JSON.parse(t.slice(bas, son + 1)) as T;
    }
    throw new AiHatasi("Model geçerli JSON döndürmedi.");
  }
}

interface ChatSecenekleri {
  mesajlar: ChatMesaj[];
  maxTokens?: number;
  timeoutMs?: number;
  /** Hangi işin modeli kullanılsın — her rolün kendi env değişkeni var */
  rol?: "uretim" | "degerlendirme" | "denetim";
}

async function chatOnce({
  mesajlar,
  maxTokens = 8000,
  timeoutMs = 240_000,
  rol = "uretim",
}: ChatSecenekleri): Promise<string> {
  if (!BASE_URL || !API_KEY) {
    throw new AiHatasi("AI_BASE_URL ve AI_API_KEY ortam değişkenleri tanımlı değil.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model:
          rol === "degerlendirme"
            ? DEGERLENDIRME_MODELI
            : rol === "denetim"
              ? DENETIM_MODELI
              : URETIM_MODELI,
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        messages: mesajlar,
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
    return icerik;
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
async function chatDayanikli(secenekler: ChatSecenekleri, deneme = 3): Promise<string> {
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
 * JSON bekleyen bir istek atar.
 * - Geçici sağlayıcı hatalarında (429/5xx/zaman aşımı) yeniden dener.
 * - Çıktı ayrıştırılamazsa düz JSON isteyerek bir kez daha dener.
 */
export async function chatJson<T = unknown>(secenekler: ChatSecenekleri): Promise<T> {
  const ham = await chatDayanikli(secenekler);

  try {
    return parseJsonLoose<T>(ham);
  } catch (ilkHata) {
    if (!(ilkHata instanceof AiHatasi)) throw ilkHata;

    const ikinci = await chatDayanikli({
      ...secenekler,
      mesajlar: [
        ...secenekler.mesajlar,
        { role: "assistant", content: ham.slice(0, 500) },
        {
          role: "user",
          content:
            "Bu cevap geçerli JSON değildi. Aynı içeriği SADECE geçerli JSON olarak, " +
            "kod bloğu işareti veya açıklama metni olmadan tekrar gönder.",
        },
      ],
    });
    return parseJsonLoose<T>(ikinci);
  }
}
