import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// Calls a Balas.id Edge Function and surfaces its { error: { message } } body as an Error.
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.error?.message ?? error.message);
    }
    throw error;
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'Terjadi kesalahan';
}

export const ROLE_LABELS = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  agent: 'Agen',
} as const;

export const STATUS_LABELS = {
  open: 'Open',
  pending: 'Pending',
  resolved: 'Resolved',
} as const;

// WhatsApp customers are stored by number; QR numbers can see a linked id (…@lid)
// instead; Messenger and Instagram customers by their page-scoped id (fb:…, ig:…).
export function formatWaId(waId: string, username?: string | null) {
  if (waId.startsWith('fb:')) return 'Facebook Messenger';
  if (waId.startsWith('ig:')) return username ? `Instagram @${username}` : 'Instagram';
  if (waId.startsWith('tg:')) return username ? `Telegram @${username}` : 'Telegram';
  if (waId.startsWith('web:')) return 'Live chat website';
  return waId.includes('@') ? 'Nomor disembunyikan' : `+${waId}`;
}

export function displayName(contact: { name: string | null; profile_name: string | null; wa_id: string }) {
  return contact.name || contact.profile_name || formatWaId(contact.wa_id);
}

export function initials(name: string) {
  return name
    .replace(/^\+/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export const WINDOW_MS = 24 * 60 * 60 * 1000;

// Remaining time in WhatsApp's 24-hour customer service window (0 = closed).
export function windowRemainingMs(lastCustomerMessageAt: string | null, now = Date.now()) {
  if (!lastCustomerMessageAt) return 0;
  return Math.max(0, new Date(lastCustomerMessageAt).getTime() + WINDOW_MS - now);
}

// Messenger / Instagram allow replies for 7 days with the HUMAN_AGENT tag.
export const HUMAN_AGENT_WINDOW_MS = 7 * WINDOW_MS;

export function socialWindowRemainingMs(lastCustomerMessageAt: string | null, now = Date.now()) {
  if (!lastCustomerMessageAt) return 0;
  return Math.max(0, new Date(lastCustomerMessageAt).getTime() + HUMAN_AGENT_WINDOW_MS - now);
}
