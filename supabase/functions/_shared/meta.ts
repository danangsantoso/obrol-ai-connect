// Facebook Messenger and Instagram Direct through the Meta Graph API, with
// Page access tokens obtained by "Login with Facebook".
//
// Env: META_APP_ID, META_APP_SECRET (falls back to WHATSAPP_APP_SECRET: same Meta app),
// PUBLIC_API_URL (public Supabase URL, for the OAuth redirect and media links).
import { HttpError } from "./http.ts";

const GRAPH_BASE = Deno.env.get("WHATSAPP_GRAPH_BASE_URL") ?? "https://graph.facebook.com";
const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";
const DIALOG_BASE = Deno.env.get("META_DIALOG_BASE_URL") ?? "https://www.facebook.com";

export const SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "business_management",
  "instagram_basic",
  "instagram_manage_messages",
];

export function appCredentials(): { id: string; secret: string } {
  const id = Deno.env.get("META_APP_ID");
  const secret = Deno.env.get("META_APP_SECRET") || Deno.env.get("WHATSAPP_APP_SECRET");
  if (!id || !secret) {
    throw new HttpError(
      500,
      "Facebook/Instagram belum dikonfigurasi di server: isi META_APP_ID dan META_APP_SECRET.",
      "not_configured",
    );
  }
  return { id, secret };
}

export function redirectUri(): string {
  const base = Deno.env.get("PUBLIC_API_URL");
  if (!base) throw new HttpError(500, "PUBLIC_API_URL is not configured", "not_configured");
  return `${base.replace(/\/$/, "")}/functions/v1/social-oauth`;
}

export class MetaError extends HttpError {
  constructor(public graphStatus: number, public detail: Record<string, unknown> | undefined) {
    super(502, metaErrorMessage(detail), "meta_error");
  }
}

function metaErrorMessage(detail: Record<string, unknown> | undefined): string {
  const code = detail?.code as number | undefined;
  const sub = detail?.error_subcode as number | undefined;
  if (code === 190) return "Akses ke Halaman sudah kedaluwarsa. Hubungkan ulang Facebook/Instagram di Pengaturan.";
  if (code === 10 && sub === 2018278) {
    return "Lewat dari batas waktu balasan Meta (24 jam / 7 hari dengan tag Human Agent). Pelanggan harus mengirim pesan dulu.";
  }
  if (code === 551 || sub === 1545041) return "Pelanggan ini tidak bisa menerima pesan saat ini.";
  if (code === 200 || code === 10) return `Izin Meta belum lengkap: ${detail?.message ?? ""}`.trim();
  return (detail?.message as string | undefined) ?? "Permintaan ke Meta gagal";
}

async function graph<T>(path: string, init: RequestInit & { token?: string; query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(url, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaError(res.status, body?.error);
  return body as T;
}

export function dialogUrl(state: string): string {
  const url = new URL(`${DIALOG_BASE}/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appCredentials().id);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

// Code -> short-lived user token -> long-lived user token. Page tokens taken
// from a long-lived user token do not expire.
export async function exchangeCode(code: string): Promise<string> {
  const app = appCredentials();
  const short = await graph<{ access_token: string }>("oauth/access_token", {
    query: { client_id: app.id, client_secret: app.secret, redirect_uri: redirectUri(), code },
  });
  const long = await graph<{ access_token: string }>("oauth/access_token", {
    query: {
      grant_type: "fb_exchange_token",
      client_id: app.id,
      client_secret: app.secret,
      fb_exchange_token: short.access_token,
    },
  });
  return long.access_token;
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
}

export async function listPages(userToken: string): Promise<MetaPage[]> {
  const pages: MetaPage[] = [];
  let after: string | undefined;
  for (let i = 0; i < 10; i++) {
    const page: { data: MetaPage[]; paging?: { cursors?: { after?: string }; next?: string } } = await graph("me/accounts", {
      token: userToken,
      query: {
        fields: "id,name,access_token,instagram_business_account{id,username,profile_picture_url}",
        limit: "100",
        ...(after ? { after } : {}),
      },
    });
    pages.push(...page.data);
    after = page.paging?.next ? page.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return pages;
}

// Lets the app receive the Page's (and its Instagram account's) message webhooks.
export async function subscribePage(pageId: string, pageToken: string) {
  await graph(`${pageId}/subscribed_apps`, {
    method: "POST",
    token: pageToken,
    query: { subscribed_fields: "messages,message_echoes,message_deliveries,message_reads,messaging_postbacks" },
  });
}

export async function unsubscribePage(pageId: string, pageToken: string) {
  try {
    await graph(`${pageId}/subscribed_apps`, { method: "DELETE", token: pageToken });
  } catch (err) {
    console.warn(`could not unsubscribe page ${pageId}`, err);
  }
}

export type SocialAttachment = "image" | "video" | "audio" | "file";

// Sends a Messenger / Instagram message and returns its id (mid).
// tag: HUMAN_AGENT for replies 24 h - 7 days after the customer's last message.
export async function sendSocial(
  pageToken: string,
  recipientId: string,
  message: { text?: string; attachment?: { type: SocialAttachment; url: string } },
  tag?: "HUMAN_AGENT",
): Promise<string> {
  const body: Record<string, unknown> = {
    recipient: { id: recipientId },
    messaging_type: tag ? "MESSAGE_TAG" : "RESPONSE",
    ...(tag ? { tag } : {}),
    message: message.attachment
      ? { attachment: { type: message.attachment.type, payload: { url: message.attachment.url, is_reusable: false } } }
      : { text: message.text },
  };
  const data = await graph<{ message_id: string }>("me/messages", {
    method: "POST",
    token: pageToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return data.message_id;
}

// Name, @username and picture of a customer (best effort; needs the page token).
export async function customerProfile(
  provider: "messenger" | "instagram",
  userId: string,
  pageToken: string,
): Promise<{ name: string | null; username: string | null; avatar: string | null }> {
  try {
    if (provider === "instagram") {
      const p = await graph<{ name?: string; username?: string; profile_pic?: string }>(userId, {
        token: pageToken,
        query: { fields: "name,username,profile_pic" },
      });
      return { name: p.name ?? p.username ?? null, username: p.username ?? null, avatar: p.profile_pic ?? null };
    }
    const p = await graph<{ first_name?: string; last_name?: string; profile_pic?: string }>(userId, {
      token: pageToken,
      query: { fields: "first_name,last_name,profile_pic" },
    });
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    return { name: name || null, username: null, avatar: p.profile_pic ?? null };
  } catch (err) {
    console.warn(`no profile for ${provider} user ${userId}`, err);
    return { name: null, username: null, avatar: null };
  }
}

// Contacts from social channels are stored with a prefix so they never
// collide with WhatsApp numbers: fb:<page-scoped id>, ig:<instagram-scoped id>.
export function contactKey(provider: "messenger" | "instagram", userId: string): string {
  return `${provider === "messenger" ? "fb" : "ig"}:${userId}`;
}

export function userIdFromKey(key: string): string {
  return key.replace(/^(fb|ig):/, "");
}

// Typing indicator in Messenger / Instagram (Meta turns it off after ~20 s or at the reply).
export async function typingOn(pageToken: string, recipientId: string): Promise<void> {
  await graph("me/messages", {
    method: "POST",
    token: pageToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, sender_action: "typing_on" }),
  });
}
