// Meta Conversions API (events) and Marketing API (ad spend) for the ad
// tracking feature. Tokens are stored encrypted in ad_secrets.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret } from "./crypto.ts";
import { HttpError, reportError } from "./http.ts";

const GRAPH_BASE = Deno.env.get("WHATSAPP_GRAPH_BASE_URL") ?? "https://graph.facebook.com";
const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";
const MAX_ATTEMPTS = 6;

export interface AdSettings {
  organization_id: string;
  pixel_id: string | null;
  test_event_code: string | null;
  waba_id: string | null;
  ad_account_id: string | null;
  last_spend_sync_at: string | null;
  last_spend_error: string | null;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function tokens(admin: SupabaseClient, orgId: string) {
  const { data } = await admin.from("ad_secrets").select("capi_token_encrypted, ads_token_encrypted").eq("organization_id", orgId).maybeSingle();
  return {
    capi: data?.capi_token_encrypted ? await decryptSecret(data.capi_token_encrypted) : null,
    ads: data?.ads_token_encrypted ? await decryptSecret(data.ads_token_encrypted) : null,
  };
}

function graphError(body: unknown, status: number) {
  const e = (body as { error?: { message?: string; error_user_msg?: string } })?.error;
  return (e?.error_user_msg || e?.message || `HTTP ${status}`).slice(0, 300);
}

// One event to the pixel / dataset. Throws with Meta's message on failure.
export async function postEvents(pixelId: string, token: string, data: unknown[], testCode: string | null) {
  const res = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${pixelId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, access_token: token, ...(testCode ? { test_event_code: testCode } : {}) }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(502, graphError(body, res.status), "meta_error");
  return body as { events_received?: number; fbtrace_id?: string };
}

interface EventRow {
  id: number;
  organization_id: string;
  event_name: "Lead" | "Purchase" | "InitiateCheckout";
  event_id: string;
  lead_id: string | null;
  conversion_id: string | null;
  order_id: string | null;
  attempts: number;
  created_at: string;
}

// Builds the Conversions API event. Click-to-WhatsApp leads on an official
// number go as business messaging (Meta matches them by the ad click id);
// landing page leads as website events with the Facebook click and cookie;
// the rest as chat events with the hashed phone number.
async function buildEvent(admin: SupabaseClient, s: AdSettings, e: EventRow) {
  const { data: lead } = await admin
    .from("ad_leads")
    .select("id, created_at, source, channel_provider, ctwa_clid, source_url, contact:contacts(id, wa_id), click:ad_clicks(fbc, fbp, ip, user_agent, landing_url)")
    .eq("id", e.lead_id ?? "")
    .maybeSingle<{
      id: string;
      created_at: string;
      source: string;
      channel_provider: string | null;
      ctwa_clid: string | null;
      source_url: string | null;
      contact: { id: string; wa_id: string } | null;
      click: { fbc: string | null; fbp: string | null; ip: string | null; user_agent: string | null; landing_url: string | null } | null;
    }>();
  if (!lead) return null;

  let value: number | null = null;
  let currency = "IDR";
  let at = lead.created_at;
  if (e.conversion_id) {
    const { data: c } = await admin.from("ad_conversions").select("value, currency, occurred_at, cancelled_at").eq("id", e.conversion_id).maybeSingle();
    if (!c || c.cancelled_at) return null;
    value = Number(c.value);
    currency = c.currency;
    at = c.occurred_at;
  } else if (e.order_id) {
    const { data: o } = await admin.from("orders").select("total, currency, created_at").eq("id", e.order_id).maybeSingle();
    if (!o) return null;
    value = Number(o.total);
    currency = o.currency;
    at = o.created_at;
  }
  // Meta refuses events older than 7 days.
  const eventTime = Math.max(Math.floor(new Date(at).getTime() / 1000), Math.floor(Date.now() / 1000) - 6 * 86400);
  const custom = value !== null ? { custom_data: { currency, value } } : {};
  const phone = lead.contact?.wa_id && /^\d{8,15}$/.test(lead.contact.wa_id) ? lead.contact.wa_id : null;
  const externalId = lead.contact ? [await sha256(lead.contact.id)] : undefined;

  if (lead.source === "ctwa" && lead.ctwa_clid && s.waba_id && lead.channel_provider === "cloud_api") {
    return {
      event_name: e.event_name === "Lead" ? "LeadSubmitted" : e.event_name,
      event_time: eventTime,
      event_id: e.event_id,
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: { whatsapp_business_account_id: s.waba_id, ctwa_clid: lead.ctwa_clid },
      ...custom,
    };
  }
  const userData: Record<string, unknown> = { external_id: externalId };
  if (phone) userData.ph = [await sha256(phone)];
  if (lead.source === "link" && lead.click) {
    if (lead.click.fbc) userData.fbc = lead.click.fbc;
    if (lead.click.fbp) userData.fbp = lead.click.fbp;
    if (lead.click.ip) userData.client_ip_address = lead.click.ip;
    if (lead.click.user_agent) userData.client_user_agent = lead.click.user_agent;
    return {
      event_name: e.event_name,
      event_time: eventTime,
      event_id: e.event_id,
      action_source: "website",
      event_source_url: lead.click.landing_url ?? lead.source_url ?? undefined,
      user_data: userData,
      ...custom,
    };
  }
  return { event_name: e.event_name, event_time: eventTime, event_id: e.event_id, action_source: "chat", user_data: userData, ...custom };
}

// Sends the queued events (minute sweep).
export async function dispatchEvents(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("capi_claim", { p_limit: 100 });
  if (error) throw error;
  const events = (data ?? []) as EventRow[];
  if (!events.length) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  const byOrg = new Map<string, EventRow[]>();
  for (const e of events) byOrg.set(e.organization_id, [...(byOrg.get(e.organization_id) ?? []), e]);

  for (const [orgId, list] of byOrg) {
    const { data: s } = await admin.from("ad_settings").select("*").eq("organization_id", orgId).maybeSingle<AdSettings>();
    const { capi } = await tokens(admin, orgId).catch(() => ({ capi: null }));
    let lastError: string | null = null;
    for (const e of list) {
      try {
        if (!s?.pixel_id || !capi) {
          await admin.from("capi_events").update({ status: "skipped", last_error: "Pixel atau token belum diisi" }).eq("id", e.id);
          continue;
        }
        const event = await buildEvent(admin, s, e);
        if (!event) {
          await admin.from("capi_events").update({ status: "skipped", last_error: "Data tidak lagi ada" }).eq("id", e.id);
          continue;
        }
        await postEvents(s.pixel_id, capi, [event], s.test_event_code);
        await admin.from("capi_events").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", e.id);
        sent++;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!(err instanceof HttpError)) reportError("meta event failed", err);
        const final = e.attempts >= MAX_ATTEMPTS;
        if (final) failed++;
        await admin.from("capi_events").update({
          status: final ? "failed" : "pending",
          last_error: lastError.slice(0, 300),
          next_attempt_at: new Date(Date.now() + e.attempts * e.attempts * 60_000).toISOString(),
        }).eq("id", e.id);
      }
    }
    await admin.from("ad_settings").update({ last_event_at: new Date().toISOString(), last_event_error: lastError }).eq("organization_id", orgId);
  }
  return { sent, failed };
}

