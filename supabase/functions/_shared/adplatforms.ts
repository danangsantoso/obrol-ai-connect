// Google Ads and TikTok Ads: conversions sent back to the platform and daily
// spend per ad. Meta lives in capi.ts, which also drives these.
import { HttpError } from "./http.ts";

const GOOGLE_ADS_BASE = Deno.env.get("GOOGLE_ADS_API_BASE") ?? "https://googleads.googleapis.com";
const GOOGLE_ADS_VERSION = Deno.env.get("GOOGLE_ADS_API_VERSION") ?? "v22";
const GOOGLE_OAUTH_BASE = Deno.env.get("GOOGLE_OAUTH_BASE") ?? "https://oauth2.googleapis.com";
const TIKTOK_BASE = Deno.env.get("TIKTOK_API_BASE") ?? "https://business-api.tiktok.com";

// Rows for ad_spend (platform, organization and timestamps are added by the caller).
export interface SpendRow {
  date: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
}

async function call(name: string, url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
  } catch (err) {
    throw new HttpError(502, `${name} tidak bisa dihubungi: ${(err as Error).message}`, "ads_error");
  }
  const body = await res.json().catch(() => null);
  return { res, body };
}

// ---------------------------------------------------------------------------
// Google Ads
// ---------------------------------------------------------------------------
export interface GoogleAuth {
  customerId: string;
  loginCustomerId: string | null;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
}

function googleError(body: unknown, status: number) {
  const e = (body as { error?: { message?: string; details?: { errors?: { message?: string }[] }[] } })?.error;
  const detail = e?.details?.flatMap((d) => d.errors ?? []).map((x) => x.message).filter(Boolean).join("; ");
  return `Google Ads: ${(detail || e?.message || `HTTP ${status}`)}`.slice(0, 300);
}

