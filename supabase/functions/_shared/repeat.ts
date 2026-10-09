// Repeat order reminders: a little before a customer's product usually runs
// out (products.repurchase_days, planned by the orders_repeat trigger), the
// customer gets the organization's reminder message. Sent by the minute sweep
// (followup function).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, reportError } from "./http.ts";
import { sendToConversation } from "./send.ts";
import { cleanName } from "./ai.ts";

interface Reminder {
  id: string;
  organization_id: string;
  contact_id: string;
  conversation_id: string;
  products: string;
}

interface Settings {
  enabled: boolean;
  message: string;
  template_name: string | null;
  template_language: string;
}

// {nama}: the customer's first name (dropped when unknown), {produk}: the products.
export function renderRepeat(message: string, name: string | null, products: string) {
  const named = name ? message.replaceAll("{nama}", name) : message.replace(/ ?\{nama\}/g, "");
  return named.replaceAll("{produk}", products).trim();
}

export async function sweepRepeat(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("repeat_claim", { p_limit: 30 });
  if (error) {
    reportError("claim repeat reminders failed", error);
    return { repeat_sent: 0, repeat_skipped: 0 };
  }
  let sent = 0;
  let skipped = 0;
  const settings = new Map<string, Settings | null>();
  const skip = async (id: string, reason: string) => {
    skipped++;
    await admin.from("repeat_reminders").update({ status: "skipped", reason }).eq("id", id);
  };

  for (const r of (data ?? []) as Reminder[]) {
    if (!settings.has(r.organization_id)) {
      const { data: s } = await admin.from("repeat_settings").select("enabled, message, template_name, template_language")
        .eq("organization_id", r.organization_id).maybeSingle<Settings>();
      settings.set(r.organization_id, s);
    }
    const s = settings.get(r.organization_id);
    if (!s?.enabled) {
      await skip(r.id, "Pengingat repeat order dimatikan");
      continue;
    }
    const [{ data: contact }, { data: conv }] = await Promise.all([
      admin.from("contacts").select("name, profile_name, broadcast_opt_out").eq("id", r.contact_id).maybeSingle(),
      admin.from("conversations").select("last_customer_message_at, channels(provider, is_active)").eq("id", r.conversation_id)
        .maybeSingle<{ last_customer_message_at: string | null; channels: { provider: string; is_active: boolean } }>(),
    ]);
    if (!contact || !conv) {
      await skip(r.id, "Chat tidak ditemukan");
      continue;
    }
    if (contact.broadcast_opt_out) {
      await skip(r.id, "Pelanggan berhenti berlangganan pesan promosi");
      continue;
    }
    const name = (cleanName(contact.name) ?? cleanName(contact.profile_name))?.split(" ")[0] ?? null;
    const meta = { repeat_reminder: r.id };
    const windowClosed = conv.channels.provider === "cloud_api" &&
      (!conv.last_customer_message_at || Date.now() - new Date(conv.last_customer_message_at).getTime() >= 24 * 3600_000);
    try {
      let message: { id: string } | null;
      if (windowClosed) {
        if (!s.template_name) {
          await skip(r.id, "Lewat 24 jam: nomor WhatsApp API butuh template pengingat");
          continue;
        }
        message = await sendToConversation(admin, r.conversation_id, {
          type: "template",
          template: { name: s.template_name, language: s.template_language, parameters: [name ?? "Kak", r.products] },
        }, null, meta);
      } else {
        message = await sendToConversation(admin, r.conversation_id, { type: "text", text: renderRepeat(s.message, name, r.products) }, null, meta);
      }
      await admin.from("repeat_reminders").update({ status: "sent", sent_at: new Date().toISOString(), message_id: message?.id ?? null, reason: null })
        .eq("id", r.id);
      sent++;
    } catch (err) {
      if (!(err instanceof HttpError)) reportError("repeat reminder failed", err);
      await skip(r.id, (err instanceof Error ? err.message : String(err)).slice(0, 300));
    }
  }
  return { repeat_sent: sent, repeat_skipped: skipped };
}
