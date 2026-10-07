// One entry point for the language models an organization can pick:
// Claude (Anthropic SDK), ChatGPT (OpenAI), DeepSeek, Gemini and any other
// OpenAI-compatible API (OpenRouter, Groq, Qwen, a local Ollama, ...).
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";

export type Provider = "openai" | "anthropic" | "deepseek" | "gemini" | "custom";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
}

export interface LlmResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  // The model declined to answer (safety); the caller hands the chat to a person.
  refused: boolean;
}

// Shape every provider is asked to answer in.
export const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    handoff: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["reply", "handoff", "reason"],
  additionalProperties: false,
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

export function complete(cfg: LlmConfig, system: string, messages: ChatMessage[]): Promise<LlmResult> {
  return cfg.provider === "anthropic" ? completeAnthropic(cfg, system, messages) : completeOpenAiCompatible(cfg, system, messages);
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

// Models with adaptive thinking + effort, and structured outputs.
const CURRENT_CLAUDE = /^claude-(opus|sonnet|fable|mythos)-(5|4-[6-9])/;
const STRUCTURED_CLAUDE = /^claude-(opus|sonnet|fable|mythos|haiku)-(5|4-[5-9])/;
// Models that accept server-side refusal fallbacks in their "default" form.
const FALLBACK_CLAUDE = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

async function completeAnthropic(cfg: LlmConfig, system: string, messages: ChatMessage[]): Promise<LlmResult> {
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
      messages,
      // Chat replies are short and latency matters: low effort.
      ...(CURRENT_CLAUDE.test(cfg.model) || STRUCTURED_CLAUDE.test(cfg.model)
        ? {
          output_config: {
            ...(CURRENT_CLAUDE.test(cfg.model) ? { effort: "low" as const } : {}),
            ...(STRUCTURED_CLAUDE.test(cfg.model) ? { format: { type: "json_schema" as const, schema: REPLY_SCHEMA } } : {}),
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

async function completeOpenAiCompatible(cfg: LlmConfig, system: string, messages: ChatMessage[]): Promise<LlmResult> {
  const base = (cfg.baseUrl || OPENAI_COMPATIBLE_BASE[cfg.provider] || "").replace(/\/$/, "");
  if (!base) throw new LlmError(null, "Base URL wajib diisi untuk penyedia lain (OpenAI-compatible).");

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [{ role: "system", content: system }, ...messages],
  };
  if (cfg.provider === "openai") {
    // Reasoning models count their thinking in this budget.
    body.max_completion_tokens = MAX_OUTPUT_TOKENS;
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "balas_reply", strict: true, schema: REPLY_SCHEMA },
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
