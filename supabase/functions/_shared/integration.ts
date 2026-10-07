// What other systems can do with Balas.id through an API key: shared by the
// REST API (`api`) and the MCP server (`mcp`). Every operation is scoped to
// the key's organization and runs with the service role.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";
import { type MediaType, type SendInput, sendToConversation } from "./send.ts";

export interface ApiCaller {
  organizationId: string;
  keyId: string;
}

const STATUSES = ["open", "pending", "resolved"] as const;
type Status = (typeof STATUSES)[number];
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Accepts "Authorization: Bearer blsk_..." or "X-Api-Key: blsk_...".
export async function authenticateApiKey(req: Request, admin: SupabaseClient): Promise<ApiCaller> {
  const header = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const key = header.trim();
  if (!key.startsWith("blsk_")) {
    throw new HttpError(401, "Missing or invalid API key. Create one in Balas.id → Integrasi.", "unauthorized");
  }
  const { data } = await admin
    .from("api_keys")
    .select("id, organization_id, last_used_at")
    .eq("key_hash", await sha256Hex(key))
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) throw new HttpError(401, "API key is not valid or was revoked", "unauthorized");
  if (!data.last_used_at || Date.now() - new Date(data.last_used_at).getTime() > 60_000) {
    await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  }
  return { organizationId: data.organization_id, keyId: data.id };
}

// Indonesian numbers in any common format -> 628xxxxxxxxx.
export function normalizePhone(input: string): string {
  let digits = input.replace(/[^\d]/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  if (digits.length < 8 || digits.length > 15) throw new HttpError(400, "Phone number is not valid", "invalid_request");
  return digits;
}

function limitOf(value: unknown, fallback = 50, max = 200): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : fallback;
}

const CONVERSATION_FIELDS =
  "id, status, assignee_id, team_id, unread_count, last_message_at, last_message_preview, created_at, resolved_at, " +
  "contact:contacts(id, wa_id, name, profile_name, email, company, username), channel:channels(id, provider, name)";

async function ownConversation(admin: SupabaseClient, caller: ApiCaller, id: string) {
  const { data } = await admin
    .from("conversations")
    .select(CONVERSATION_FIELDS)
    .eq("id", id)
    .eq("organization_id", caller.organizationId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Conversation not found", "not_found");
  return data as unknown as Record<string, unknown>;
}

export async function listChannels(admin: SupabaseClient, caller: ApiCaller) {
  const { data, error } = await admin
    .from("channels")
    .select("id, name, provider, display_phone, external_username, connection_status, is_active, ai_enabled")
    .eq("organization_id", caller.organizationId)
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function listConversations(
  admin: SupabaseClient,
  caller: ApiCaller,
  q: { status?: string; channel_id?: string; assignee_id?: string; contact_id?: string; limit?: unknown; before?: string },
) {
  let query = admin
    .from("conversations")
    .select(CONVERSATION_FIELDS)
    .eq("organization_id", caller.organizationId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limitOf(q.limit));
  if (q.status) {
    if (!STATUSES.includes(q.status as Status)) throw new HttpError(400, "status must be open, pending or resolved", "invalid_request");
    query = query.eq("status", q.status as Status);
  }
  if (q.channel_id) query = query.eq("channel_id", q.channel_id);
  if (q.assignee_id) query = query.eq("assignee_id", q.assignee_id);
  if (q.contact_id) query = query.eq("contact_id", q.contact_id);
  if (q.before) query = query.lt("last_message_at", q.before);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export function getConversation(admin: SupabaseClient, caller: ApiCaller, id: string) {
  return ownConversation(admin, caller, id);
}

export async function updateConversation(
  admin: SupabaseClient,
  caller: ApiCaller,
  id: string,
  input: { status?: string; assignee_id?: string | null; assignee_email?: string },
) {
  const conv = await ownConversation(admin, caller, id);
  const values: Record<string, unknown> = {};
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status as Status)) throw new HttpError(400, "status must be open, pending or resolved", "invalid_request");
    values.status = input.status;
    values.resolved_at = input.status === "resolved" ? new Date().toISOString() : null;
  }
  let assignee: string | null | undefined = input.assignee_id;
  if (input.assignee_email) {
    const { data: p } = await admin
      .from("profiles")
      .select("id")
      .eq("organization_id", caller.organizationId)
      .ilike("email", input.assignee_email.trim())
      .eq("is_active", true)
      .maybeSingle();
    if (!p) throw new HttpError(404, "No active team member with that email", "not_found");
    assignee = p.id;
  } else if (assignee) {
    const { data: p } = await admin
      .from("profiles")
      .select("id")
      .eq("id", assignee)
      .eq("organization_id", caller.organizationId)
      .eq("is_active", true)
      .maybeSingle();
    if (!p) throw new HttpError(404, "No active team member with that id", "not_found");
  }
  if (assignee !== undefined) values.assignee_id = assignee;
  if (Object.keys(values).length === 0) throw new HttpError(400, "Nothing to update: send status and/or assignee", "invalid_request");

  const { error } = await admin.from("conversations").update(values).eq("id", id);
  if (error) throw error;
  if (assignee !== undefined && assignee !== conv.assignee_id) {
    await admin.from("assignment_logs").insert({
      organization_id: caller.organizationId,
      conversation_id: id,
      from_assignee_id: conv.assignee_id,
      to_assignee_id: assignee,
      from_team_id: conv.team_id,
      to_team_id: conv.team_id,
      actor_id: null,
      note: "Lewat API",
    });
  }
  return ownConversation(admin, caller, id);
}