export async function googleAccessToken(a: GoogleAuth) {
  const { res, body } = await call("Google", `${GOOGLE_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: a.clientId, client_secret: a.clientSecret, refresh_token: a.refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok || !body?.access_token) {
    throw new HttpError(502, `Google: ${body?.error_description ?? body?.error ?? `HTTP ${res.status}`} (cek client ID, secret dan refresh token)`.slice(0, 300), "ads_error");
  }
  return body.access_token as string;
}

function googleHeaders(a: GoogleAuth, accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": a.developerToken,
    "Content-Type": "application/json",
    ...(a.loginCustomerId ? { "login-customer-id": a.loginCustomerId } : {}),
  };
}

// "2026-10-09 13:45:00+00:00", the format Google wants.
const googleTime = (d: Date) => `${d.toISOString().slice(0, 19).replace("T", " ")}+00:00`;

export interface GoogleConversion {
  clickId: string;
  actionId: string;
  at: Date;
  value: number | null;
  currency: string;
  orderId: string;
}

// One offline click conversion. gbraid / wbraid clicks (iOS) are stored as "gbraid:…" / "wbraid:…".
export async function googleUpload(a: GoogleAuth, accessToken: string, c: GoogleConversion, validateOnly = false) {
  const [kind, id] = /^(gbraid|wbraid):/.test(c.clickId) ? [c.clickId.slice(0, 6), c.clickId.slice(7)] : ["gclid", c.clickId];
  const conversion: Record<string, unknown> = {
    [kind]: id,
    conversionAction: `customers/${a.customerId}/conversionActions/${c.actionId}`,
    conversionDateTime: googleTime(c.at),
    orderId: c.orderId,
  };
  if (c.value !== null) {
    conversion.conversionValue = c.value;
    conversion.currencyCode = c.currency;
  }
  const { res, body } = await call("Google Ads", `${GOOGLE_ADS_BASE}/${GOOGLE_ADS_VERSION}/customers/${a.customerId}:uploadClickConversions`, {
    method: "POST",
    headers: googleHeaders(a, accessToken),
    body: JSON.stringify({ conversions: [conversion], partialFailure: true, validateOnly }),
  });
  if (!res.ok) throw new HttpError(502, googleError(body, res.status), "ads_error");
  if (body?.partialFailureError?.message) throw new HttpError(502, `Google Ads: ${body.partialFailureError.message}`.slice(0, 300), "ads_error");
}

interface GoogleRow {
  segments?: { date?: string };
  campaign?: { id?: string; name?: string };
  adGroup?: { id?: string; name?: string };
  adGroupAd?: { ad?: { id?: string; name?: string } };
  metrics?: { costMicros?: string; impressions?: string; clicks?: string };
}

export async function googleSpend(a: GoogleAuth, since: string, until: string): Promise<SpendRow[]> {
  const accessToken = await googleAccessToken(a);
  const query = `SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name,
    metrics.cost_micros, metrics.impressions, metrics.clicks FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  const rows: SpendRow[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 40; page++) {
    const { res, body } = await call("Google Ads", `${GOOGLE_ADS_BASE}/${GOOGLE_ADS_VERSION}/customers/${a.customerId}/googleAds:search`, {
      method: "POST",
      headers: googleHeaders(a, accessToken),
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    });
    if (!res.ok) throw new HttpError(502, googleError(body, res.status), "ads_error");
    for (const r of (body?.results ?? []) as GoogleRow[]) {
      if (!r.segments?.date) continue;
      rows.push({
        date: r.segments.date,
        campaign_id: r.campaign?.id ?? null,
        campaign_name: r.campaign?.name ?? null,
        adset_id: r.adGroup?.id ?? null,
        adset_name: r.adGroup?.name ?? null,
        ad_id: r.adGroupAd?.ad?.id ?? null,
        ad_name: r.adGroupAd?.ad?.name || null,
        spend: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks: Number(r.metrics?.clicks ?? 0),
      });
    }
    pageToken = body?.nextPageToken;
    if (!pageToken) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------
export const TIKTOK_EVENTS: Record<string, string> = { Lead: "SubmitForm", Purchase: "CompletePayment", InitiateCheckout: "InitiateCheckout" };

function tiktokCheck(name: string, res: Response, body: { code?: number; message?: string } | null) {
  if (!res.ok || !body || body.code !== 0) {
    throw new HttpError(502, `${name}: ${body?.message ?? `HTTP ${res.status}`}`.slice(0, 300), "ads_error");
  }
}

export async function tiktokEvents(pixelCode: string, token: string, data: unknown[], testCode: string | null) {
  const { res, body } = await call("TikTok", `${TIKTOK_BASE}/open_api/v1.3/event/track/`, {
    method: "POST",
    headers: { "Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ event_source: "web", event_source_id: pixelCode, data, ...(testCode ? { test_event_code: testCode } : {}) }),
  });
  tiktokCheck("TikTok", res, body);
}

interface TiktokRow {
  dimensions?: { ad_id?: string; stat_time_day?: string };
  metrics?: Record<string, string>;
}

export async function tiktokSpend(advertiserId: string, token: string, since: string, until: string): Promise<SpendRow[]> {
  const rows: SpendRow[] = [];
  for (let page = 1; page <= 40; page++) {
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_AD",
      dimensions: JSON.stringify(["ad_id", "stat_time_day"]),
      metrics: JSON.stringify(["spend", "impressions", "clicks", "campaign_id", "campaign_name", "adgroup_id", "adgroup_name", "ad_name"]),
      start_date: since,
      end_date: until,
      page: String(page),
      page_size: "1000",
    });
    const { res, body } = await call("TikTok", `${TIKTOK_BASE}/open_api/v1.3/report/integrated/get/?${params}`, {
      headers: { "Access-Token": token },
    });
    tiktokCheck("TikTok", res, body);
    for (const r of (body?.data?.list ?? []) as TiktokRow[]) {
      const m = r.metrics ?? {};
      const date = r.dimensions?.stat_time_day?.slice(0, 10);
      if (!date) continue;
      rows.push({
        date,
        campaign_id: m.campaign_id || null,
        campaign_name: m.campaign_name || null,
        adset_id: m.adgroup_id || null,
        adset_name: m.adgroup_name || null,
        ad_id: r.dimensions?.ad_id ?? null,
        ad_name: m.ad_name || null,
        spend: Number(m.spend ?? 0),
        impressions: Number(m.impressions ?? 0),
        clicks: Number(m.clicks ?? 0),
      });
    }
    if (page >= Number(body?.data?.page_info?.total_page ?? 1)) break;
  }
  return rows;
}
