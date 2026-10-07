// Sends a message to the customer of a conversation and records it. Used by
// agents (send-message) and by the AI agent (sender null).
// Cloud API numbers go through Meta; QR-linked numbers through the Evolution gateway.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";
import { sendMessage, uploadMedia } from "./whatsapp.ts";
import * as evolution from "./evolution.ts";
import { decryptSecret } from "./crypto.ts";
import { sendSocial, type SocialAttachment, userIdFromKey } from "./meta.ts";
import * as telegram from "./telegram.ts";

export type MediaType = "image" | "video" | "audio" | "document";

export interface SendInput {
  type: "text" | MediaType | "template";
  text?: string;
  media_path?: string;
  filename?: string;
  reply_to_wa_id?: string;
  template?: { name: string; language: string; parameters?: string[] };
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
// Messenger / Instagram: replies up to 7 days after the customer's last message
// with the HUMAN_AGENT tag.
const HUMAN_AGENT_WINDOW_MS = 7 * WINDOW_MS;
const MEDIA_TYPES: MediaType[] = ["image", "video", "audio", "document"];

export async function sendToConversation(
  admin: SupabaseClient,
  conversationId: string,
  input: SendInput,
  senderId: string | null,
  extraMetadata: Record<string, unknown> = {},
) {
  const { data: conv, error } = await admin
    .from("conversations")
    .select("id, organization_id, last_customer_message_at, contacts(wa_id), channels(id, provider, phone_number_id, instance_name, page_id, is_active)")
    .eq("id", conversationId)
    .single<{
      id: string;
      organization_id: string;
      last_customer_message_at: string | null;
      contacts: { wa_id: string };
      channels: {
        id: string;
        provider: "cloud_api" | "qr" | "messenger" | "instagram" | "telegram" | "webchat";
        phone_number_id: string | null;
        instance_name: string | null;
        page_id: string | null;
        is_active: boolean;
      };
    }>();
  if (error) throw error;
  if (!conv.channels.is_active) throw new HttpError(409, "This WhatsApp number is disabled", "channel_inactive");
  if (conv.channels.provider === "messenger" || conv.channels.provider === "instagram") {
    return await sendSocialMessage(admin, conv, input, senderId, extraMetadata);
  }
  if (conv.channels.provider === "telegram" || conv.channels.provider === "webchat") {
    return await sendDirectMessage(admin, conv, input, senderId, extraMetadata);
  }

  // The 24-hour customer service window and templates only exist on the Cloud API.
  const viaQr = conv.channels.provider === "qr";
  if (viaQr && input.type === "template") {
    throw new HttpError(400, "Template hanya untuk nomor WhatsApp API resmi", "invalid_request");
  }
  const windowOpen = conv.last_customer_message_at !== null &&
    Date.now() - new Date(conv.last_customer_message_at).getTime() < WINDOW_MS;
  if (!viaQr && input.type !== "template" && !windowOpen) {
    throw new HttpError(
      422,
      "Lebih dari 24 jam sejak pesan terakhir pelanggan. Gunakan template pesan.",
      "window_closed",
    );
  }

  const phoneNumberId = conv.channels.phone_number_id ?? "";
  const payload: Record<string, unknown> = { to: conv.contacts.wa_id };
  if (input.reply_to_wa_id) payload.context = { message_id: input.reply_to_wa_id };

  let body: string | null = null;
  let media: { path: string; mime: string; filename: string } | null = null;
  let metadata: Record<string, unknown> = {};
  const instance = conv.channels.instance_name ?? "";
  let qrSend: (() => Promise<evolution.SentMessage>) | null = null;

  if (input.type === "text") {
    body = input.text?.trim() ?? "";
    if (!body) throw new HttpError(400, "Message text is empty", "invalid_request");
    if (body.length > 4096) throw new HttpError(400, "Message is longer than 4096 characters", "invalid_request");
    payload.type = "text";
    payload.text = { body, preview_url: true };
    const text = body;
    if (viaQr) qrSend = () => evolution.sendText(instance, conv.contacts.wa_id, text, input.reply_to_wa_id);
  } else if (MEDIA_TYPES.includes(input.type as MediaType)) {
    const path = input.media_path ?? "";
    if (!path.startsWith(`${conv.organization_id}/outbound/`)) {
      throw new HttpError(400, "media_path must be an uploaded outbound file", "invalid_request");
    }
    const file = await admin.storage.from("media").download(path);
    if (file.error) throw new HttpError(400, "Uploaded file not found", "invalid_request");
    const filename = input.filename || path.split("/").pop()!;
    const mime = file.data.type || "application/octet-stream";
    body = input.text?.trim() || null;
    media = { path, mime, filename };

    if (viaQr) {
      const base64 = evolution.toBase64(new Uint8Array(await file.data.arrayBuffer()));
      const type = input.type as MediaType;
      const caption = body;
      qrSend = () =>
        evolution.sendMedia(instance, conv.contacts.wa_id, { type, base64, mime, filename, caption }, input.reply_to_wa_id);
    } else {
      const mediaId = await uploadMedia(phoneNumberId, file.data, mime, filename);
      const content: Record<string, unknown> = { id: mediaId };
      if (body && input.type !== "audio") content.caption = body;
      if (input.type === "document") content.filename = filename;
      payload.type = input.type;
      payload[input.type] = content;
    }
  } else if (input.type === "template") {
    const tpl = input.template;
    if (!tpl?.name || !tpl.language) throw new HttpError(400, "template name and language are required", "invalid_request");
    const { data: stored } = await admin
      .from("templates")
      .select("components, status")
      .eq("organization_id", conv.organization_id)
      .eq("name", tpl.name)
      .eq("language", tpl.language)
      .maybeSingle();
    if (!stored) throw new HttpError(404, "Template not found. Sync templates first.", "template_not_found");
    if (stored.status && stored.status !== "APPROVED") {
      throw new HttpError(422, `Template status is ${stored.status}`, "template_not_approved");
    }
    const params = tpl.parameters ?? [];
    payload.type = "template";
    payload.template = {
      name: tpl.name,
      language: { code: tpl.language },
      components: params.length
        ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
        : [],
    };
    body = renderTemplate(stored.components, params) ?? `[Template ${tpl.name}]`;
    metadata = { template: { name: tpl.name, language: tpl.language, parameters: params } };
  } else {
    throw new HttpError(400, "Unsupported message type", "invalid_request");
  }

  const waMessageId = qrSend ? (await qrSend()).key.id : await sendMessage(phoneNumberId, payload);

  const { data: message, error: recordError } = await admin.rpc("record_outbound_message", {
    p_conversation_id: conv.id,
    p_sender_id: senderId,
    p_wa_message_id: waMessageId,
    p_type: input.type,
    p_body: body,
    p_media_path: media?.path ?? null,
    p_media_mime: media?.mime ?? null,
    p_media_filename: media?.filename ?? null,
    p_reply_to_wa_id: input.reply_to_wa_id ?? null,
    p_metadata: { ...metadata, ...extraMetadata },
  });

  return message;
}

// Short-lived link to a stored file that works from outside the server
// (Meta's servers, website visitors).
export async function publicSignedUrl(admin: SupabaseClient, path: string, seconds = 3600): Promise<string> {
  const signed = await admin.storage.from("media").createSignedUrl(path, seconds);
  if (signed.error) throw signed.error;
  const publicBase = (Deno.env.get("PUBLIC_API_URL") ?? "").replace(/\/$/, "");
  const internalBase = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  return publicBase && signed.data.signedUrl.startsWith(internalBase)
    ? publicBase + signed.data.signedUrl.slice(internalBase.length)
    : signed.data.signedUrl;
}

interface SocialConversation {
  id: string;
  organization_id: string;
  last_customer_message_at: string | null;
  contacts: { wa_id: string };
  channels: { id: string; provider: string };
}

const SOCIAL_ATTACHMENT: Record<MediaType, SocialAttachment> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "file",
};

