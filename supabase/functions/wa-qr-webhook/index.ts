// Receives events from the Evolution API gateway for QR-linked numbers:
// messages (from customers, and ones typed on the linked phone), delivery
// statuses and connection changes. Authenticated with the x-balas-token header.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { adminClient } from "../_shared/supabase.ts";
import { extensionFor } from "../_shared/whatsapp.ts";
import { downloadMedia, isValidToken, mapState } from "../_shared/evolution.ts";
import { triggerAutoReply } from "../_shared/ai.ts";

// Baileys message payloads vary by message type; fields are read defensively below.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

interface Channel {
  id: string;
  instance_name: string;
}

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"];
const STATUS_MAP: Record<string, string> = {
  SERVER_ACK: "sent",
  DELIVERY_ACK: "delivered",
  READ: "read",
  PLAYED: "read",
  ERROR: "failed",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!isValidToken(req.headers.get("x-balas-token"))) {
    return new Response("Forbidden", { status: 403 });
  }

  let payload: { event?: string; instance?: string; data?: Raw };
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const admin = adminClient();
  try {
    const { data: channel, error } = await admin
      .from("channels")
      .select("id, instance_name")
      .eq("instance_name", payload.instance ?? "")
      .maybeSingle<Channel>();
    if (error) throw error;
    if (!channel) {
      console.warn(`ignoring event for unknown instance ${payload.instance}`);
      return new Response("OK", { status: 200 });
    }

    const data = payload.data ?? {};
    switch (payload.event) {
      case "messages.upsert":
        await handleMessage(admin, channel, data);
        break;
      case "messages.update":
        await handleStatus(admin, data);
        break;
      case "connection.update":
        await handleConnection(admin, channel, data);
        break;
    }
  } catch (err) {
    // A non-2xx makes the gateway retry; ingestion is idempotent so retries are safe.
    console.error("qr webhook processing failed", err);
    return new Response("Temporary failure", { status: 500 });
  }
  return new Response("OK", { status: 200 });
});

// 628123@s.whatsapp.net -> 628123. Linked ids (…@lid) stay whole: they are not phone numbers.
function waIdFromJid(jid: string): string | null {
  const [user, server] = jid.split("@");
  if (!user || !server) return null;
  if (server === "s.whatsapp.net" || server === "c.us") return user.split(":")[0];
  if (server === "lid") return `${user.split(":")[0]}@lid`;
  return null; // groups, broadcasts, newsletters
}

async function handleMessage(admin: SupabaseClient, channel: Channel, data: Raw) {
  const key = data.key ?? {};
  const jid: string = key.remoteJid?.includes("@lid") && key.remoteJidAlt ? key.remoteJidAlt : key.remoteJid ?? "";
  const waId = waIdFromJid(jid);
  if (!waId || !key.id) return;

  const described = describe(data.messageType, data.message ?? {});
  if (!described) return;

  const fromMe = key.fromMe === true;
  const { data: row, error } = await admin
    .rpc("ingest_channel_message", {
      p_channel_id: channel.id,
      p_direction: fromMe ? "outbound" : "inbound",
      p_wa_id: waId,
      p_profile_name: fromMe ? null : data.pushName ?? null,
      p_wa_message_id: key.id,
      p_type: described.type,
      p_body: described.body,
      p_reply_to_wa_id: data.contextInfo?.stanzaId ?? null,
      p_metadata: { ...described.metadata, source: "qr", ...(fromMe ? { sent_from_phone: true } : {}) },
      p_sent_at: data.messageTimestamp ? new Date(Number(data.messageTimestamp) * 1000).toISOString() : null,
    })
    .single<{ message_id: string; conversation_id: string; organization_id: string; inserted: boolean }>();
  if (error) {
    if (error.code === "P0002") return; // channel switched off
    throw error;
  }

  if (row.inserted && MEDIA_TYPES.includes(described.type)) {
    await storeMedia(admin, channel, row, key.id, described.metadata.filename as string | undefined);
  }
  if (row.inserted && !fromMe) {
    await triggerAutoReply(admin, row.conversation_id).catch((err) => console.error("ai trigger failed", err));
  }
}

