// Automatic follow-up: sends the due steps of follow-up sequences. Run every
// minute by the followup function (cron); the database decides what is due
// and stops a sequence as soon as the customer replies.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, reportError } from "./http.ts";
import { sendToConversation } from "./send.ts";
import { cleanName, personalizeFollowup } from "./ai.ts";

interface Enrollment {
  id: string;
  organization_id: string;
  sequence_id: string;
  conversation_id: string;
  current_step: number;
  steps_total: number;
}

interface Step {
  position: number;
  message: string;
  template_name: string | null;
  template_language: string | null;
}

export interface FollowupContext {
  name: string | null;
  salutation: "auto" | "kak" | "bapak_ibu" | "name_only";
  agent: string | null;
  bot: string;
  shop: string;
}

// {nama} {sapaan} {agen} {bot} {toko} → the customer's details.
export function renderFollowup(text: string, ctx: FollowupContext): string {
  const first = ctx.name?.split(" ")[0] ?? null;
  const call = !first
    ? "Kak"
    : ctx.salutation === "name_only"
    ? first
    : ctx.salutation === "bapak_ibu"
    ? `Bapak/Ibu ${first}`
    : `Kak ${first}`;
  const values: Record<string, string> = {
    nama: first ?? "Kak",
    sapaan: call,
    agen: ctx.agent ?? ctx.bot,
    bot: ctx.bot,
    toko: ctx.shop,
  };
  return text.replace(/\{(nama|sapaan|agen|bot|toko)\}/gi, (_, key: string) => values[key.toLowerCase()]);
}

const FINAL_ERRORS = new Set(["window_closed", "channel_inactive", "template_not_found", "template_not_approved", "invalid_request"]);

async function context(admin: SupabaseClient, conversationId: string, orgId: string): Promise<FollowupContext> {
  const [{ data: conv }, { data: ai }, { data: org }] = await Promise.all([
    admin
      .from("conversations")
      .select("contacts(name, profile_name), assignee:profiles!conversations_assignee_id_fkey(full_name)")
      .eq("id", conversationId)
      .single<{ contacts: { name: string | null; profile_name: string | null }; assignee: { full_name: string | null } | null }>(),
    admin.from("ai_settings").select("bot_name, salutation").eq("organization_id", orgId).maybeSingle(),
    admin.from("organizations").select("name").eq("id", orgId).single(),
  ]);
  return {
    name: cleanName(conv?.contacts?.name) ?? cleanName(conv?.contacts?.profile_name),
    salutation: ai?.salutation ?? "auto",
    agent: conv?.assignee?.full_name?.split(" ")[0] ?? null,
    bot: ai?.bot_name ?? "Admin",
    shop: org?.name ?? "kami",
  };
}

// Number of {{n}} placeholders in a template's body.
function templateParamCount(components: unknown): number {
  const body = Array.isArray(components)
    ? (components as { type?: string; text?: string }[]).find((c) => c.type?.toUpperCase() === "BODY")
    : null;
  return new Set(body?.text?.match(/\{\{\d+\}\}/g) ?? []).size;
}

async function sendStep(admin: SupabaseClient, e: Enrollment) {
  const [{ data: seq }, { data: steps }, { data: conv }] = await Promise.all([
    admin.from("followup_sequences").select("name, ai_personalize").eq("id", e.sequence_id).single(),
    admin.from("followup_steps").select("position, message, template_name, template_language").eq("sequence_id", e.sequence_id)
      .gt("position", e.current_step).order("position").limit(1),
    admin.from("conversations").select("last_customer_message_at, channels(provider)").eq("id", e.conversation_id)
      .single<{ last_customer_message_at: string | null; channels: { provider: string } }>(),
  ]);
  const step = (steps as Step[] | null)?.[0];
  if (!seq || !step || !conv) {
    await admin.rpc("followup_record_send", {
      p_enrollment_id: e.id, p_position: e.current_step + 1, p_outcome: "failed", p_message_id: null,
      p_error: "Pesan follow-up tidak ditemukan (urutan diubah?)",
    });
    return;
  }

  const ctx = await context(admin, e.conversation_id, e.organization_id);
  let text = renderFollowup(step.message, ctx);
  const meta = { followup: { sequence_id: e.sequence_id, sequence: seq.name, step: step.position, of: e.steps_total } };

  // WhatsApp API numbers need an approved template once 24 hours have passed.
  const windowClosed = conv.channels.provider === "cloud_api" &&
    (!conv.last_customer_message_at || Date.now() - new Date(conv.last_customer_message_at).getTime() >= 24 * 3600_000);

  try {
    let message: { id: string } | null;
    if (windowClosed) {
      if (!step.template_name || !step.template_language) {
        throw new HttpError(
          422,
          `Lewat 24 jam sejak pesan terakhir pelanggan: lapis ${step.position} butuh template WhatsApp`,
          "window_closed",
        );
      }
      const { data: tpl } = await admin.from("templates").select("components").eq("organization_id", e.organization_id)
        .eq("name", step.template_name).eq("language", step.template_language).maybeSingle();
      const params = [renderFollowup("{sapaan}", ctx), ctx.agent ?? ctx.bot, ctx.shop].slice(0, templateParamCount(tpl?.components));
      message = await sendToConversation(admin, e.conversation_id, {
        type: "template",
        template: { name: step.template_name, language: step.template_language, parameters: params },
      }, null, meta);
    } else {
      if (seq.ai_personalize) {
        text = (await personalizeFollowup(admin, e.organization_id, e.conversation_id, text, { position: step.position, total: e.steps_total })) ?? text;
      }
      // The customer may have replied while the AI was writing.
      const { data: still } = await admin.from("followup_enrollments").select("status").eq("id", e.id).single();
      if (still?.status !== "active") return;
      message = await sendToConversation(admin, e.conversation_id, { type: "text", text }, null, meta);
    }
    await admin.rpc("followup_record_send", {
      p_enrollment_id: e.id, p_position: step.position, p_outcome: "sent", p_message_id: message?.id ?? null, p_error: null,
    });
  } catch (err) {
    const final = err instanceof HttpError && (FINAL_ERRORS.has(err.code) || err.status === 404);
    const msg = err instanceof Error ? err.message : String(err);
    if (!final) reportError("follow-up step failed", err);
    await admin.rpc("followup_record_send", {
      p_enrollment_id: e.id, p_position: step.position, p_outcome: final ? "failed" : "retry", p_message_id: null, p_error: msg.slice(0, 500),
    });
  }
}

