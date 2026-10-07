// Public endpoint for the website live chat widget (public/widget.js).
//  config - title, greeting and color of a widget
//  start  - registers a visitor; returns its id and a secret the browser keeps
//  send   - a visitor message (goes to the inbox; may start the AI)
//  poll   - messages of the visitor's chat after a given time
// No Supabase session: visitors prove who they are with their secret.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { adminClient } from "../_shared/supabase.ts";
import { triggerAutoReply } from "../_shared/ai.ts";
import { publicSignedUrl } from "../_shared/send.ts";

interface Channel {
  id: string;
  organization_id: string;
  name: string;
  config: {
    title?: string;
    greeting?: string;
    color?: string;
    allowed_origins?: string[];
    ask_name?: boolean;
    position?: "right" | "left";
    button_label?: string;
  };
}

interface Visitor {
  id: string;
  contact_id: string;
}

const MAX_TEXT = 2000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;

class WidgetError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function originAllowed(channel: Channel, origin: string | null): boolean {
  const allowed = (channel.config.allowed_origins ?? []).map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
  if (!allowed.length) return true;
  return !!origin && allowed.includes(origin.replace(/\/$/, ""));
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const cors = {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);

  const admin = adminClient();
  try {
    const input = await req.json().catch(() => {
      throw new WidgetError(400, "Body must be JSON");
    });
    const { data: channel } = await admin
      .from("channels")
      .select("id, organization_id, name, config")
      .eq("provider", "webchat")
      .eq("external_id", String(input.key ?? ""))
      .eq("is_active", true)
      .maybeSingle<Channel>();
    if (!channel) throw new WidgetError(404, "Widget tidak ditemukan");
    if (!originAllowed(channel, origin)) throw new WidgetError(403, "Situs ini tidak diizinkan memakai widget");

    switch (input.action) {
      case "config":
        return reply({
          title: channel.config.title || channel.name,
          greeting: channel.config.greeting || "Halo! Ada yang bisa kami bantu?",
          color: channel.config.color || "#2563eb",
          ask_name: channel.config.ask_name !== false,
          position: channel.config.position === "left" ? "left" : "right",
          button_label: channel.config.button_label ?? "Chat dengan kami",
        });
      case "start":
        return reply(await start(admin, channel, input, req));
      case "send":
        return reply(await send(admin, channel, input));
      case "poll":
        return reply(await poll(admin, channel, input));
      default:
        throw new WidgetError(400, "Unknown action");
    }
  } catch (err) {
    if (err instanceof WidgetError) return reply({ error: err.message }, err.status);
    console.error("webchat failed", err);
    return reply({ error: "Terjadi gangguan, coba lagi." }, 500);
  }
});

