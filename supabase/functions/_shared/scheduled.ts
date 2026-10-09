// Messages agents scheduled for later, and chats they snoozed: sent / brought
// back by the minute sweep (followup function). A message that cannot be sent
// (closed 24-hour window, number disconnected) is marked failed and the agent
// gets a push notification.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, reportError } from "./http.ts";
import { type MediaType, sendToConversation } from "./send.ts";

interface Scheduled {
  id: string;
  conversation_id: string;
  created_by: string | null;
  type: "text" | MediaType;
  body: string | null;
  media_path: string | null;
  media_filename: string | null;
}

export async function sweepScheduled(admin: SupabaseClient) {
  const { data: woken, error: wakeError } = await admin.rpc("wake_due_snoozes");
  if (wakeError) reportError("wake snoozed chats failed", wakeError);

  const { data, error } = await admin.rpc("claim_scheduled_messages", { p_limit: 50 });
  if (error) {
    reportError("claim scheduled messages failed", error);
    return { scheduled_sent: 0, scheduled_failed: 0, snoozes_woken: woken ?? 0 };
  }
  let sent = 0;
  let failed = 0;
  for (const s of (data ?? []) as Scheduled[]) {
    try {
      const message = await sendToConversation(
        admin,
        s.conversation_id,
        s.type === "text"
          ? { type: "text", text: s.body ?? "" }
          : { type: s.type, media_path: s.media_path ?? undefined, filename: s.media_filename ?? undefined, text: s.body ?? undefined },
        s.created_by,
        { scheduled_message: s.id },
      );
      await admin.from("scheduled_messages").update({ status: "sent", message_id: message?.id ?? null }).eq("id", s.id);
      sent++;
    } catch (err) {
      failed++;
      const reason = err instanceof HttpError ? err.message : "gagal terkirim";
      if (!(err instanceof HttpError)) reportError("scheduled message failed", err);
      await admin.from("scheduled_messages").update({ status: "failed", error: reason.slice(0, 300) }).eq("id", s.id);
      if (s.created_by) {
        await admin.rpc("notify_scheduled_failed", { p_user: s.created_by, p_conversation: s.conversation_id, p_reason: reason.slice(0, 120) });
      }
    }
  }
  return { scheduled_sent: sent, scheduled_failed: failed, snoozes_woken: woken ?? 0 };
}
