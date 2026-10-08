// Voice notes and pictures for the AI.
//  - transcribe(): speech to text through an OpenAI-compatible
//    /audio/transcriptions API (OpenAI Whisper, Groq, ...). The text is saved
//    on the message (metadata.transcript) so it is done once and agents see it.
//  - turnImages(): the pictures in the customer's unanswered messages, for
//    models that can see.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";
import { decryptSecret } from "./crypto.ts";

export const AUDIO_TYPES = ["audio", "voice", "ptt"];
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES = 2;

const STT_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
};

export interface MediaRow {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  media_path?: string | null;
  media_mime?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface SttConfig {
  base: string;
  model: string;
  key: string;
}

// The organization's speech-to-text settings, or null when not set up.
export async function sttConfig(admin: SupabaseClient, orgId: string): Promise<SttConfig | null> {
  const [{ data: s }, { data: secret }] = await Promise.all([
    admin.from("ai_settings").select("provider, stt_provider, stt_model, stt_base_url").eq("organization_id", orgId).maybeSingle(),
    admin.from("ai_secrets").select("api_key_encrypted, stt_api_key_encrypted").eq("organization_id", orgId).maybeSingle(),
  ]);
  if (!s?.stt_provider) return null;
  const base = (s.stt_provider === "custom" ? s.stt_base_url : STT_BASE[s.stt_provider])?.replace(/\/$/, "");
  // An OpenAI chat key also works for OpenAI transcription.
  const stored = secret?.stt_api_key_encrypted ?? (s.stt_provider === "openai" && s.provider === "openai" ? secret?.api_key_encrypted : null);
  if (!base || !stored) return null;
  return { base, model: s.stt_model || "whisper-1", key: await decryptSecret(stored) };
}

export async function transcribe(admin: SupabaseClient, cfg: SttConfig, row: MediaRow): Promise<string> {
  if (!row.media_path) throw new HttpError(409, "File suara belum tersimpan", "media_missing");
  const file = await admin.storage.from("media").download(row.media_path);
  if (file.error) throw new HttpError(404, "File suara tidak ditemukan", "media_missing");
  if (file.data.size > MAX_AUDIO_BYTES) throw new HttpError(413, "Pesan suara terlalu panjang untuk ditranskrip", "too_large");
  const form = new FormData();
  const name = row.media_path.split("/").pop() ?? "voice.ogg";
  form.append("file", new File([file.data], name, { type: row.media_mime ?? file.data.type ?? "audio/ogg" }));
  form.append("model", cfg.model);
  form.append("response_format", "json");
  let res: Response;
  try {
    res = await fetch(`${cfg.base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new HttpError(502, `Layanan transkripsi tidak bisa dihubungi: ${(err as Error).message}`, "stt_error");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(502, `Transkripsi gagal: ${data?.error?.message ?? `HTTP ${res.status}`}`, "stt_error");
  }
  const text = String(data?.text ?? "").trim();
  await admin
    .from("messages")
    .update({ metadata: { ...(row.metadata ?? {}), transcript: text, transcribed_at: new Date().toISOString() } })
    .eq("id", row.id);
  row.metadata = { ...(row.metadata ?? {}), transcript: text };
  return text;
}

// The customer's messages since our last reply.
function unanswered(rows: MediaRow[]): MediaRow[] {
  const out: MediaRow[] = [];
  for (let i = rows.length - 1; i >= 0 && rows[i].direction === "inbound"; i--) out.unshift(rows[i]);
  return out;
}

// Transcribes the unanswered voice notes (in place). Failures leave the note as "[pesan suara]".
export async function transcribePending(admin: SupabaseClient, orgId: string, rows: MediaRow[]) {
  const pending = unanswered(rows).filter((r) => AUDIO_TYPES.includes(r.type) && r.media_path && !r.metadata?.transcript);
  if (!pending.length) return;
  const cfg = await sttConfig(admin, orgId);
  if (!cfg) return;
  for (const row of pending.slice(0, 3)) {
    try {
      await transcribe(admin, cfg, row);
    } catch (err) {
      console.error(`transcription of ${row.id} failed`, err);
    }
  }
}

// Pictures from the unanswered customer messages, newest last.
export async function turnImages(admin: SupabaseClient, rows: MediaRow[]): Promise<{ mime: string; data: string }[]> {
  const pictures = unanswered(rows)
    .filter((r) => (r.type === "image" || r.type === "sticker") && r.media_path && IMAGE_MIMES.includes(r.media_mime ?? ""))
    .slice(-MAX_IMAGES);
  const out: { mime: string; data: string }[] = [];
  for (const r of pictures) {
    const file = await admin.storage.from("media").download(r.media_path!);
    if (file.error || file.data.size > MAX_IMAGE_BYTES) continue;
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.push({ mime: r.media_mime!, data: btoa(bin) });
  }
  return out;
}
