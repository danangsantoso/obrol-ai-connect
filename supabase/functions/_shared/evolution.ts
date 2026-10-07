// Thin client for the self-hosted Evolution API gateway that links regular
// WhatsApp numbers by QR code (WhatsApp Web protocol). The gateway runs next to
// Supabase on the internal Docker network and is never exposed to the internet.
//
// Env: EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_URL, EVOLUTION_WEBHOOK_TOKEN
import { HttpError } from "./http.ts";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface QrCode {
  base64: string | null;
  pairingCode: string | null;
}

export interface SentMessage {
  key: { id: string; remoteJid: string; fromMe: boolean };
}

const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"];

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, `${name} is not configured`, "not_configured");
  return value;
}

export class EvolutionError extends HttpError {
  constructor(public evolutionStatus: number, public detail: unknown) {
    super(502, evolutionErrorMessage(evolutionStatus, detail), "whatsapp_error");
  }
}

function evolutionErrorMessage(status: number, detail: unknown): string {
  const messages = (detail as { response?: { message?: unknown } })?.response?.message;
  const first = Array.isArray(messages) ? messages[0] : messages;
  if (first && typeof first === "object" && (first as { exists?: boolean }).exists === false) {
    return "Nomor ini tidak terdaftar di WhatsApp.";
  }
  if (typeof first === "string") {
    if (first.includes("Connection Closed") || first.includes("not connected")) {
      return "Nomor WhatsApp (QR) sedang tidak terhubung. Hubungkan ulang di Pengaturan.";
    }
    return first;
  }
  return `WhatsApp gateway request failed (${status})`;
}

async function evolution<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env("EVOLUTION_API_URL").replace(/\/$/, "")}${path}`, {
      method,
      headers: { apikey: env("EVOLUTION_API_KEY"), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    console.error("evolution unreachable", err);
    throw new HttpError(503, "Gateway WhatsApp (QR) tidak bisa dihubungi", "gateway_unreachable");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new EvolutionError(res.status, data);
  return data as T;
}

const name = (instance: string) => encodeURIComponent(instance);

function webhookConfig() {
  return {
    enabled: true,
    url: env("EVOLUTION_WEBHOOK_URL"),
    headers: { "x-balas-token": env("EVOLUTION_WEBHOOK_TOKEN") },
    byEvents: false,
    base64: false,
    events: WEBHOOK_EVENTS,
  };
}

export function mapState(state: string | undefined): ConnectionStatus {
  if (state === "open") return "connected";
  if (state === "connecting") return "connecting";
  return "disconnected";
}

// Returns the instance state, or null when the instance does not exist yet.
export async function connectionState(instance: string): Promise<string | null> {
  try {
    const data = await evolution<{ instance?: { state?: string } }>(
      "GET",
      `/instance/connectionState/${name(instance)}`,
    );
    return data.instance?.state ?? "close";
  } catch (err) {
    if (err instanceof EvolutionError && err.evolutionStatus === 404) return null;
    throw err;
  }
}

// Phone number and profile name of a connected instance.
export async function ownerInfo(instance: string): Promise<{ phone: string | null; name: string | null }> {
  const list = await evolution<{ ownerJid?: string; profileName?: string }[]>(
    "GET",
    `/instance/fetchInstances?instanceName=${name(instance)}`,
  );
  const owner = list[0]?.ownerJid?.split("@")[0] ?? null;
  return { phone: owner ? `+${owner}` : null, name: list[0]?.profileName ?? null };
}

function toQr(data: { base64?: string | null; pairingCode?: string | null } | undefined): QrCode {
  return { base64: data?.base64 ?? null, pairingCode: data?.pairingCode ?? null };
}

// Creates the instance and starts a session. With a phone number WhatsApp also
// issues a pairing code, an alternative to scanning the QR code.
export async function createInstance(instance: string, phone?: string): Promise<QrCode> {
  const data = await evolution<{ qrcode?: { base64?: string; pairingCode?: string } }>(
    "POST",
    "/instance/create",
    {
      instanceName: instance,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      ...(phone ? { number: phone } : {}),
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      rejectCall: false,
      webhook: webhookConfig(),
    },
  );
  return toQr(data.qrcode);
}

// Keeps the gateway's webhook settings in line with this server's configuration.
export async function syncWebhook(instance: string): Promise<void> {
  await evolution("POST", `/webhook/set/${name(instance)}`, { webhook: webhookConfig() });
}

// Current QR code while connecting; starts a new session when the instance is closed.
export async function connect(instance: string): Promise<QrCode> {
  const data = await evolution<{ base64?: string; pairingCode?: string }>(
    "GET",
    `/instance/connect/${name(instance)}`,
  );
  return toQr(data);
}

export async function logout(instance: string): Promise<void> {
  try {
    await evolution("DELETE", `/instance/logout/${name(instance)}`);
  } catch (err) {
    // Already logged out or never connected.
    if (!(err instanceof EvolutionError && [400, 404].includes(err.evolutionStatus))) throw err;
  }
}

// Deletes the instance and waits until it is gone: the gateway removes it in
// the background, and recreating it under the same name fails until then.
export async function deleteInstance(instance: string): Promise<void> {
  try {
    await evolution("DELETE", `/instance/delete/${name(instance)}`);
  } catch (err) {
    if (!(err instanceof EvolutionError && [400, 404].includes(err.evolutionStatus))) throw err;
  }
  for (let i = 0; i < 40; i++) {
    if ((await connectionState(instance)) === null) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new HttpError(503, "Gateway WhatsApp (QR) masih memproses, coba lagi sebentar", "gateway_busy");
}

// Customers are stored by phone number; contacts WhatsApp only exposes as a
// linked id (…@lid) keep the full jid so replies still reach them.
export function recipient(waId: string): string {
  return waId.includes("@") ? waId : waId.replace(/\D/g, "");
}

const quote = (replyTo?: string | null) => (replyTo ? { quoted: { key: { id: replyTo } } } : {});

export function sendText(instance: string, waId: string, text: string, replyTo?: string | null) {
  return evolution<SentMessage>("POST", `/message/sendText/${name(instance)}`, {
    number: recipient(waId),
    text,
    linkPreview: true,
    ...quote(replyTo),
  });
}

export function sendMedia(
  instance: string,
  waId: string,
  media: { type: "image" | "video" | "audio" | "document"; base64: string; mime: string; filename: string; caption?: string | null },
  replyTo?: string | null,
) {
  if (media.type === "audio") {
    return evolution<SentMessage>("POST", `/message/sendWhatsAppAudio/${name(instance)}`, {
      number: recipient(waId),
      audio: media.base64,
      ...quote(replyTo),
    });
  }
  return evolution<SentMessage>("POST", `/message/sendMedia/${name(instance)}`, {
    number: recipient(waId),
    mediatype: media.type,
    mimetype: media.mime,
    fileName: media.filename,
    media: media.base64,
    ...(media.caption ? { caption: media.caption } : {}),
    ...quote(replyTo),
  });
}

// Downloads (and decrypts) the media of a received message the gateway stored.
export async function downloadMedia(
  instance: string,
  messageId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string | null }> {
  const data = await evolution<{ base64: string; mimetype?: string; fileName?: string }>(
    "POST",
    `/chat/getBase64FromMediaMessage/${name(instance)}`,
    { message: { key: { id: messageId } }, convertToMp4: false },
  );
  const binary = atob(data.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mimeType: data.mimetype ?? "application/octet-stream", fileName: data.fileName ?? null };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function isValidToken(given: string | null): boolean {
  const expected = Deno.env.get("EVOLUTION_WEBHOOK_TOKEN");
  if (!expected || !given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
