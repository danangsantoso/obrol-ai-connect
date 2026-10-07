// Thin client for the Telegram Bot API. Each Telegram channel is one bot,
// created by the business in @BotFather; its token is stored encrypted.
//
// Env: TELEGRAM_API_BASE (tests only; defaults to https://api.telegram.org)
import { HttpError } from "./http.ts";

const API_BASE = (Deno.env.get("TELEGRAM_API_BASE") ?? "https://api.telegram.org").replace(/\/$/, "");

export class TelegramError extends HttpError {
  constructor(public telegramStatus: number, description: string | undefined) {
    super(502, telegramMessage(telegramStatus, description), "telegram_error");
  }
}

function telegramMessage(status: number, description: string | undefined): string {
  if (status === 401 || status === 404) return "Token bot Telegram tidak valid. Salin ulang dari @BotFather.";
  if (status === 403) return "Pelanggan memblokir bot ini atau belum pernah memulai chat dengan bot.";
  if (status === 429) return "Telegram membatasi pengiriman (terlalu banyak pesan). Coba lagi sebentar.";
  return description ? `Telegram: ${description}` : "Permintaan ke Telegram gagal";
}

async function call<T>(token: string, method: string, body?: Record<string, unknown> | FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      ...(body instanceof FormData
        ? { body }
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new HttpError(503, "Telegram tidak bisa dihubungi", "telegram_unreachable");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new TelegramError(data.error_code ?? res.status, data.description);
  return data.result as T;
}

export function getMe(token: string) {
  return call<{ id: number; username: string; first_name: string }>(token, "getMe");
}

export function setWebhook(token: string, url: string, secret: string) {
  return call<boolean>(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
  });
}

export function deleteWebhook(token: string) {
  return call<boolean>(token, "deleteWebhook", {});
}

export async function downloadFile(token: string, fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
  const file = await call<{ file_path: string }>(token, "getFile", { file_id: fileId });
  const res = await fetch(`${API_BASE}/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`telegram file download failed with ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), path: file.file_path };
}

interface SentMessage {
  message_id: number;
}

export async function sendText(token: string, chatId: string, text: string): Promise<number> {
  const sent = await call<SentMessage>(token, "sendMessage", { chat_id: chatId, text });
  return sent.message_id;
}

const FILE_METHODS = {
  image: ["sendPhoto", "photo"],
  video: ["sendVideo", "video"],
  audio: ["sendAudio", "audio"],
  document: ["sendDocument", "document"],
} as const;

// Uploads the file itself, so no public link is needed.
export async function sendFile(
  token: string,
  chatId: string,
  type: keyof typeof FILE_METHODS,
  file: Blob,
  filename: string,
  caption?: string | null,
): Promise<number> {
  const [method, field] = FILE_METHODS[type];
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append(field, new File([file], filename, { type: file.type || "application/octet-stream" }));
  if (caption) form.append("caption", caption.slice(0, 1024));
  const sent = await call<SentMessage>(token, method, form);
  return sent.message_id;
}

// Contacts from Telegram are stored as tg:<chat id>; message ids as tg:<chat id>:<message id>.
export const telegramKey = (chatId: number | string) => `tg:${chatId}`;
export const telegramMessageId = (chatId: number | string, messageId: number) => `tg:${chatId}:${messageId}`;

// "typing..." in Telegram; it lasts about 5 seconds, so repeat it for longer waits.
export function sendTyping(token: string, chatId: string) {
  return call<boolean>(token, "sendChatAction", { chat_id: chatId, action: "typing" });
}