export async function listMessages(admin: SupabaseClient, caller: ApiCaller, conversationId: string, q: { limit?: unknown; before?: string }) {
  await ownConversation(admin, caller, conversationId);
  let query = admin
    .from("messages")
    .select("id, direction, type, body, media_filename, media_mime, status, sender_id, metadata, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limitOf(q.limit));
  if (q.before) query = query.lt("created_at", q.before);
  const { data, error } = await query;
  if (error) throw error;
  return data.reverse();
}

export interface SendRequest {
  conversation_id?: string;
  channel_id?: string;
  to?: string;
  name?: string;
  text?: string;
  media_url?: string;
  media_type?: MediaType;
  filename?: string;
  template?: SendInput["template"];
}

// Starts a WhatsApp chat with a phone number (QR numbers: any message;
// official API numbers: a template first) or continues an existing chat.
async function resolveConversation(admin: SupabaseClient, caller: ApiCaller, input: SendRequest): Promise<string> {
  if (input.conversation_id) {
    await ownConversation(admin, caller, input.conversation_id);
    return input.conversation_id;
  }
  if (!input.channel_id || !input.to) {
    throw new HttpError(400, "Send conversation_id, or channel_id with to (phone number)", "invalid_request");
  }
  const { data: channel } = await admin
    .from("channels")
    .select("id, provider, is_active")
    .eq("id", input.channel_id)
    .eq("organization_id", caller.organizationId)
    .maybeSingle();
  if (!channel) throw new HttpError(404, "Channel not found", "not_found");
  if (channel.provider !== "cloud_api" && channel.provider !== "qr") {
    throw new HttpError(400, "New chats can only be started on WhatsApp channels; use conversation_id for other channels", "invalid_request");
  }
  const waId = normalizePhone(input.to);
  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .upsert(
      { organization_id: caller.organizationId, wa_id: waId, ...(input.name ? { name: input.name.trim() } : {}) },
      { onConflict: "organization_id,wa_id", ignoreDuplicates: false },
    )
    .select("id")
    .single();
  if (contactError) throw contactError;
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("channel_id", channel.id)
    .eq("contact_id", contact.id)
    .maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await admin
    .from("conversations")
    .insert({ organization_id: caller.organizationId, channel_id: channel.id, contact_id: contact.id })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

async function uploadFromUrl(admin: SupabaseClient, orgId: string, url: string, filename?: string) {
  if (!/^https?:\/\//.test(url)) throw new HttpError(400, "media_url must be an http(s) URL", "invalid_request");
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) throw new HttpError(400, `Could not download media_url (${res?.status ?? "network error"})`, "invalid_request");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new HttpError(413, "File is larger than 16 MB", "too_large");
  const name = (filename || new URL(url).pathname.split("/").pop() || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
  const mime = res.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  const path = `${orgId}/outbound/api-${crypto.randomUUID()}-${name}`;
  const { error } = await admin.storage.from("media").upload(path, bytes, { contentType: mime });
  if (error) throw error;
  const type: MediaType = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";
  return { path, name, type };
}

export async function sendMessage(admin: SupabaseClient, caller: ApiCaller, input: SendRequest) {
  const conversationId = await resolveConversation(admin, caller, input);
  let send: SendInput;
  if (input.template) {
    send = { type: "template", template: input.template };
  } else if (input.media_url) {
    const file = await uploadFromUrl(admin, caller.organizationId, input.media_url, input.filename);
    send = { type: input.media_type ?? file.type, media_path: file.path, filename: input.filename || file.name, text: input.text };
  } else {
    if (!input.text?.trim()) throw new HttpError(400, "Send text, media_url or template", "invalid_request");
    send = { type: "text", text: input.text };
  }
  const message = await sendToConversation(admin, conversationId, send, null, { source: "api", api_key_id: caller.keyId });
  return { conversation_id: conversationId, message };
}

export async function listContacts(admin: SupabaseClient, caller: ApiCaller, q: { search?: string; limit?: unknown }) {
  let query = admin
    .from("contacts")
    .select("id, wa_id, name, profile_name, email, company, notes, username, custom_fields, created_at")
    .eq("organization_id", caller.organizationId)
    .order("created_at", { ascending: false })
    .limit(limitOf(q.limit));
  const term = q.search?.trim();
  if (term) {
    const like = `%${term.replace(/[%_,()]/g, " ")}%`;
    query = query.or(`name.ilike.${like},profile_name.ilike.${like},wa_id.ilike.${like},email.ilike.${like},company.ilike.${like}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function upsertContact(
  admin: SupabaseClient,
  caller: ApiCaller,
  input: { phone?: string; wa_id?: string; name?: string; email?: string; company?: string; notes?: string; custom_fields?: Record<string, unknown> },
) {
  const raw = input.wa_id ?? input.phone;
  if (!raw) throw new HttpError(400, "phone is required", "invalid_request");
  const waId = input.wa_id ?? normalizePhone(raw);
  const values: Record<string, unknown> = { organization_id: caller.organizationId, wa_id: waId };
  for (const key of ["name", "email", "company", "notes"] as const) {
    if (typeof input[key] === "string") values[key] = input[key]!.trim().slice(0, key === "notes" ? 5000 : 200) || null;
  }
  if (input.custom_fields && typeof input.custom_fields === "object") values.custom_fields = input.custom_fields;
  const { data, error } = await admin
    .from("contacts")
    .upsert(values, { onConflict: "organization_id,wa_id" })
    .select("id, wa_id, name, email, company, notes, custom_fields, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function stats(admin: SupabaseClient, caller: ApiCaller) {
  const base = () => admin.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", caller.organizationId);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [open, pending, unassigned, resolvedToday] = await Promise.all([
    base().eq("status", "open"),
    base().eq("status", "pending"),
    base().neq("status", "resolved").is("assignee_id", null),
    base().eq("status", "resolved").gte("resolved_at", startOfDay.toISOString()),
  ]);
  return {
    open: open.count ?? 0,
    pending: pending.count ?? 0,
    unassigned: unassigned.count ?? 0,
    resolved_today: resolvedToday.count ?? 0,
  };
}