async function record(
  admin: SupabaseClient,
  conversationId: string,
  senderId: string | null,
  mid: string,
  type: string,
  body: string | null,
  media: { path: string; mime: string; filename: string } | null,
  metadata: Record<string, unknown>,
) {
  const { data, error } = await admin.rpc("record_outbound_message", {
    p_conversation_id: conversationId,
    p_sender_id: senderId,
    p_wa_message_id: mid,
    p_type: type,
    p_body: body,
    p_media_path: media?.path ?? null,
    p_media_mime: media?.mime ?? null,
    p_media_filename: media?.filename ?? null,
    p_reply_to_wa_id: null,
    p_metadata: metadata,
  });
  if (error) throw error;
  return data;
}

// Messenger and Instagram: plain text or one attachment per message; a caption
// goes out as its own text message first.
async function sendSocialMessage(
  admin: SupabaseClient,
  conv: SocialConversation,
  input: SendInput,
  senderId: string | null,
  extraMetadata: Record<string, unknown>,
) {
  if (input.type === "template") throw new HttpError(400, "Template hanya untuk WhatsApp API resmi", "invalid_request");
  const since = conv.last_customer_message_at ? Date.now() - new Date(conv.last_customer_message_at).getTime() : Infinity;
  if (since >= HUMAN_AGENT_WINDOW_MS) {
    throw new HttpError(422, "Lebih dari 7 hari sejak pesan terakhir pelanggan. Meta tidak mengizinkan membalas lagi.", "window_closed");
  }
  const tag = since >= WINDOW_MS ? "HUMAN_AGENT" as const : undefined;
  const metadata = { ...extraMetadata, ...(tag ? { tag } : {}) };

  const { data: secret } = await admin
    .from("channel_secrets")
    .select("access_token_encrypted")
    .eq("channel_id", conv.channels.id)
    .maybeSingle();
  if (!secret) throw new HttpError(409, "Akun belum terhubung. Hubungkan ulang Facebook/Instagram di Pengaturan.", "channel_inactive");
  const token = await decryptSecret(secret.access_token_encrypted);
  const recipient = userIdFromKey(conv.contacts.wa_id);

  if (input.type === "text") {
    const text = input.text?.trim() ?? "";
    if (!text) throw new HttpError(400, "Message text is empty", "invalid_request");
    if (text.length > 2000) throw new HttpError(400, "Pesan Messenger/Instagram maksimal 2000 karakter", "invalid_request");
    const mid = await sendSocial(token, recipient, { text }, tag);
    return await record(admin, conv.id, senderId, mid, "text", text, null, metadata);
  }

  if (!MEDIA_TYPES.includes(input.type as MediaType)) throw new HttpError(400, "Unsupported message type", "invalid_request");
  const path = input.media_path ?? "";
  if (!path.startsWith(`${conv.organization_id}/outbound/`)) {
    throw new HttpError(400, "media_path must be an uploaded outbound file", "invalid_request");
  }
  const file = await admin.storage.from("media").download(path);
  if (file.error) throw new HttpError(400, "Uploaded file not found", "invalid_request");
  // Meta fetches the file itself: a short-lived signed link on the public API address.
  const url = await publicSignedUrl(admin, path);

  const caption = input.text?.trim();
  if (caption) {
    const textMid = await sendSocial(token, recipient, { text: caption.slice(0, 2000) }, tag);
    await record(admin, conv.id, senderId, textMid, "text", caption, null, metadata);
  }
  const media = { path, mime: file.data.type || "application/octet-stream", filename: input.filename || path.split("/").pop()! };
  const mid = await sendSocial(token, recipient, { attachment: { type: SOCIAL_ATTACHMENT[input.type as MediaType], url } }, tag);
  return await record(admin, conv.id, senderId, mid, input.type, null, media, metadata);
}

