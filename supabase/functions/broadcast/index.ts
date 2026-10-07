// Broadcasts.
//  start  - validate a draft and schedule it (now or later) (admins, supervisors)
//  cancel - stop a scheduled or running broadcast
//  sweep  - start due broadcasts and send the next batch of each, at its
//           per-minute pace (service role; cron every minute)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, isServiceRole, requireMember } from "../_shared/supabase.ts";
import { sendToConversation } from "../_shared/send.ts";
import { type FollowupContext, renderFollowup } from "../_shared/followup.ts";
import { cleanName } from "../_shared/ai.ts";

const SUPPORTED = ["cloud_api", "qr", "telegram"];
const OPT_OUT = "\n\nBalas STOP jika tidak ingin menerima info seperti ini lagi.";

interface Broadcast {
  id: string;
  organization_id: string;
  name: string;
  channel_id: string;
  kind: "text" | "template";
  body: string;
  template_name: string | null;
  template_language: string | null;
  template_params: string[];
  add_opt_out: boolean;
  per_minute: number;
  status: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendBatch(admin: SupabaseClient, b: Broadcast, deadlineMs: number) {
  const [{ data: channel }, { data: ai }, { data: org }] = await Promise.all([
    admin.from("channels").select("provider, is_active").eq("id", b.channel_id).single(),
    admin.from("ai_settings").select("bot_name, salutation").eq("organization_id", b.organization_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", b.organization_id).single(),
  ]);
  const { data: batch, error } = await admin.rpc("broadcast_claim", { p_id: b.id, p_limit: b.per_minute });
  if (error) throw error;
  const rows = (batch ?? []) as { id: string; contact_id: string }[];
  // Spread the batch over the minute; QR numbers get a little randomness so the
  // sending pattern looks less like a machine.
  const gap = Math.min(3000, Math.floor(50_000 / Math.max(1, b.per_minute)));
  for (const r of rows) {
    if (Date.now() > deadlineMs) {
      await admin.from("broadcast_recipients").update({ status: "pending", claimed_at: null }).eq("id", r.id);
      continue;
    }
    let conversationId: string | null = null;
    try {
      if (!channel?.is_active) throw new HttpError(409, "Kanal nonaktif", "channel_inactive");
      const { data: contact } = await admin.from("contacts").select("name, profile_name, broadcast_opt_out").eq("id", r.contact_id).single();
      if (contact?.broadcast_opt_out) throw new HttpError(409, "Kontak berhenti berlangganan", "opted_out");
      const { data: convId, error: convError } = await admin.rpc("broadcast_conversation", { p_channel: b.channel_id, p_contact: r.contact_id });
      if (convError) throw convError;
      conversationId = convId as string;
      const ctx: FollowupContext = {
        name: cleanName(contact?.name) ?? cleanName(contact?.profile_name),
        salutation: ai?.salutation ?? "auto",
        agent: null,
        bot: ai?.bot_name ?? "Admin",
        shop: org?.name ?? "kami",
      };
      const meta = { broadcast: { id: b.id, name: b.name } };
      const message = b.kind === "template"
        ? await sendToConversation(admin, conversationId, {
          type: "template",
          template: {
            name: b.template_name!,
            language: b.template_language!,
            parameters: b.template_params.map((p) => renderFollowup(p, ctx)),
          },
        }, null, meta)
        : await sendToConversation(admin, conversationId, {
          type: "text",
          text: renderFollowup(b.body, ctx) + (b.add_opt_out ? OPT_OUT : ""),
        }, null, meta);
      await admin.from("broadcast_recipients").update({
        status: "sent", message_id: message?.id ?? null, conversation_id: conversationId, sent_at: new Date().toISOString(), error: null,
      }).eq("id", r.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin.from("broadcast_recipients").update({ status: "failed", error: msg.slice(0, 300), conversation_id: conversationId }).eq("id", r.id);
    }
    if (channel?.provider === "qr") await sleep(gap + Math.floor(Math.random() * 1500));
    else if (gap > 200) await sleep(Math.min(gap, 1000));
  }
  const { count } = await admin.from("broadcast_recipients").select("id", { count: "exact", head: true })
    .eq("broadcast_id", b.id).in("status", ["pending", "sending"]);
  if (!count) {
    await admin.from("broadcasts").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", b.id).eq("status", "sending");
  }
  return rows.length;
}

async function sweep(admin: SupabaseClient) {
  const deadline = Date.now() + 50_000;
  const { data: due } = await admin.from("broadcasts").select("id").eq("status", "scheduled").lte("scheduled_at", new Date().toISOString()).limit(20);
  for (const d of due ?? []) await admin.rpc("broadcast_prepare", { p_id: d.id });
  const { data: sending } = await admin.from("broadcasts").select("*").eq("status", "sending").order("started_at").limit(10);
  let sent = 0;
  for (const b of (sending ?? []) as Broadcast[]) {
    if (Date.now() > deadline) break;
    sent += await sendBatch(admin, b, deadline);
  }
  return { started: due?.length ?? 0, processed: sent };
}

serveJson(async (req) => {
  const admin = adminClient();
  const input = await readJson<{ action: string; broadcast_id?: string; scheduled_at?: string | null }>(req);
  if (input.action === "sweep") {
    if (!isServiceRole(req)) throw new HttpError(401, "Service role required", "unauthorized");
    return json(await sweep(admin));
  }

  const member = await requireMember(req, admin, ["admin", "supervisor"]);
  const { data: b } = await admin.from("broadcasts").select("*, channels(provider)").eq("id", input.broadcast_id ?? "")
    .eq("organization_id", member.organization_id).maybeSingle();
  if (!b) throw new HttpError(404, "Broadcast tidak ditemukan", "not_found");

  if (input.action === "start") {
    if (b.status !== "draft") throw new HttpError(409, "Broadcast ini sudah dijadwalkan atau dikirim", "invalid_status");
    const provider = (b.channels as { provider: string }).provider;
    if (!SUPPORTED.includes(provider)) {
      throw new HttpError(400, "Broadcast hanya untuk WhatsApp dan Telegram (Meta melarang promosi di Messenger/Instagram)", "invalid_request");
    }
    if (provider === "cloud_api" && b.kind !== "template") {
      throw new HttpError(400, "Nomor WhatsApp API resmi hanya boleh broadcast memakai template yang disetujui Meta", "template_required");
    }
    if (b.kind === "template") {
      if (provider !== "cloud_api") throw new HttpError(400, "Template hanya untuk WhatsApp API resmi", "invalid_request");
      const { data: tpl } = await admin.from("templates").select("status").eq("channel_id", b.channel_id)
        .eq("name", b.template_name ?? "").eq("language", b.template_language ?? "").maybeSingle();
      if (!tpl) throw new HttpError(400, "Template tidak ditemukan. Sinkronkan template dulu.", "template_not_found");
      if (tpl.status && tpl.status !== "APPROVED") throw new HttpError(400, `Template berstatus ${tpl.status}`, "template_not_approved");
    } else if (!b.body.trim()) {
      throw new HttpError(400, "Isi pesan broadcast", "invalid_request");
    }
    const when = input.scheduled_at ? new Date(input.scheduled_at) : new Date();
    if (isNaN(when.getTime())) throw new HttpError(400, "Waktu jadwal tidak valid", "invalid_request");
    const { data, error } = await admin.from("broadcasts").update({ status: "scheduled", scheduled_at: when.toISOString() })
      .eq("id", b.id).eq("status", "draft").select().single();
    if (error) throw error;
    return json({ broadcast: data });
  }

  if (input.action === "cancel") {
    if (!["scheduled", "sending", "draft"].includes(b.status)) throw new HttpError(409, "Broadcast ini sudah selesai", "invalid_status");
    await admin.from("broadcasts").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", b.id);
    await admin.from("broadcast_recipients").update({ status: "failed", error: "Dibatalkan" }).eq("broadcast_id", b.id).eq("status", "pending");
    return json({ ok: true });
  }
  throw new HttpError(400, "Unknown action", "invalid_request");
});
