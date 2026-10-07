import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Tables } from "@/integrations/supabase/types";

export type Provider = Database["public"]["Enums"]["ai_provider"];
export type AiSettings = Tables<"ai_settings">;

export const PROVIDERS: Record<Provider, { label: string; models: string[]; keyHint: string; baseUrl?: string }> = {
  anthropic: {
    label: "Claude (Anthropic)",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"],
    keyHint: "console.anthropic.com → API Keys (sk-ant-…)",
  },
  openai: {
    label: "ChatGPT (OpenAI)",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1-mini"],
    keyHint: "platform.openai.com → API keys (sk-…)",
  },
  deepseek: {
    label: "DeepSeek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    keyHint: "platform.deepseek.com → API keys",
  },
  gemini: {
    label: "Gemini (Google)",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    keyHint: "aistudio.google.com → Get API key",
  },
  custom: {
    label: "LLM lain (OpenAI-compatible)",
    models: [],
    keyHint: "API key dari penyedia (OpenRouter, Groq, Qwen, Ollama, …)",
    baseUrl: "https://openrouter.ai/api/v1",
  },
};

export function useAiSettings(orgId: string) {
  return useQuery({
    queryKey: ["ai-settings", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_settings").select("*").eq("organization_id", orgId).maybeSingle();
      if (error) throw error;
      return data as AiSettings | null;
    },
  });
}

