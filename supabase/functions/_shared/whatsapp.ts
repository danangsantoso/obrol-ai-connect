// Thin client for the WhatsApp Business Cloud API (Meta Graph API).
import { HttpError } from "./http.ts";

const GRAPH_BASE = Deno.env.get("WHATSAPP_GRAPH_BASE_URL") ?? "https://graph.facebook.com";
const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";

export class GraphError extends HttpError {
  constructor(public graphStatus: number, public detail: Record<string, unknown> | undefined) {
    super(502, graphErrorMessage(detail), "whatsapp_error");
  }
}

function graphErrorMessage(detail: Record<string, unknown> | undefined): string {
  const code = detail?.code;
  if (code === 131047) {
    return "Lebih dari 24 jam sejak pesan terakhir pelanggan. Gunakan template pesan.";
  }
  const data = detail?.error_data as { details?: string } | undefined;
  return data?.details ?? (detail?.message as string | undefined) ?? "WhatsApp API request failed";
}

function accessToken(): string {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!token) throw new HttpError(500, "WHATSAPP_ACCESS_TOKEN is not configured", "not_configured");
  return token;
}

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken()}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new GraphError(res.status, body?.error);
  return body as T;
}

// Sends a message and returns its WhatsApp message id (wamid).
export async function sendMessage(
  phoneNumberId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const data = await graph<{ messages: { id: string }[] }>(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
  return data.messages[0].id;
}

export async function uploadMedia(
  phoneNumberId: string,
  file: Blob,
  mimeType: string,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new File([file], filename, { type: mimeType }));
  const data = await graph<{ id: string }>(`${phoneNumberId}/media`, { method: "POST", body: form });
  return data.id;
}

// Media ids from webhooks resolve to a short-lived URL that also needs the token.
export async function downloadMedia(mediaId: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const meta = await graph<{ url: string; mime_type: string }>(mediaId);
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken()}` } });
  if (!res.ok) throw new Error(`media download failed with ${res.status}`);
  return { bytes: await res.arrayBuffer(), mimeType: meta.mime_type };
}

export interface GraphTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  components: unknown[];
}

export async function listTemplates(wabaId: string): Promise<GraphTemplate[]> {
  const all: GraphTemplate[] = [];
  let path: string | null = `${wabaId}/message_templates?limit=100&fields=name,language,status,category,components`;
  while (path) {
    const page: { data: GraphTemplate[]; paging?: { cursors?: { after?: string }; next?: string } } =
      await graph(path);
    all.push(...page.data);
    const after = page.paging?.next ? page.paging.cursors?.after : undefined;
    path = after ? `${wabaId}/message_templates?limit=100&fields=name,language,status,category,components&after=${after}` : null;
  }
  return all;
}

// Meta signs webhook bodies with the app secret: X-Hub-Signature-256: sha256=<hex>.
export async function isValidSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
};

export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType.split(";")[0].trim()] ?? "bin";
}
