// Sends an agent's reply to the customer and records it in the conversation.
// Cloud API numbers go through Meta; QR-linked numbers through the Evolution gateway.
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, callerClient, requireMember } from "../_shared/supabase.ts";
import { sendMessage, uploadMedia } from "../_shared/whatsapp.ts";
import * as evolution from "../_shared/evolution.ts";

type MediaType = "image" | "video" | "audio" | "document";

interface SendRequest {
  conversation_id: string;
  type: "text" | MediaType | "template";
  text?: string;
  media_path?: string;
  filename?: string;
  reply_to_wa_id?: string;
  template?: { name: string; language: string; parameters?: string[] };
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MEDIA_TYPES: MediaType[] = ["image", "video", "audio", "document"];

serveJson(async (req) => {
  const admin = adminClient();
  const member = await requireMember(req, admin);
  const input = await readJson<SendRequest>(req);

  if (!input.conversation_id) throw new HttpError(400, "conversation_id is required", "invalid_request");

  // Same access rule the inbox uses, evaluated as the caller.
  const { data: allowed, error: accessError } = await callerClient(req).rpc("can_access_conversation", {
    conv_id: input.conversation_id,
  });
  if (accessError) throw accessError;
  if (!allowed) throw new HttpError(404, "Conversation not found", "not_found");

  const { data: conv, error } = await admin
    .from("conversations")
    .select("id, organization_id, last_customer_message_at, contacts(wa_id), channels(provider, phone_number_id, instance_name, is_active)")
    .eq("id", input.conversation_id)
    .single<{
      id: string;
      organization_id: string;
      last_customer_message_at: string | null;
      contacts: { wa_id: string };
      channels: { provider: "cloud_api" | "qr"; phone_number_id: string | null; instance_name: string | null; is_active: boolean };
    }>();
  if (error) throw error;
  if (!conv.channels.is_active) throw new HttpError(409, "This WhatsApp number is disabled", "channel_inactive");

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
    p_sender_id: member.id,
    p_wa_message_id: waMessageId,
    p_type: input.type,
    p_body: body,
    p_media_path: media?.path ?? null,
    p_media_mime: media?.mime ?? null,
    p_media_filename: media?.filename ?? null,
    p_reply_to_wa_id: input.reply_to_wa_id ?? null,
    p_metadata: metadata,
  });
  if (recordError) throw recordError;

  return json({ message });
});

// Fills {{1}}, {{2}}, ... in the template's BODY text so the inbox shows what was sent.
function renderTemplate(components: unknown, params: string[]): string | null {
  if (!Array.isArray(components)) return null;
  const bodyPart = components.find((c) => (c as { type?: string }).type === "BODY") as
    | { text?: string }
    | undefined;
  if (!bodyPart?.text) return null;
  return bodyPart.text.replace(/\{\{(\d+)\}\}/g, (match, n) => params[Number(n) - 1] ?? match);
}
