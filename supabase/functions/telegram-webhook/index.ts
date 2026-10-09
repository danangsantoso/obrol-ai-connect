// Receives messages sent to a Telegram bot channel. Telegram calls
// /telegram-webhook?channel=<id> with the secret set by telegram-connect.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { adminClient } from "../_shared/supabase.ts";
import { extensionFor } from "../_shared/whatsapp.ts";
import { decryptSecret } from "../_shared/crypto.ts";
import { downloadFile, telegramKey, telegramMessageId } from "../_shared/telegram.ts";
import { triggerAutoReply } from "../_shared/ai.ts";
import { reportError } from "../_shared/http.ts";

// Telegram message objects vary by content type; fields are read defensively below.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  mp4: "video/mp4", oga: "audio/ogg", ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", pdf: "application/pdf",
};

function sameSecret(a: string | null, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const channelId = new URL(req.url).searchParams.get("channel") ?? "";
  const admin = adminClient();

  const { data: channel } = await admin
    .from("channels")
    .select("id, organization_id, provider, is_active")
    .eq("id", /^[0-9a-f-]{36}$/.test(channelId) ? channelId : "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  const { data: secret } = channel
    ? await admin.from("channel_secrets").select("access_token_encrypted, webhook_secret").eq("channel_id", channel.id).maybeSingle()
    : { data: null };
  if (!channel || channel.provider !== "telegram" || !secret ||
    !sameSecret(req.headers.get("X-Telegram-Bot-Api-Secret-Token"), secret.webhook_secret)) {
    return new Response("Forbidden", { status: 403 });
  }

  let update: Raw;
  try {
    update = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const message = update.message;
  // Only one-to-one chats with customers; groups and channels are ignored.
  if (!message || message.chat?.type !== "private" || !channel.is_active) return new Response("OK", { status: 200 });

  try {
    const token = await decryptSecret(secret.access_token_encrypted);
    await handleMessage(admin, channel.id, token, message);
  } catch (err) {
    // A non-2xx makes Telegram retry; ingestion is idempotent so retries are safe.
    reportError("telegram webhook processing failed", err);
    return new Response("Temporary failure", { status: 500 });
  }
  return new Response("OK", { status: 200 });
});

async function handleMessage(admin: SupabaseClient, channelId: string, token: string, message: Raw) {
  const described = describe(message);
  if (!described) return;
  const from = message.from ?? {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || null;
  const key = telegramKey(message.chat.id);

  const { data: row, error } = await admin
    .rpc("ingest_channel_message", {
      p_channel_id: channelId,
      p_direction: "inbound",
      p_wa_id: key,
      p_profile_name: name,
      p_wa_message_id: telegramMessageId(message.chat.id, message.message_id),
      p_type: described.type,
      p_body: described.body,
      p_reply_to_wa_id: message.reply_to_message ? telegramMessageId(message.chat.id, message.reply_to_message.message_id) : null,
      p_metadata: { source: "telegram", ...described.metadata },
      p_sent_at: message.date ? new Date(message.date * 1000).toISOString() : null,
    })
    .single<{ message_id: string; conversation_id: string; organization_id: string; inserted: boolean }>();
  if (error) {
    if (error.code === "P0002") return;
    throw error;
  }
  if (!row.inserted) return;

  if (from.username) {
    await admin.from("contacts").update({ username: from.username }).eq("organization_id", row.organization_id).eq("wa_id", key);
  }
  if (described.fileId) await storeMedia(admin, token, row, described.fileId, described.filename, described.mime);
  await triggerAutoReply(admin, row.conversation_id).catch((err) => reportError("ai trigger failed", err));
}

function describe(m: Raw): {
  type: string;
  body: string | null;
  fileId?: string;
  filename?: string;
  mime?: string;
  metadata: Record<string, unknown>;
} | null {
  const caption = m.caption ?? null;
  if (m.text) return { type: "text", body: m.text, metadata: {} };
  if (m.photo?.length) {
    const largest = m.photo[m.photo.length - 1];
    return { type: "image", body: caption, fileId: largest.file_id, mime: "image/jpeg", metadata: {} };
  }
  if (m.document) {
    return { type: "document", body: caption, fileId: m.document.file_id, filename: m.document.file_name, mime: m.document.mime_type, metadata: {} };
  }
  if (m.video) return { type: "video", body: caption, fileId: m.video.file_id, mime: m.video.mime_type ?? "video/mp4", metadata: {} };
  if (m.voice) return { type: "audio", body: null, fileId: m.voice.file_id, mime: m.voice.mime_type ?? "audio/ogg", metadata: {} };
  if (m.audio) return { type: "audio", body: caption, fileId: m.audio.file_id, filename: m.audio.file_name, mime: m.audio.mime_type, metadata: {} };
  if (m.sticker) return { type: "sticker", body: m.sticker.emoji ?? null, fileId: m.sticker.is_animated ? undefined : m.sticker.file_id, mime: "image/webp", metadata: {} };
  if (m.location) {
    return {
      type: "location",
      body: `Lokasi: (${m.location.latitude}, ${m.location.longitude})`,
      metadata: { location: m.location },
    };
  }
  if (m.contact) {
    return {
      type: "contacts",
      body: `Kontak: ${[m.contact.first_name, m.contact.last_name].filter(Boolean).join(" ")} ${m.contact.phone_number ?? ""}`.trim(),
      metadata: {},
    };
  }
  return null;
}

async function storeMedia(
  admin: SupabaseClient,
  token: string,
  row: { message_id: string; conversation_id: string; organization_id: string },
  fileId: string,
  filename: string | undefined,
  mime: string | undefined,
) {
  try {
    const file = await downloadFile(token, fileId);
    const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = mime || MIME_BY_EXT[ext] || "application/octet-stream";
    const path = `${row.organization_id}/${row.conversation_id}/${row.message_id}.${extensionFor(mimeType) !== "bin" ? extensionFor(mimeType) : ext || "bin"}`;
    const upload = await admin.storage.from("media").upload(path, file.bytes, { contentType: mimeType, upsert: true });
    if (upload.error) throw upload.error;
    await admin.from("messages").update({ media_path: path, media_mime: mimeType, media_filename: filename ?? null }).eq("id", row.message_id);
  } catch (err) {
    reportError("could not store telegram media", err);
  }
}
