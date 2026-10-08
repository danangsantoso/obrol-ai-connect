// Push notifications.
//  public_key - the VAPID key browsers subscribe with (members)
//  test       - a test notification to the caller's own devices
//  dispatch   - send queued notifications (woken by the database; it only
//               drains the queue, so it needs no credentials)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, requireMember } from "../_shared/supabase.ts";
import { sendPush, vapidKeys } from "../_shared/webpush.ts";

const subject = () => `mailto:${Deno.env.get("PUSH_CONTACT_EMAIL") || "admin@balas.id"}`;

async function dispatch(admin: SupabaseClient) {
  const { data: queued, error } = await admin.rpc("push_claim", { p_limit: 100 });
  if (error) throw error;
  if (!queued?.length) return { sent: 0 };
  const vapid = await vapidKeys(admin);
  const users = [...new Set((queued as { user_id: string }[]).map((q) => q.user_id))];
  const { data: devices } = await admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", users);
  let sent = 0;
  const gone: string[] = [];
  const used: string[] = [];
  await Promise.all((queued as { user_id: string; title: string; body: string; url: string; tag: string | null }[]).flatMap((q) =>
    (devices ?? []).filter((d) => d.user_id === q.user_id).map(async (d) => {
      const r = await sendPush(vapid, d, { title: q.title, body: q.body, url: q.url, tag: q.tag }, subject());
      if (r === "ok") {
        sent++;
        used.push(d.id);
      } else if (r === "gone") gone.push(d.id);
    })
  ));
  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
  if (used.length) await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", [...new Set(used)]);
  return { sent, removed: gone.length };
}

serveJson(async (req) => {
  const admin = adminClient();
  const input = await readJson<{ action?: string }>(req);
  if (input.action === "dispatch") return json(await dispatch(admin));

  const member = await requireMember(req, admin);
  if (input.action === "public_key") return json({ public_key: (await vapidKeys(admin)).publicKey });
  if (input.action === "test") {
    const { count } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", member.id);
    if (!count) throw new HttpError(400, "Belum ada perangkat yang mengaktifkan notifikasi", "no_device");
    await admin.from("push_queue").insert({ user_id: member.id, title: "Balas.id", body: "Notifikasi sudah aktif di perangkat ini 🎉", url: "/inbox", tag: "test" });
    return json(await dispatch(admin));
  }
  throw new HttpError(400, "Unknown action", "invalid_request");
});