async function start(
  admin: SupabaseClient,
  channel: Channel,
  input: { name?: string; contact?: string; page_url?: string },
  req: Request,
) {
  const visitorId = crypto.randomUUID();
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  const name = input.name?.trim().slice(0, 80) || null;
  const contact = input.contact?.trim().slice(0, 120) || null;
  const email = contact && contact.includes("@") ? contact : null;
  const phone = contact && !email ? contact.replace(/[^\d+]/g, "") : null;

  const { data: row, error } = await admin
    .from("contacts")
    .insert({
      organization_id: channel.organization_id,
      wa_id: `web:${visitorId}`,
      profile_name: name ?? "Pengunjung website",
      email,
      notes: phone ? `No. HP/WhatsApp dari live chat: ${phone}` : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { error: vErr } = await admin.from("webchat_visitors").insert({
    id: visitorId,
    channel_id: channel.id,
    contact_id: row.id,
    secret_hash: await sha256(secret),
    page_url: input.page_url?.slice(0, 500) ?? null,
    user_agent: req.headers.get("User-Agent")?.slice(0, 300) ?? null,
  });
  if (vErr) throw vErr;
  return { visitor_id: visitorId, secret };
}

async function visitor(admin: SupabaseClient, channel: Channel, input: { visitor_id?: string; secret?: string }): Promise<Visitor> {
  const id = String(input.visitor_id ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id) || !input.secret) throw new WidgetError(401, "Sesi chat tidak valid");
  const { data } = await admin
    .from("webchat_visitors")
    .select("id, contact_id, secret_hash")
    .eq("id", id)
    .eq("channel_id", channel.id)
    .maybeSingle();
  if (!data || data.secret_hash !== (await sha256(input.secret))) throw new WidgetError(401, "Sesi chat tidak valid");
  return data;
}

async function send(admin: SupabaseClient, channel: Channel, input: { visitor_id?: string; secret?: string; text?: string }) {
  const v = await visitor(admin, channel, input);
  const text = input.text?.trim() ?? "";
  if (!text) throw new WidgetError(400, "Pesan kosong");
  if (text.length > MAX_TEXT) throw new WidgetError(400, `Pesan maksimal ${MAX_TEXT} karakter`);

  // Simple flood guard per visitor.
  const { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("channel_id", channel.id)
    .eq("contact_id", v.contact_id)
    .maybeSingle();
  if (conv) {
    const { count } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conv.id)
      .eq("direction", "inbound")
      .gte("created_at", new Date(Date.now() - RATE_WINDOW_MS).toISOString());
    if ((count ?? 0) >= RATE_LIMIT) throw new WidgetError(429, "Terlalu banyak pesan, tunggu sebentar.");
  }

  const { data: contact } = await admin.from("contacts").select("wa_id, profile_name").eq("id", v.contact_id).single();
  const { data: row, error } = await admin
    .rpc("ingest_channel_message", {
      p_channel_id: channel.id,
      p_direction: "inbound",
      p_wa_id: contact!.wa_id,
      p_profile_name: contact!.profile_name,
      p_wa_message_id: `web:${crypto.randomUUID()}`,
      p_type: "text",
      p_body: text,
      p_reply_to_wa_id: null,
      p_metadata: { source: "webchat" },
      p_sent_at: null,
    })
    .single<{ message_id: string; conversation_id: string; inserted: boolean }>();
  if (error) throw error;
  await admin.from("webchat_visitors").update({ last_seen_at: new Date().toISOString() }).eq("id", v.id);
  await triggerAutoReply(admin, row.conversation_id).catch((err) => console.error("ai trigger failed", err));
  return { id: row.message_id };
}

async function poll(
  admin: SupabaseClient,
  channel: Channel,
  input: { visitor_id?: string; secret?: string; after?: string; open?: boolean },
) {
  const v = await visitor(admin, channel, input);
  await admin.from("webchat_visitors").update({ last_seen_at: new Date().toISOString() }).eq("id", v.id);
  const { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("channel_id", channel.id)
    .eq("contact_id", v.contact_id)
    .maybeSingle();
  if (!conv) return { messages: [] };

  let query = admin
    .from("messages")
    .select("id, direction, type, body, media_path, media_filename, metadata, sender_id, status, created_at")
    .eq("conversation_id", conv.id)
    .order("created_at")
    .limit(100);
  const after = input.after && !Number.isNaN(Date.parse(input.after)) ? input.after : null;
  if (after) query = query.gt("created_at", after);
  const { data, error } = await query;
  if (error) throw error;

  // Agent names are shown by first name only.
  const senderIds = [...new Set((data ?? []).map((m) => m.sender_id).filter(Boolean))];
  const { data: senders } = senderIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", senderIds)
    : { data: [] };
  const firstName = new Map((senders ?? []).map((p) => [p.id, (p.full_name ?? "CS").split(" ")[0]]));

  const messages = [];
  for (const m of data ?? []) {
    const meta = (m.metadata ?? {}) as { ai?: boolean; bot_name?: string };
    messages.push({
      id: m.id,
      from: m.direction === "inbound" ? "visitor" : "agent",
      name: m.direction === "inbound" ? null : meta.ai ? meta.bot_name ?? "Asisten" : firstName.get(m.sender_id) ?? "CS",
      type: m.type,
      text: m.body,
      file_url: m.media_path ? await publicSignedUrl(admin, m.media_path) : null,
      file_name: m.media_filename,
      created_at: m.created_at,
    });
  }

  // Replies the visitor has now received (or seen, with the window open).
  const unread = (data ?? []).filter((m) => m.direction === "outbound" && (m.status === "sent" || (input.open && m.status === "delivered")));
  if (unread.length) {
    await admin
      .from("messages")
      .update({ status: input.open ? "read" : "delivered" })
      .in("id", unread.map((m) => m.id));
  }
  return { messages };
}
