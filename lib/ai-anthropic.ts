// Direct Anthropic route for "anthropic/…" models (official SDK).
//
// Why it exists: the Claude plan's monthly API credit is only spent on the
// Anthropic API, not on OpenRouter. lib/ai.ts sends "anthropic/…" models here
// when ANTHROPIC_API_KEY is set and falls back to OpenRouter when this route
// fails (credit used up, key revoked, outage), so nothing stops working.
//
// Differences from the OpenAI-compatible route that this file absorbs:
//   • No response_format: the prompts already ask for JSON, and lib/ai.ts
//     parses loosely and retries once on a non-JSON answer.
//   • Thinking is on by default and counts against max_tokens, so the caller's
//     visible-output budget gets headroom on top (THINKING_HEADROOM).
//   • The API does not report cost; it is computed from usage × list price so
//     the Kariyer daily cap and /ders/aiview keep working.

import Anthropic from "@anthropic-ai/sdk";
import type { ChatMesaj } from "./ai";

/** USD per 1M tokens (list prices, 2026-11). Unknown model -> cost stays undefined. */
const FIYAT: Record<string, { girdi: number; cikti: number; okuma?: number }> = {
  "claude-fable-5-2": { girdi: 8, cikti: 40, okuma: 0.2 },
  "claude-opus-5-5": { girdi: 4, cikti: 20, okuma: 0.2 },
  "claude-sonnet-5-5": { girdi: 2, cikti: 10, okuma: 0.1 },
  "claude-haiku-5-5": { girdi: 0.1, cikti: 0.5 },
};
/** Cache reads without a listed price are estimated at 0.1x the input price */
const OKUMA_CARPANI = 0.1;
/** Used for a model missing from FIYAT: the most expensive listed one, so the cap errs high */
const BILINMEYEN_FIYAT = { girdi: 8, cikti: 40, okuma: 0.2 };
/** 5-minute cache writes cost 1.25× the input price */
const YAZMA_CARPANI = 1.25;
/** Room for thinking tokens above the caller's output budget */
const THINKING_HEADROOM = 16_000;

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const anthropicAcikMi = () => !!process.env.ANTHROPIC_API_KEY?.trim();