// Copies media into our own storage; the gateway only keeps the encrypted reference.
async function storeMedia(
  admin: SupabaseClient,
  channel: Channel,
  row: { message_id: string; conversation_id: string; organization_id: string },
  messageId: string,
  filename: string | undefined,
) {
  try {
    const media = await downloadMedia(channel.instance_name, messageId);
    const path = `${row.organization_id}/${row.conversation_id}/${messageId}.${extensionFor(media.mimeType)}`;
    const upload = await admin.storage.from("media").upload(path, media.bytes, {
      contentType: media.mimeType,
      upsert: true,
    });
    if (upload.error) throw upload.error;
    await admin
      .from("messages")
      .update({ media_path: path, media_mime: media.mimeType, media_filename: filename ?? media.fileName })
      .eq("id", row.message_id);
  } catch (err) {
    // The message is kept and shows "media belum tersedia".
    console.error(`could not store media of ${messageId}`, err);
  }
}

async function handleStatus(admin: SupabaseClient, data: Raw) {
  const updates = Array.isArray(data) ? data : [data];
  for (const update of updates) {
    const mapped = STATUS_MAP[update.status];
    const id = update.keyId ?? update.key?.id;
    if (!mapped || !id || update.fromMe === false) continue;
    const { error } = await admin.rpc("apply_message_status", {
      p_wa_message_id: id,
      p_status: mapped,
      p_error: mapped === "failed" ? { message: "WhatsApp gagal mengirim pesan" } : null,
    });
    if (error) throw error;
  }
}

async function handleConnection(admin: SupabaseClient, channel: Channel, data: Raw) {
  // The gateway reports "connecting" on every reconnect attempt, and such an
  // event can arrive after a logout. Only final states count here; the
  // "connecting" state is set by the wa-qr function when an admin starts linking.
  if (data.state === "connecting") return;
  const status = mapState(data.state);
  const owner = typeof data.wuid === "string" ? data.wuid.split("@")[0] : null;
  const { error } = await admin.rpc("set_channel_connection", {
    p_instance_name: channel.instance_name,
    p_status: status,
    p_display_phone: status === "connected" && owner ? `+${owner}` : null,
  });
  if (error) throw error;
}

// Turns a Baileys message into our message type, display text and the details worth keeping.
function describe(
  messageType: string | undefined,
  message: Raw,
): { type: string; body: string | null; metadata: Record<string, unknown> } | null {
  switch (messageType) {
    case "conversation":
    case "extendedTextMessage":
      return { type: "text", body: message.conversation ?? message.extendedTextMessage?.text ?? null, metadata: {} };
    case "imageMessage":
    case "videoMessage":
    case "audioMessage":
    case "documentMessage":
    case "stickerMessage":
    case "ptvMessage": {
      const media = message[messageType] ?? {};
      const type = messageType === "ptvMessage" ? "video" : messageType.replace("Message", "");
      return {
        type,
        body: media.caption ?? null,
        metadata: { mime_type: media.mimetype, filename: media.fileName ?? undefined },
      };
    }
    case "locationMessage":
    case "liveLocationMessage": {
      const loc = message[messageType] ?? {};
      const label = [loc.name, loc.address].filter(Boolean).join(", ");
      return {
        type: "location",
        body: `Lokasi: ${label ? `${label} ` : ""}(${loc.degreesLatitude}, ${loc.degreesLongitude})`,
        metadata: { location: { latitude: loc.degreesLatitude, longitude: loc.degreesLongitude, name: loc.name, address: loc.address } },
      };
    }
    case "contactMessage":
      return { type: "contacts", body: `Kontak: ${message.contactMessage?.displayName ?? ""}`, metadata: {} };
    case "contactsArrayMessage": {
      const names = (message.contactsArrayMessage?.contacts ?? []).map((c: Raw) => c.displayName).filter(Boolean);
      return { type: "contacts", body: `Kontak: ${names.join(", ")}`, metadata: {} };
    }
    case "reactionMessage":
      if (!message.reactionMessage?.text) return null; // reaction removed
      return {
        type: "reaction",
        body: message.reactionMessage.text,
        metadata: { reaction_to: message.reactionMessage.key?.id },
      };
    case "buttonsResponseMessage":
      return { type: "button", body: message.buttonsResponseMessage?.selectedDisplayText ?? null, metadata: {} };
    case "templateButtonReplyMessage":
      return { type: "button", body: message.templateButtonReplyMessage?.selectedDisplayText ?? null, metadata: {} };
    case "listResponseMessage":
      return { type: "interactive", body: message.listResponseMessage?.title ?? null, metadata: {} };
    case "protocolMessage":
    case "senderKeyDistributionMessage":
    case "messageContextInfo":
    case undefined:
      return null; // deletes, edits, key exchanges: nothing to show
    default:
      return { type: "unknown", body: null, metadata: { unsupported: messageType } };
  }
}