export async function sweepFollowups(admin: SupabaseClient, deadlineMs = Date.now() + 50_000) {
  const { data: enrolled, error: enrollError } = await admin.rpc("followup_auto_enroll");
  if (enrollError) console.error("follow-up auto enroll failed", enrollError);
  const { data: due, error } = await admin.rpc("followup_claim_due", { p_limit: 30 });
  if (error) throw error;
  let sent = 0;
  for (const e of (due ?? []) as Enrollment[]) {
    if (Date.now() > deadlineMs) {
      // Hand the rest back to the next sweep.
      await admin.from("followup_enrollments").update({ next_send_at: new Date().toISOString() }).eq("id", e.id).eq("status", "active");
      continue;
    }
    await sendStep(admin, e);
    sent++;
  }
  return { enrolled: enrolled ?? 0, processed: sent };
}

// The AI's own follow-ups for chats it is serving whose customer went quiet
// (ai_followup_claim decides which are due). The text is written by the AI
// from the chat so far; the prepared lines are the fallback.
const AI_FOLLOWUP_DRAFTS = [
  "Halo *{sapaan}* 😊 Masih ada yang bisa {bot} bantu terkait pertanyaan sebelumnya? Kalau berkenan, saya bantu prosesnya sekarang ya.",
  "*{sapaan}*, sekadar mengingatkan ya 🙏 Kalau masih tertarik, {bot} siap bantu pilihkan dan siapkan pesanannya.",
  "Terima kasih sudah menghubungi {toko}, *{sapaan}* 🙏 Kapan pun butuh, tinggal balas chat ini ya, {bot} siap membantu.",
];

export async function sweepAiFollowups(admin: SupabaseClient) {
  const { data: due, error } = await admin.rpc("ai_followup_claim", { p_limit: 20 });
  if (error) {
    console.error("ai follow-up claim failed", error);
    return 0;
  }
  let sent = 0;
  for (const row of (due ?? []) as { conversation_id: string; organization_id: string; followup_number: number; followup_max: number }[]) {
    try {
      const { data: granted } = await admin.rpc("use_quota", { p_org: row.organization_id, p_kind: "ai_replies", p_amount: 1 });
      if ((granted ?? 1) < 1) continue;
      const ctx = await context(admin, row.conversation_id, row.organization_id);
      const isLast = row.followup_number >= row.followup_max;
      const draft = AI_FOLLOWUP_DRAFTS[isLast ? 2 : Math.min(row.followup_number - 1, 1)];
      const fallback = renderFollowup(draft, { ...ctx, agent: null });
      const text = (await personalizeFollowup(admin, row.organization_id, row.conversation_id, fallback, {
        position: row.followup_number,
        total: row.followup_max,
      })) ?? fallback;
      // The customer may have written meanwhile, or an agent taken the chat.
      const { data: fresh } = await admin.from("conversations").select("assignee_id, ai_engaged, ai_followups_sent").eq("id", row.conversation_id).single();
      if (!fresh || fresh.assignee_id || !fresh.ai_engaged || fresh.ai_followups_sent === 0) continue;
      await sendToConversation(admin, row.conversation_id, { type: "text", text }, null, {
        ai: true,
        bot_name: ctx.bot,
        ai_followup: row.followup_number,
      });
      sent++;
    } catch (err) {
      reportError("ai follow-up failed", err);
    }
  }
  return sent;
}