/** "anthropic/claude-sonnet-5.5" (OpenRouter slug) -> "claude-sonnet-5-5" (API id) */
export const anthropicModelKimligi = (slug: string) => slug.replace(/^anthropic\//, "").replace(/\./g, "-");

let istemci: Anthropic | null = null;
const istemciyiAl = () => (istemci ??= new Anthropic({ maxRetries: 0 }));

/** Thrown for failures where trying OpenRouter is the right next step */
export class AnthropicYoluHatasi extends Error {
  /** true: do not try this route again for a while (no credit, bad key, no access) */
  constructor(
    mesaj: string,
    readonly kalici: boolean,
    /** What the failed attempt still cost (a refusal or an answer with no text is billed) */
    readonly maliyetUsd = 0,
  ) {
    super(mesaj);
  }
}

export interface AnthropicSonucu {
  icerik: string;
  girdiToken: number;
  ciktiToken: number;
  onbellekToken: number;
  maliyetUsd: number;
  /** The model that answered (differs from the request after a refusal fallback) */
  model: string;
}

function mesajlariCevir(mesajlar: ChatMesaj[]) {
  const system: Anthropic.Beta.BetaTextBlockParam[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of mesajlar) {
    const parcalar: Anthropic.Beta.BetaTextBlockParam[] =
      typeof m.content === "string"
        ? m.content.trim()
          ? [{ type: "text", text: m.content }]
          : []
        : m.content
            // The API rejects empty text blocks (and a cache mark on one)
            .filter((p) => p.text.trim())
            .map((p) => ({ type: "text", text: p.text, ...(p.cache_control ? { cache_control: p.cache_control } : {}) }));
    if (!parcalar.length) continue;
    if (m.role === "system") system.push(...parcalar);
    else messages.push({ role: m.role, content: parcalar });
  }
  // The system prompt repeats across calls (Kariyer scores hundreds of ads with the
  // same one), so it is the cache boundary unless the caller already marked one.
  // A prompt below the model's minimum cacheable length is simply not cached.
  const isaretli = mesajlar.some((m) => typeof m.content !== "string" && m.content.some((p) => p.cache_control));
  const son = system[system.length - 1];
  if (!isaretli && son) system[system.length - 1] = { ...son, cache_control: { type: "ephemeral" } };
  return { system, messages };
}

export async function anthropicChat(secenek: {
  /** OpenRouter-style slug, e.g. "anthropic/claude-sonnet-5.5" */
  model: string;
  mesajlar: ChatMesaj[];
  maxTokens: number;
  timeoutMs: number;
  effort?: string;
}): Promise<AnthropicSonucu> {
  const model = anthropicModelKimligi(secenek.model);
  const { system, messages } = mesajlariCevir(secenek.mesajlar);
  const effort = (["low", "medium", "high", "xhigh", "max"] as const).find((e) => e === secenek.effort) as Effort | undefined;

  // The SDK timeout only covers the wait for response headers; a stream that stalls
  // afterwards would hang. This aborts the whole call, like the OpenRouter route does.
  const kesici = new AbortController();
  const sayac = setTimeout(() => kesici.abort(), secenek.timeoutMs);
  let cevap: Anthropic.Beta.BetaMessage;
  try {
    // Streaming keeps long generations under HTTP timeouts; only the final message is used.
    cevap = await istemciyiAl()
      .beta.messages.stream(
        {
          model,
          max_tokens: secenek.maxTokens + THINKING_HEADROOM,
          ...(system.length ? { system } : {}),
          messages,
          ...(effort ? { output_config: { effort } } : {}),
          // A safety-classifier false positive is re-run server-side on the model
          // Anthropic recommends instead of surfacing as a refusal.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout: secenek.timeoutMs, signal: kesici.signal },
      )
      .finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new AnthropicYoluHatasi(`Anthropic anahtarı reddedildi (${e.status})`, true);
    }
    if (e instanceof Anthropic.APIError) {
      // 402 billing_error, or a 400 saying the credit balance is too low
      const kredi = e.status === 402 || e.type === "billing_error" || /credit balance/i.test(e.message);
      throw new AnthropicYoluHatasi(`Anthropic ${e.status ?? "bağlantı"}: ${e.message.slice(0, 160)}`, kredi);
    }
    throw new AnthropicYoluHatasi(`Anthropic'e ulaşılamadı: ${(e as Error).message}`, false);
  } finally {
    clearTimeout(sayac);
  }

  const u = cevap.usage;
  const okuma = u.cache_read_input_tokens ?? 0;
  const yazma = u.cache_creation_input_tokens ?? 0;
  let fiyat = FIYAT[cevap.model] ?? FIYAT[model];
  if (!fiyat) {
    // The Kariyer daily cap counts this number; an unpriced model must not read as free.
    fiyat = BILINMEYEN_FIYAT;
    console.warn(`[ai] ${cevap.model} fiyat tablosunda yok; maliyet en pahalı modelden tahmin ediliyor`);
  }
  const maliyetUsd =
    (u.input_tokens * fiyat.girdi +
      yazma * fiyat.girdi * YAZMA_CARPANI +
      okuma * (fiyat.okuma ?? fiyat.girdi * OKUMA_CARPANI) +
      u.output_tokens * fiyat.cikti) /
    1_000_000;

  if (cevap.stop_reason === "refusal") throw new AnthropicYoluHatasi("Anthropic isteği reddetti (refusal)", false, maliyetUsd);
  const icerik = cevap.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!icerik.trim()) {
    throw new AnthropicYoluHatasi(`Anthropic boş cevap döndürdü (stop_reason: ${cevap.stop_reason})`, false, maliyetUsd);
  }

  return {
    icerik,
    // Same convention as the OpenAI-compatible route: input total includes the cached part
    girdiToken: u.input_tokens + okuma + yazma,
    ciktiToken: u.output_tokens,
    onbellekToken: okuma,
    maliyetUsd,
    model: `anthropic/${cevap.model}`,
  };
}
