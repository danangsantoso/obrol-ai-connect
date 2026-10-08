import type { ConversationRow } from "@/components/inbox/types";

export const ONBOARDED_KEY = "balas.m.onboarded";

// The AI is answering this chat (no agent has it).
export function aiServing(c: ConversationRow, aiReady: boolean) {
  return aiReady && !c.assignee_id && c.ai_engaged && c.ai_active && Boolean(c.channel?.ai_enabled) && c.status !== "resolved";
}

const AVATAR_COLORS = ["#7c3aed", "#0f766e", "#c2410c", "#1d4ed8", "#be185d", "#475569"];

export function colorFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
