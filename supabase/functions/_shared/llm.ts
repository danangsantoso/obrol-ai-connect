// One entry point for the language models an organization can pick:
// Claude (Anthropic SDK), ChatGPT (OpenAI), DeepSeek, Gemini and any other
// OpenAI-compatible API (OpenRouter, Groq, Qwen, a local Ollama, ...).
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";

export type Provider = "openai" | "anthropic" | "deepseek" | "gemini" | "custom";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // Pictures the customer sent with this turn (base64), for models that can see.
  images?: { mime: string; data: string }[];
}

// Provider-specific message content with pictures.
function anthropicMessages(messages: ChatMessage[]) {
  return messages.map((m) =>
    m.images?.length
      ? {
        role: m.role,
        content: [
          ...m.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: img.data },
          })),
          { type: "text" as const, text: m.content },
        ],
      }
      : { role: m.role, content: m.content }
  );
}

function openAiMessages(messages: ChatMessage[]) {
  return messages.map((m) =>
    m.images?.length
      ? {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          ...m.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.data}` } })),
        ],
      }
      : { role: m.role, content: m.content }
  );
}

export interface LlmConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  // Model cadangan: dicoba berurutan ketika model utama gagal menjawab.
  fallbacks?: LlmConfig[];
}

export interface LlmResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  // The model declined to answer (safety); the caller hands the chat to a person.
  refused: boolean;
  // Which model actually answered (the chain may have moved past the first one).
  provider?: Provider;
  model?: string;
  // 1 = model utama, 2+ = model cadangan yang dipakai.
  layer?: number;
}

// Shape every provider is asked to answer in.
export const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    handoff: { type: "boolean" },
    reason: { type: "string" },
    customer_name: { type: "string" },
    missing_info: { type: "string" },
    // Keys of the organization's files to send after the reply (F1, F2, ...).
    attachments: { type: "array", items: { type: "string" } },
  },
  required: ["reply", "handoff", "reason", "customer_name", "missing_info", "attachments"],
  additionalProperties: false,
};

const str = { type: "string" };

// The reply shape when the AI may also take orders: the order it collected
// ("ready" once the customer confirmed and the details are complete) and a
// postal code to look up shipping rates for.
export const ORDER_REPLY_SCHEMA = {
  ...REPLY_SCHEMA,
  properties: {
    ...REPLY_SCHEMA.properties,
    order: {
      type: "object",
      properties: {
        ready: { type: "boolean" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { name: str, qty: { type: "integer" } },
            required: ["name", "qty"],
            additionalProperties: false,
          },
        },
        customer_name: str,
        phone: str,
        address: str,
        city: str,
        postal_code: str,
        notes: str,
      },
      required: ["ready", "items", "customer_name", "phone", "address", "city", "postal_code", "notes"],
      additionalProperties: false,
    },
    ongkir_postal_code: str,
  },
  required: [...REPLY_SCHEMA.required, "order", "ongkir_postal_code"],
};

const OPENAI_COMPATIBLE_BASE: Partial<Record<Provider, string>> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

const TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 4000;

export class LlmError extends Error {
  constructor(public status: number | null, message: string) {
    super(message);
  }
}

function friendlyStatus(status: number | null, detail: string): string {
  if (status === 401 || status === 403) return `API key ditolak oleh penyedia AI (${status}). Periksa API key.`;
  if (status === 404) return `Model tidak ditemukan di penyedia AI. Periksa nama model. ${detail}`.trim();
  if (status === 429) return "Batas pemakaian/kuota penyedia AI habis (429). Coba lagi nanti atau cek saldo akun.";
  if (status && status >= 500) return `Penyedia AI sedang bermasalah (${status}).`;
  return detail || "Permintaan ke penyedia AI gagal.";
}

// Model berlapis: model utama dicoba lebih dulu, lalu tiap model cadangan
// berurutan. Satu model yang bermasalah (nama salah, kuota habis, penyedia
// sedang down) tidak boleh membuat chat pelanggan berhenti dilayani.
export async function complete(
  cfg: LlmConfig,
  system: string,
  messages: ChatMessage[],
  schema: Record<string, unknown> = REPLY_SCHEMA,
): Promise<LlmResult> {
  const chain = [cfg, ...(cfg.fallbacks ?? [])];
  let lastError: unknown = null;
  for (let i = 0; i < chain.length; i++) {
    const layer = chain[i];
    try {
      const result = await completeOnce(layer, system, messages, schema);
      // Jawaban kosong juga dianggap gagal: coba lapis berikutnya dulu.
      if (!result.text && !result.refused && i < chain.length - 1) {
        console.error(`model ${layer.provider}/${layer.model} tidak menghasilkan jawaban, lanjut ke lapis ${i + 2}`);
        continue;
      }
      if (i > 0) console.log(`model cadangan dipakai: ${layer.provider}/${layer.model} (lapis ${i + 1}/${chain.length})`);
      return { ...result, provider: layer.provider, model: layer.model, layer: i + 1 };
    } catch (err) {
      lastError = err;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`model lapis ${i + 1}/${chain.length} gagal (${layer.provider}/${layer.model}): ${detail}`);
    }
  }
  throw lastError ?? new LlmError(null, "Tidak ada model AI yang bisa dipakai.");
}

function completeOnce(
  cfg: LlmConfig,
  system: string,
  messages: ChatMessage[],
  schema: Record<string, unknown>,
): Promise<LlmResult> {
  return cfg.provider === "anthropic"
    ? completeAnthropic(cfg, system, messages, schema)
    : completeOpenAiCompatible(cfg, system, messages, schema);
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

// Models with adaptive thinking + effort, and structured outputs.
const CURRENT_CLAUDE = /^claude-(opus|sonnet|fable|mythos)-(5|4-[6-9])/;
const STRUCTURED_CLAUDE = /^claude-(opus|sonnet|fable|mythos|haiku)-(5|4-[5-9])/;
// Models that accept server-side refusal fallbacks in their "default" form.
const FALLBACK_CLAUDE = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

async function completeAnthropic(
  cfg: LlmConfig,
  system: string,
  messages: ChatMessage[],
  schema: Record<string, unknown>,
): Promise<LlmResult> {
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl || undefined,
    timeout: TIMEOUT_MS,
    maxRetries: 1,
  });
  const fallback = FALLBACK_CLAUDE.has(cfg.model);
  try {
    const response = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: anthropicMessages(messages),
      // Chat replies are short and latency matters: low effort.
      ...(CURRENT_CLAUDE.test(cfg.model) || STRUCTURED_CLAUDE.test(cfg.model)
        ? {
          output_config: {
            ...(CURRENT_CLAUDE.test(cfg.model) ? { effort: "low" as const } : {}),
            ...(STRUCTURED_CLAUDE.test(cfg.model) ? { format: { type: "json_schema" as const, schema } } : {}),
          },
        }
        : {}),
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (response.stop_reason === "refusal") {
      return { text: "", inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, refused: true };
    }
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      refused: false,
    };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new LlmError(err.status, friendlyStatus(err.status, ""));
    }
    if (err instanceof Anthropic.NotFoundError) throw new LlmError(404, friendlyStatus(404, cfg.model));
    if (err instanceof Anthropic.RateLimitError) throw new LlmError(429, friendlyStatus(429, ""));
    if (err instanceof Anthropic.APIConnectionError) {
      throw new LlmError(null, "Tidak bisa menghubungi Anthropic (koneksi/timeout).");
    }
    if (err instanceof Anthropic.APIError) {
      throw new LlmError(err.status ?? null, friendlyStatus(err.status ?? null, err.message));
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// OpenAI and OpenAI-compatible APIs (DeepSeek, Gemini, custom)
// ---------------------------------------------------------------------------

async function completeOpenAiCompatible(
  cfg: LlmConfig,
  system: string,
  messages: ChatMessage[],
  schema: Record<string, unknown>,
): Promise<LlmResult> {
  const base = (cfg.baseUrl || OPENAI_COMPATIBLE_BASE[cfg.provider] || "").replace(/\/$/, "");
  if (!base) throw new LlmError(null, "Base URL wajib diisi untuk penyedia lain (OpenAI-compatible).");

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [{ role: "system", content: system }, ...openAiMessages(messages)],
  };
  if (cfg.provider === "openai") {
    // Reasoning models count their thinking in this budget.
    body.max_completion_tokens = MAX_OUTPUT_TOKENS;
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "balas_reply", strict: true, schema },
    };
  } else {
    body.max_tokens = MAX_OUTPUT_TOKENS;
    if (cfg.provider === "deepseek" && !cfg.model.includes("reasoner")) body.response_format = { type: "json_object" };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new LlmError(null, `Tidak bisa menghubungi ${base} (koneksi/timeout).`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message ?? (typeof data?.error === "string" ? data.error : "");
    throw new LlmError(res.status, friendlyStatus(res.status, String(detail).slice(0, 300)));
  }
  const choice = data?.choices?.[0];
  return {
    text: String(choice?.message?.content ?? "").trim(),
    inputTokens: data?.usage?.prompt_tokens ?? null,
    outputTokens: data?.usage?.completion_tokens ?? null,
    refused: Boolean(choice?.message?.refusal) || choice?.finish_reason === "content_filter",
  };
}
