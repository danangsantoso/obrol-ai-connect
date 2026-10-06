// Receives WhatsApp Cloud API webhooks: incoming messages and delivery statuses.
//
// Env: WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_ACCESS_TOKEN
// (WHATSAPP_SKIP_SIGNATURE=true only for local testing).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { adminClient } from "../_shared/supabase.ts";
import { downloadMedia, extensionFor, isValidSignature } from "../_shared/whatsapp.ts";

// deno-lint-ignore no-explicit-any
type WaMessage = Record<string, any>;

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"];
const STATUS_MAP: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

Deno.serve(async (req) => {
  if (req.method === "GET") return verifySubscription(req);
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (secret) {
    if (!(await isValidSignature(raw, req.headers.get("X-Hub-Signature-256"), secret))) {
      return new Response("Invalid signature", { status: 401 });
    }
  } else if (Deno.env.get("WHATSAPP_SKIP_SIGNATURE") !== "true") {
    console.error("WHATSAPP_APP_SECRET is not configured; rejecting webhook");
    return new Response("Webhook not configured", { status: 500 });
  }

  let payload: { entry?: { changes?: { field: string; value: WaMessage }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const admin = adminClient();
  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        await handleChange(admin, change.value);
      }
    }
  } catch (err) {
    // A non-2xx makes Meta retry later; ingestion is idempotent so retries are safe.
    console.error("webhook processing failed", err);
    return new Response("Temporary failure", { status: 500 });
  }
  return new Response("OK", { status: 200 });
});

function verifySubscription(req: Request): Response {
  const url = new URL(req.url);
  const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
  if (
    expected &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === expected
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

async function handleChange(admin: SupabaseClient, value: WaMessage) {
  const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const names = new Map<string, string>();
  for (const c of value.contacts ?? []) names.set(c.wa_id, c.profile?.name ?? "");

  for (const message of value.messages ?? []) {
    await handleInbound(admin, phoneNumberId, message, names.get(message.from) ?? "");
  }

  for (const status of value.statuses ?? []) {
    const mapped = STATUS_MAP[status.status];
    if (!mapped) continue;
    const { error } = await admin.rpc("apply_message_status", {
      p_wa_message_id: status.id,
      p_status: mapped,
      p_error: status.errors?.[0] ?? null,
    });
    if (error) throw error;
  }
}

async function handleInbound(
  admin: SupabaseClient,
  phoneNumberId: string,
  message: WaMessage,
  profileName: string,
) {
  const { body, metadata } = describe(message);
  const { data, error } = await admin
    .rpc("ingest_inbound_message", {
      p_phone_number_id: phoneNumberId,
      p_wa_id: message.from,
      p_profile_name: profileName,
      p_wa_message_id: message.id,
      p_type: message.type ?? "unknown",
      p_body: body,
      p_reply_to_wa_id: message.context?.id ?? null,
      p_metadata: metadata,
      p_sent_at: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : null,
    })
    .single<{ message_id: string; conversation_id: string; organization_id: string; inserted: boolean }>();

  if (error) {
    if (error.code === "P0002") {
      console.warn(`ignoring message for unregistered phone_number_id ${phoneNumberId}`);
      return;
    }
    throw error;
  }

  const media = MEDIA_TYPES.includes(message.type) ? message[message.type] : null;
  if (data.inserted && media?.id) {
    await storeMedia(admin, data, message.id, media);
  }
}

// Copies inbound media into our own storage: Meta's media URLs expire.
async function storeMedia(
  admin: SupabaseClient,
  row: { message_id: string; conversation_id: string; organization_id: string },
  waMessageId: string,
  media: { id: string; mime_type?: string; filename?: string },
) {
  try {
    const { bytes, mimeType } = await downloadMedia(media.id);
    const path = `${row.organization_id}/${row.conversation_id}/${waMessageId}.${extensionFor(mimeType)}`;
    const upload = await admin.storage.from("media").upload(path, bytes, {
      contentType: mimeType,
      upsert: true,
    });
    if (upload.error) throw upload.error;
    await admin
      .from("messages")
      .update({ media_path: path, media_mime: mimeType, media_filename: media.filename ?? null })
      .eq("id", row.message_id);
  } catch (err) {
    // The message is kept; metadata.media_id allows a later retry.
    console.error(`could not store media ${media.id}`, err);
  }
}

// Turns a webhook message into display text plus the raw details worth keeping.
function describe(message: WaMessage): { body: string | null; metadata: Record<string, unknown> } {
  const type: string = message.type;
  switch (type) {
    case "text":
      return { body: message.text?.body ?? null, metadata: {} };
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker": {
      const media = message[type] ?? {};
      return {
        body: media.caption ?? null,
        metadata: { media_id: media.id, mime_type: media.mime_type, filename: media.filename },
      };
    }
    case "location": {
      const loc = message.location ?? {};
      const label = [loc.name, loc.address].filter(Boolean).join(", ");
      return {
        body: `Lokasi: ${label ? `${label} ` : ""}(${loc.latitude}, ${loc.longitude})`,
        metadata: { location: loc },
      };
    }
    case "contacts": {
      const names = (message.contacts ?? []).map((c: WaMessage) => c.name?.formatted_name).filter(Boolean);
      return { body: `Kontak: ${names.join(", ")}`, metadata: { contacts: message.contacts } };
    }
    case "reaction":
      return {
        body: message.reaction?.emoji ?? null,
        metadata: { reaction_to: message.reaction?.message_id },
      };
    case "button":
      return { body: message.button?.text ?? null, metadata: { payload: message.button?.payload } };
    case "interactive": {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      return { body: reply?.title ?? null, metadata: { interactive: message.interactive } };
    }
    default:
      return { body: null, metadata: { unsupported: message[type] ?? message.errors ?? null } };
  }
}
