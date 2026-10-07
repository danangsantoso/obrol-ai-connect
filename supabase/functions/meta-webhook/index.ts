// Receives Messenger (object "page") and Instagram (object "instagram") webhooks:
// customer messages, replies sent from Meta's own apps (echoes), delivery and
// read receipts. Signed with the Meta app secret like the WhatsApp webhook.
//
// Env: META_APP_SECRET (or WHATSAPP_APP_SECRET), META_VERIFY_TOKEN (or WHATSAPP_VERIFY_TOKEN)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { adminClient } from "../_shared/supabase.ts";
import { extensionFor, isValidSignature } from "../_shared/whatsapp.ts";
import { decryptSecret } from "../_shared/crypto.ts";
import { contactKey, customerProfile } from "../_shared/meta.ts";
import { triggerAutoReply } from "../_shared/ai.ts";

// Messenger payloads vary by message type; fields are read defensively below.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

interface Channel {
  id: string;
  organization_id: string;
  provider: "messenger" | "instagram";
}

const ATTACHMENT_TYPES: Record<string, string> = { image: "image", video: "video", audio: "audio", file: "document" };

Deno.serve(async (req) => {
  if (req.method === "GET") return verifySubscription(req);
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  const secret = Deno.env.get("META_APP_SECRET") || Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secret) {
    console.error("META_APP_SECRET is not configured; rejecting webhook");
    return new Response("Webhook not configured", { status: 500 });
  }
  if (!(await isValidSignature(raw, req.headers.get("X-Hub-Signature-256"), secret))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: { object?: string; entry?: Raw[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (payload.object !== "page" && payload.object !== "instagram") return new Response("OK", { status: 200 });
  const provider = payload.object === "page" ? "messenger" : "instagram";

  const admin = adminClient();
  try {
    for (const entry of payload.entry ?? []) {
      const { data: channel } = await admin
        .from("channels")
        .select("id, organization_id, provider")
        .eq("provider", provider)
        .eq("external_id", String(entry.id))
        .eq("is_active", true)
        .maybeSingle<Channel>();
      if (!channel) {
        console.warn(`ignoring ${provider} event for unknown account ${entry.id}`);
        continue;
      }
      for (const event of entry.messaging ?? []) {
        await handleEvent(admin, channel, String(entry.id), event);
      }
    }
  } catch (err) {
    // A non-2xx makes Meta retry later; ingestion is idempotent so retries are safe.
    console.error("meta webhook processing failed", err);
    return new Response("Temporary failure", { status: 500 });
  }
  return new Response("OK", { status: 200 });
});

function verifySubscription(req: Request): Response {
  const url = new URL(req.url);
  const expected = Deno.env.get("META_VERIFY_TOKEN") || Deno.env.get("WHATSAPP_VERIFY_TOKEN");
  if (expected && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

async function pageToken(admin: SupabaseClient, channelId: string): Promise<string | null> {
  const { data } = await admin.from("channel_secrets").select("access_token_encrypted").eq("channel_id", channelId).maybeSingle();
  return data ? await decryptSecret(data.access_token_encrypted) : null;
}

async function handleEvent(admin: SupabaseClient, channel: Channel, accountId: string, event: Raw) {
  const echo = event.message?.is_echo === true;
  // The customer is the side that is not our Page / Instagram account.
  const customerId = String(echo || event.sender?.id === accountId ? event.recipient?.id : event.sender?.id);
  if (!customerId || customerId === "undefined") return;
  const key = contactKey(channel.provider, customerId);

  if (event.delivery) {
    for (const mid of event.delivery.mids ?? []) {
      await admin.rpc("apply_message_status", { p_wa_message_id: mid, p_status: "delivered", p_error: null });
    }
    return;
  }
  if (event.read) {
    await markRead(admin, channel, key, event.read.watermark ?? event.timestamp);
    return;
  }

  const described = describe(event);
  if (!described) return;

  // New customers: look up their name and picture once.
  let profile: { name: string | null; username: string | null; avatar: string | null } | null = null;
  if (!echo) {
    const { data: contact } = await admin
      .from("contacts")
      .select("profile_name")
      .eq("organization_id", channel.organization_id)
      .eq("wa_id", key)
      .maybeSingle();
    if (!contact?.profile_name) {
      const token = await pageToken(admin, channel.id);
      if (token) profile = await customerProfile(channel.provider, customerId, token);
    }
  }

  const { data: row, error } = await admin
    .rpc("ingest_channel_message", {
      p_channel_id: channel.id,
      p_direction: echo ? "outbound" : "inbound",
      p_wa_id: key,
      p_profile_name: profile?.name ?? null,
      p_wa_message_id: described.mid,
      p_type: described.type,
      p_body: described.body,
      p_reply_to_wa_id: event.message?.reply_to?.mid ?? null,
      p_metadata: { ...described.metadata, source: channel.provider, ...(echo ? { sent_from_meta: true } : {}) },
      p_sent_at: event.timestamp ? new Date(Number(event.timestamp)).toISOString() : null,
    })
    .single<{ message_id: string; conversation_id: string; organization_id: string; inserted: boolean }>();
  if (error) {
    if (error.code === "P0002") return;
    throw error;
  }

  if (profile?.username || profile?.avatar) {
    await admin
      .from("contacts")
      .update({ username: profile.username, avatar_url: profile.avatar })
      .eq("organization_id", channel.organization_id)
      .eq("wa_id", key);
  }
  if (row.inserted && described.mediaUrl) await storeMedia(admin, row, described.mid, described.mediaUrl);
  if (row.inserted && !echo) {
    await triggerAutoReply(admin, row.conversation_id).catch((err) => console.error("ai trigger failed", err));
  }
}

// Turns a Messenger / Instagram event into our message type, text and media link.
function describe(event: Raw): {
  mid: string;
  type: string;
  body: string | null;
  mediaUrl: string | null;
  metadata: Record<string, unknown>;
} | null {
  if (event.postback) {
    return {
      mid: event.postback.mid ?? `postback-${event.timestamp}-${event.sender?.id}`,
      type: "button",
      body: event.postback.title ?? null,
      mediaUrl: null,
      metadata: { payload: event.postback.payload },
    };
  }
  const m = event.message;
  if (!m?.mid || m.is_deleted) return null;
  const attachment = m.attachments?.[0];
  if (!attachment) {
    return { mid: m.mid, type: "text", body: m.text ?? null, mediaUrl: null, metadata: m.quick_reply ? { payload: m.quick_reply.payload } : {} };
  }
  const url: string | null = attachment.payload?.url ?? null;
  const mapped = ATTACHMENT_TYPES[attachment.type];
  if (mapped) {
    return { mid: m.mid, type: mapped, body: m.text ?? null, mediaUrl: url, metadata: { attachment_type: attachment.type } };
  }
  // Shares, story mentions/replies, reels, links: keep the link as text.
  const label: Record<string, string> = {
    share: "Membagikan",
    story_mention: "Menyebut Anda di story",
    ig_reel: "Membagikan reel",
    reel: "Membagikan reel",
    template: "Pesan",
    fallback: "Tautan",
  };
  const title = attachment.payload?.title ?? "";
  return {
    mid: m.mid,
    type: "text",
    body: [m.text, `${label[attachment.type] ?? `[${attachment.type}]`}${title ? `: ${title}` : ""}`, url].filter(Boolean).join("\n"),
    mediaUrl: null,
    metadata: { attachment_type: attachment.type },
  };
}

// Copies media into our own storage: Meta's attachment links expire.
async function storeMedia(
  admin: SupabaseClient,
  row: { message_id: string; conversation_id: string; organization_id: string },
  mid: string,
  url: string,
) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed with ${res.status}`);
    const mimeType = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
    const bytes = new Uint8Array(await res.arrayBuffer());
    const safeId = mid.replace(/[^A-Za-z0-9_-]/g, "").slice(-60);
    const path = `${row.organization_id}/${row.conversation_id}/${safeId}.${extensionFor(mimeType)}`;
    const upload = await admin.storage.from("media").upload(path, bytes, { contentType: mimeType, upsert: true });
    if (upload.error) throw upload.error;
    await admin.from("messages").update({ media_path: path, media_mime: mimeType }).eq("id", row.message_id);
  } catch (err) {
    console.error(`could not store media of ${mid}`, err);
  }
}

async function markRead(admin: SupabaseClient, channel: Channel, key: string, watermark: number | undefined) {
  if (!watermark) return;
  const { data: conv } = await admin
    .from("conversations")
    .select("id, contacts!inner(wa_id)")
    .eq("channel_id", channel.id)
    .eq("contacts.wa_id", key)
    .maybeSingle();
  if (!conv) return;
  await admin
    .from("messages")
    .update({ status: "read" })
    .eq("conversation_id", conv.id)
    .eq("direction", "outbound")
    .in("status", ["sent", "delivered"])
    .lte("created_at", new Date(Number(watermark)).toISOString());
}