// Telegram bots and the website widget: no reply window, no templates.
// Telegram gets the message through the Bot API; the widget picks it up by polling.
async function sendDirectMessage(
  admin: SupabaseClient,
  conv: SocialConversation,
  input: SendInput,
  senderId: string | null,
  metadata: Record<string, unknown>,
) {
  if (input.type === "template") throw new HttpError(400, "Template hanya untuk WhatsApp API resmi", "invalid_request");
  const viaTelegram = conv.channels.provider === "telegram";
  let token = "";
  if (viaTelegram) {
    const { data: secret } = await admin
      .from("channel_secrets")
      .select("access_token_encrypted")
      .eq("channel_id", conv.channels.id)
      .maybeSingle();
    if (!secret?.access_token_encrypted) {
      throw new HttpError(409, "Bot Telegram belum terhubung. Hubungkan ulang di Pengaturan.", "channel_inactive");
    }
    token = await decryptSecret(secret.access_token_encrypted);
  }
  const chatId = conv.contacts.wa_id.replace(/^tg:/, "");

  if (input.type === "text") {
    const text = input.text?.trim() ?? "";
    if (!text) throw new HttpError(400, "Message text is empty", "invalid_request");
    if (text.length > 4096) throw new HttpError(400, "Message is longer than 4096 characters", "invalid_request");
    const id = viaTelegram
      ? telegram.telegramMessageId(chatId, await telegram.sendText(token, chatId, text))
      : `web:${crypto.randomUUID()}`;
    return await record(admin, conv.id, senderId, id, "text", text, null, metadata);
  }

  if (!MEDIA_TYPES.includes(input.type as MediaType)) throw new HttpError(400, "Unsupported message type", "invalid_request");
  const path = input.media_path ?? "";
  if (!path.startsWith(`${conv.organization_id}/outbound/`)) {
    throw new HttpError(400, "media_path must be an uploaded outbound file", "invalid_request");
  }
  const file = await admin.storage.from("media").download(path);
  if (file.error) throw new HttpError(400, "Uploaded file not found", "invalid_request");
  const media = { path, mime: file.data.type || "application/octet-stream", filename: input.filename || path.split("/").pop()! };
  const caption = input.text?.trim() || null;
  const id = viaTelegram
    ? telegram.telegramMessageId(
      chatId,
      await telegram.sendFile(token, chatId, input.type as MediaType, file.data, media.filename, caption),
    )
    : `web:${crypto.randomUUID()}`;
  return await record(admin, conv.id, senderId, id, input.type, caption, media, metadata);
}

// Fills {{1}}, {{2}}, ... in the template's BODY text so the inbox shows what was sent.
function renderTemplate(components: unknown, params: string[]): string | null {
  if (!Array.isArray(components)) return null;
  const bodyPart = components.find((c) => (c as { type?: string }).type === "BODY") as
    | { text?: string }
    | undefined;
  if (!bodyPart?.text) return null;
  return bodyPart.text.replace(/\{\{(\d+)\}\}/g, (match, n) => params[Number(n) - 1] ?? match);
}
