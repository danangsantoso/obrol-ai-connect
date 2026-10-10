// Conversions sent back to the ad platforms (Meta Conversions API, Google
// Ads offline click conversions, TikTok Events API) and daily ad spend from
// each platform. Tokens are stored encrypted in ad_secrets.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret } from "./crypto.ts";
import { HttpError, reportError } from "./http.ts";
import {
  type GoogleAuth,
  googleAccessToken,
  googleSpend,
  googleUpload,
  type SpendRow,
  TIKTOK_EVENTS,
  tiktokEvents,
  tiktokSpend,
} from "./adplatforms.ts";

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
  google_customer_id: string | null;
  google_login_customer_id: string | null;
  google_lead_action_id: string | null;
  google_purchase_action_id: string | null;
  google_client_id: string | null;
  google_token_hint: string | null;
  google_spend_sync_at: string | null;
  google_spend_error: string | null;
  tiktok_pixel_code: string | null;
  tiktok_advertiser_id: string | null;
  tiktok_token_hint: string | null;
  tiktok_spend_sync_at: string | null;
  tiktok_spend_error: string | null;
}

export type Platform = "meta" | "google" | "tiktok";

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function tokens(admin: SupabaseClient, orgId: string) {
  const { data } = await admin.from("ad_secrets").select("*").eq("organization_id", orgId).maybeSingle();
  const dec = async (v: string | null | undefined) => (v ? await decryptSecret(v) : null);
  return {
    capi: await dec(data?.capi_token_encrypted),
    ads: await dec(data?.ads_token_encrypted),
    googleDeveloper: await dec(data?.google_developer_token_encrypted),
    googleSecret: await dec(data?.google_client_secret_encrypted),
    googleRefresh: await dec(data?.google_refresh_token_encrypted),
    tiktok: await dec(data?.tiktok_token_encrypted),
  };
}
type Tokens = Awaited<ReturnType<typeof tokens>>;

