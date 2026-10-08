// Business hours: outside them, a chat the AI will not answer gets the
// organization's away message (at most once every 12 hours per chat).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendToConversation } from "./send.ts";

export async function sendAwayMessage(admin: SupabaseClient, conversationId: string, orgId: string) {
  const [{ data: open }, { data: org }, { data: conv }] = await Promise.all([
    admin.rpc("is_business_open", { p_org: orgId }),
    admin.from("organizations").select("outside_hours_message").eq("id", orgId).single(),
    admin.from("conversations").select("status").eq("id", conversationId).single(),
  ]);
  const text = org?.outside_hours_message?.trim();
  // A resolved chat here means the customer only answered the satisfaction survey.
  if (open !== false || !text || conv?.status === "resolved") return;
  const { data: recent } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .contains("metadata", { away: true })
    .gte("created_at", new Date(Date.now() - 12 * 3600_000).toISOString())
    .limit(1);
  if (recent?.length) return;
  try {
    await sendToConversation(admin, conversationId, { type: "text", text }, null, { away: true });
  } catch (err) {
    console.error(`could not send away message to ${conversationId}`, err);
  }
}
