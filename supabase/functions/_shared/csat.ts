// Satisfaction survey: sends the 1-5 question to chats resolved a minute ago
// and thanks customers who answered. The database records the rating and
// keeps the chat resolved (csat_on_message / csat_keep_resolved).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendToConversation } from "./send.ts";

export async function sweepCsat(admin: SupabaseClient) {
  let sent = 0;
  const { data: due } = await admin
    .from("csat_requests")
    .select("id, organization_id, conversation_id, organizations(csat_message, csat_enabled), conversations(status, last_customer_message_at, channels(provider))")
    .eq("status", "pending")
    .lte("send_after", new Date().toISOString())
    .order("send_after")
    .limit(50);
  for (const r of (due ?? []) as unknown as {
    id: string;
    conversation_id: string;
    organizations: { csat_message: string; csat_enabled: boolean };
    conversations: { status: string; last_customer_message_at: string | null; channels: { provider: string } };
  }[]) {
    // Claim it first so a parallel sweep does not ask twice.
    const { data: claimed } = await admin.from("csat_requests").update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", r.id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;
    const provider = r.conversations.channels.provider;
    const windowOpen = r.conversations.last_customer_message_at &&
      Date.now() - new Date(r.conversations.last_customer_message_at).getTime() < 24 * 3600_000;
    // Skip chats reopened meanwhile, surveys turned off, and channels that cannot reach the customer now.
    if (!r.organizations.csat_enabled || r.conversations.status !== "resolved" || provider === "webchat" ||
      (["cloud_api", "messenger", "instagram"].includes(provider) && !windowOpen)) {
      await admin.from("csat_requests").update({ status: "skipped" }).eq("id", r.id);
      continue;
    }
    try {
      const message = await sendToConversation(admin, r.conversation_id, { type: "text", text: r.organizations.csat_message }, null, { csat: true });
      await admin.from("csat_requests").update({ message_id: message?.id ?? null }).eq("id", r.id);
      sent++;
    } catch (err) {
      console.error(`csat ${r.id} failed`, err);
      await admin.from("csat_requests").update({ status: "skipped" }).eq("id", r.id);
    }
  }

  const { data: answered } = await admin
    .from("csat_requests")
    .select("id, conversation_id, organizations(csat_thanks)")
    .eq("status", "answered")
    .eq("thanked", false)
    .limit(50);
  for (const r of (answered ?? []) as unknown as { id: string; conversation_id: string; organizations: { csat_thanks: string } }[]) {
    const { data: claimed } = await admin.from("csat_requests").update({ thanked: true }).eq("id", r.id).eq("thanked", false).select("id");
    if (!claimed?.length || !r.organizations.csat_thanks?.trim()) continue;
    try {
      await sendToConversation(admin, r.conversation_id, { type: "text", text: r.organizations.csat_thanks }, null, { csat: true });
    } catch (err) {
      console.error(`csat thanks ${r.id} failed`, err);
    }
  }
  return sent;
}