export function googleAuth(s: AdSettings, t: Tokens): GoogleAuth | null {
  if (!s.google_customer_id || !s.google_client_id || !t.googleSecret || !t.googleRefresh || !t.googleDeveloper) return null;
  return {
    customerId: s.google_customer_id,
    loginCustomerId: s.google_login_customer_id,
    clientId: s.google_client_id,
    clientSecret: t.googleSecret,
    refreshToken: t.googleRefresh,
    developerToken: t.googleDeveloper,
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
  platform: Platform;
  event_name: "Lead" | "Purchase" | "InitiateCheckout";
  event_id: string;
  lead_id: string | null;
  conversion_id: string | null;
  order_id: string | null;
  attempts: number;
  created_at: string;
}

interface LeadRow {
  id: string;
  created_at: string;
  source: string;
  channel_provider: string | null;
  ctwa_clid: string | null;
  gclid: string | null;
  ttclid: string | null;
  source_url: string | null;
  contact: { id: string; wa_id: string } | null;
  click: { fbc: string | null; fbp: string | null; ip: string | null; user_agent: string | null; landing_url: string | null } | null;
}

// The lead behind an event and the value / time of the closing, or null when
// it no longer exists (or the closing was cancelled).
async function eventData(admin: SupabaseClient, e: EventRow) {
  const { data: lead } = await admin
    .from("ad_leads")
    .select("id, created_at, source, channel_provider, ctwa_clid, gclid, ttclid, source_url, contact:contacts(id, wa_id), click:ad_clicks(fbc, fbp, ip, user_agent, landing_url)")
    .eq("id", e.lead_id ?? "")
    .maybeSingle<LeadRow>();
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
  const phone = lead.contact?.wa_id && /^\d{8,15}$/.test(lead.contact.wa_id) ? lead.contact.wa_id : null;
  return { lead, value, currency, at, phone };
}
type EventData = NonNullable<Awaited<ReturnType<typeof eventData>>>;

// Builds the Conversions API event. Click-to-WhatsApp leads on an official
// number go as business messaging (Meta matches them by the ad click id);
// landing page leads as website events with the Facebook click and cookie;
// the rest as chat events with the hashed phone number.
async function metaEvent(s: AdSettings, e: EventRow, d: EventData) {
  const { lead, value, currency, at, phone } = d;
  // Meta refuses events older than 7 days.
  const eventTime = Math.max(Math.floor(new Date(at).getTime() / 1000), Math.floor(Date.now() / 1000) - 6 * 86400);
  const custom = value !== null ? { custom_data: { currency, value } } : {};
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

// TikTok Events API: the TikTok click id and the hashed phone (E.164) / ids.
async function tiktokEvent(e: EventRow, d: EventData) {
  const { lead, value, currency, at, phone } = d;
  const user: Record<string, unknown> = {};
  if (lead.ttclid) user.ttclid = lead.ttclid;
  if (phone) user.phone = await sha256(`+${phone}`);
  if (lead.contact) user.external_id = await sha256(lead.contact.id);
  if (lead.click?.ip) user.ip = lead.click.ip;
  if (lead.click?.user_agent) user.user_agent = lead.click.user_agent;
  return {
    event: TIKTOK_EVENTS[e.event_name],
    event_time: Math.floor(new Date(at).getTime() / 1000),
    event_id: e.event_id,
    user,
    ...(lead.click?.landing_url || lead.source_url ? { page: { url: lead.click?.landing_url ?? lead.source_url } } : {}),
    ...(value !== null ? { properties: { currency, value } } : {}),
  };
}

// Per organization: settings, tokens and (for Google) an access token for the sweep.
interface OrgContext {
  s: AdSettings | null;
  t: Tokens | null;
  google?: { auth: GoogleAuth; accessToken: string } | null;
}

async function sendOne(admin: SupabaseClient, ctx: OrgContext, e: EventRow): Promise<"sent" | string> {
  const { s, t } = ctx;
  if (!s || !t) return "Pengaturan iklan belum diisi";
  if (e.platform === "meta" && (!s.pixel_id || !t.capi)) return "Pixel atau token belum diisi";
  if (e.platform === "tiktok" && (!s.tiktok_pixel_code || !t.tiktok)) return "Pixel atau token TikTok belum diisi";
  if (e.platform === "google") {
    if (ctx.google === undefined) {
      const auth = googleAuth(s, t);
      ctx.google = auth ? { auth, accessToken: await googleAccessToken(auth) } : null;
    }
    if (!ctx.google) return "Akun Google Ads belum lengkap";
  }
  const d = await eventData(admin, e);
  if (!d) return "Data tidak lagi ada";

  if (e.platform === "meta") {
    await postEvents(s.pixel_id!, t.capi!, [await metaEvent(s, e, d)], s.test_event_code);
  } else if (e.platform === "tiktok") {
    await tiktokEvents(s.tiktok_pixel_code!, t.tiktok!, [await tiktokEvent(e, d)], null);
  } else {
    const actionId = e.event_name === "Lead" ? s.google_lead_action_id : e.event_name === "Purchase" ? s.google_purchase_action_id : null;
    if (!actionId || !d.lead.gclid) return "Tanpa klik Google atau aksi konversi";
    await googleUpload(ctx.google!.auth, ctx.google!.accessToken, {
      clickId: d.lead.gclid,
      actionId,
      at: new Date(d.at),
      value: d.value,
      currency: d.currency,
      orderId: e.event_id,
    });
  }
  return "sent";
}

const EVENT_ERROR: Record<Platform, string> = { meta: "last_event_error", google: "google_event_error", tiktok: "tiktok_event_error" };

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
    const ctx: OrgContext = { s, t: await tokens(admin, orgId).catch(() => null) };
    const errors = new Map<Platform, string | null>();
    for (const e of list) {
      const platform = e.platform ?? "meta";
      try {
        const result = await sendOne(admin, ctx, e);
        if (result !== "sent") {
          await admin.from("capi_events").update({ status: "skipped", last_error: result }).eq("id", e.id);
          continue;
        }
        await admin.from("capi_events").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", e.id);
        if (!errors.has(platform)) errors.set(platform, null);
        sent++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.set(platform, message.slice(0, 300));
        if (!(err instanceof HttpError)) reportError("ad event failed", err);
        const final = e.attempts >= MAX_ATTEMPTS;
        if (final) failed++;
        await admin.from("capi_events").update({
          status: final ? "failed" : "pending",
          last_error: message.slice(0, 300),
          next_attempt_at: new Date(Date.now() + e.attempts * e.attempts * 60_000).toISOString(),
        }).eq("id", e.id);
      }
    }
    if (errors.size) {
      const patch: Record<string, unknown> = Object.fromEntries([...errors].map(([p, m]) => [EVENT_ERROR[p], m]));
      if (errors.has("meta")) patch.last_event_at = new Date().toISOString();
      await admin.from("ad_settings").update(patch).eq("organization_id", orgId);
    }
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

const SYNC_COLUMNS: Record<Platform, [string, string]> = {
  meta: ["last_spend_sync_at", "last_spend_error"],
  google: ["google_spend_sync_at", "google_spend_error"],
  tiktok: ["tiktok_spend_sync_at", "tiktok_spend_error"],
};

async function metaSpend(s: AdSettings, token: string, since: string, until: string): Promise<SpendRow[]> {
  const params = new URLSearchParams({
    level: "ad",
    time_increment: "1",
    fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,inline_link_clicks",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
    access_token: token,
  });
  let next: string | null = `${GRAPH_BASE}/${GRAPH_VERSION}/${s.ad_account_id}/insights?${params}`;
  const rows: SpendRow[] = [];
  for (let page = 0; next && page < 40; page++) {
    const res: Response = await fetch(next);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new HttpError(502, graphError(body, res.status), "meta_error");
    for (const r of (body?.data ?? []) as InsightRow[]) {
      rows.push({
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
      });
    }
    next = body?.paging?.next ?? null;
  }
  return rows;
}

// Fetches daily spend per ad from one platform into ad_spend.
export async function syncSpend(admin: SupabaseClient, s: AdSettings, platform: Platform = "meta") {
  const t = await tokens(admin, s.organization_id);
  const [syncedAt, syncError] = SYNC_COLUMNS[platform];
  const last = (s as unknown as Record<string, string | null>)[syncedAt];
  const failed = (s as unknown as Record<string, string | null>)[syncError];
  // The last days change while the platform finalises them; the first (or a failed) sync goes back 30 days.
  const since = isoDate(new Date(Date.now() - (last && !failed ? 3 : 29) * 86400_000));
  const until = isoDate(new Date());
  let rows: SpendRow[];
  if (platform === "meta") {
    if (!s.ad_account_id || !t.ads) throw new HttpError(400, "Isi ID akun iklan dan token akses dulu", "not_configured");
    rows = await metaSpend(s, t.ads, since, until);
  } else if (platform === "google") {
    const auth = googleAuth(s, t);
    if (!auth) throw new HttpError(400, "Lengkapi akun Google Ads dulu (customer ID, client ID/secret, refresh token, developer token)", "not_configured");
    rows = await googleSpend(auth, since, until);
  } else {
    if (!s.tiktok_advertiser_id || !t.tiktok) throw new HttpError(400, "Isi Advertiser ID dan token TikTok dulu", "not_configured");
    rows = await tiktokSpend(s.tiktok_advertiser_id, t.tiktok, since, until);
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("ad_spend").upsert(
      rows.slice(i, i + 500).map((r) => ({ ...r, organization_id: s.organization_id, platform, manual: false, updated_at: new Date().toISOString() })),
      { onConflict: "organization_id,platform,date,ad_key" },
    );
    if (error) throw error;
  }
  await admin.rpc("ad_backfill_names", { p_org: s.organization_id });
  await admin.from("ad_settings").update({ [syncedAt]: new Date().toISOString(), [syncError]: null }).eq("organization_id", s.organization_id);
  return rows.length;
}

// Hourly per organization and platform with an ad account (minute sweep).
export async function syncDueSpend(admin: SupabaseClient) {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const due: [Platform, string, string][] = [
    ["meta", "ad_account_id", "ads_token_hint"],
    ["google", "google_customer_id", "google_token_hint"],
    ["tiktok", "tiktok_advertiser_id", "tiktok_token_hint"],
  ];
  let synced = 0;
  for (const [platform, account, hint] of due) {
    const [syncedAt, syncError] = SYNC_COLUMNS[platform];
    const { data } = await admin
      .from("ad_settings")
      .select("*")
      .not(account, "is", null)
      .not(hint, "is", null)
      .or(`${syncedAt}.is.null,${syncedAt}.lt.${hourAgo}`)
      .limit(10);
    for (const s of (data ?? []) as AdSettings[]) {
      try {
        await syncSpend(admin, s, platform);
        synced++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!(err instanceof HttpError)) reportError("ad spend sync failed", err);
        // Try again in an hour, not every minute.
        await admin.from("ad_settings").update({ [syncError]: message.slice(0, 300), [syncedAt]: new Date().toISOString() })
          .eq("organization_id", s.organization_id);
      }
    }
  }
  return synced;
}