interface InsightRow {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  clicks?: string;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// Fetches daily spend per ad from the ad account into ad_spend.
export async function syncSpend(admin: SupabaseClient, s: AdSettings) {
  const { ads } = await tokens(admin, s.organization_id);
  if (!s.ad_account_id || !ads) throw new HttpError(400, "Isi ID akun iklan dan token akses dulu", "not_configured");
  // The last days change while Meta finalises them; the first (or a failed) sync goes back 30 days.
  const since = new Date(Date.now() - (s.last_spend_sync_at && !s.last_spend_error ? 3 : 30) * 86400_000);
  const params = new URLSearchParams({
    level: "ad",
    time_increment: "1",
    fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,inline_link_clicks",
    time_range: JSON.stringify({ since: isoDate(since), until: isoDate(new Date()) }),
    limit: "500",
    access_token: ads,
  });
  let next: string | null = `${GRAPH_BASE}/${GRAPH_VERSION}/${s.ad_account_id}/insights?${params}`;
  let rows = 0;
  for (let page = 0; next && page < 40; page++) {
    const res: Response = await fetch(next);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new HttpError(502, graphError(body, res.status), "meta_error");
    const data = (body?.data ?? []) as InsightRow[];
    if (data.length) {
      const { error } = await admin.from("ad_spend").upsert(
        data.map((r) => ({
          organization_id: s.organization_id,
          date: r.date_start,
          campaign_id: r.campaign_id ?? null,
          campaign_name: r.campaign_name ?? null,
          adset_id: r.adset_id ?? null,
          adset_name: r.adset_name ?? null,
          ad_id: r.ad_id ?? null,
          ad_name: r.ad_name ?? null,
          spend: Number(r.spend ?? 0),
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.inline_link_clicks ?? r.clicks ?? 0),
          manual: false,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "organization_id,date,ad_key" },
      );
      if (error) throw error;
      rows += data.length;
    }
    next = body?.paging?.next ?? null;
  }
  await admin.rpc("ad_backfill_names", { p_org: s.organization_id });
  await admin.from("ad_settings").update({ last_spend_sync_at: new Date().toISOString(), last_spend_error: null }).eq("organization_id", s.organization_id);
  return rows;
}

// Hourly per organization with an ad account (minute sweep).
export async function syncDueSpend(admin: SupabaseClient) {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { data } = await admin
    .from("ad_settings")
    .select("*")
    .not("ad_account_id", "is", null)
    .not("ads_token_hint", "is", null)
    .or(`last_spend_sync_at.is.null,last_spend_sync_at.lt.${hourAgo}`)
    .limit(10);
  let synced = 0;
  for (const s of (data ?? []) as AdSettings[]) {
    try {
      await syncSpend(admin, s);
      synced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!(err instanceof HttpError)) reportError("ad spend sync failed", err);
      // Try again in an hour, not every minute.
      await admin.from("ad_settings").update({ last_spend_error: message.slice(0, 300), last_spend_sync_at: new Date().toISOString() })
        .eq("organization_id", s.organization_id);
    }
  }
  return synced;
}
