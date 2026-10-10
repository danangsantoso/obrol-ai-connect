// Ad tracking (Meta, Google Ads, TikTok).
//  sweep       - send queued conversion events and fetch ad spend hourly
//                (service role; cron every minute, see deploy/scripts/ai-sweep.sh)
//  save_tokens - admin stores tokens: Meta Conversions API / ad account,
//                Google Ads developer token / OAuth client secret / refresh
//                token, TikTok access token (encrypted; only the last 4
//                characters are shown)
//  test_event  - admin sends a test event (Meta: Events Manager → Test events,
//                TikTok: Events Manager → Test events, Google: checks the
//                account and conversion action without recording anything)
//  sync_spend  - admin fetches the ad spend of a platform now
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, audit, isServiceRole, requireMember } from "../_shared/supabase.ts";
import { encryptSecret } from "../_shared/crypto.ts";
import { type AdSettings, dispatchEvents, googleAuth, type Platform, postEvents, syncDueSpend, syncSpend, tokens } from "../_shared/capi.ts";
import { googleAccessToken, googleUpload, tiktokEvents } from "../_shared/adplatforms.ts";

const FIELDS = {
  capi_token: ["capi_token_encrypted", "capi_token_hint"],
  ads_token: ["ads_token_encrypted", "ads_token_hint"],
  google_developer_token: ["google_developer_token_encrypted", "google_developer_hint"],
  google_client_secret: ["google_client_secret_encrypted", "google_secret_hint"],
  google_refresh_token: ["google_refresh_token_encrypted", "google_token_hint"],
  tiktok_token: ["tiktok_token_encrypted", "tiktok_token_hint"],
} as const;

type Input = { [K in keyof typeof FIELDS]?: string | null } & {
  action: "sweep" | "save_tokens" | "test_event" | "sync_spend";
  platform?: Platform;
  test_event_code?: string;
};

const TOKEN = /^[A-Za-z0-9_|./~+=-]{16,1000}$/;
const PLATFORMS: Platform[] = ["meta", "google", "tiktok"];

serveJson(async (req) => {
  const input = await readJson<Input>(req);
  const admin = adminClient();

  if (input.action === "sweep") {
    if (!isServiceRole(req)) throw new HttpError(401, "Service role required", "unauthorized");
    const events = await dispatchEvents(admin);
    const spend = await syncDueSpend(admin);
    return json({ events, spend_synced: spend });
  }

  const member = await requireMember(req, admin, ["admin"]);
  const orgId = member.organization_id;
  const { data: settings } = await admin.from("ad_settings").select("*").eq("organization_id", orgId).maybeSingle<AdSettings>();

  if (input.action === "save_tokens") {
    const secrets: Record<string, string | null> = {};
    const hints: Record<string, string | null> = {};
    for (const [field, [column, hint]] of Object.entries(FIELDS)) {
      const value = input[field as keyof typeof FIELDS];
      if (value === undefined) continue;
      if (value === null || value.trim() === "") {
        secrets[column] = null;
        hints[hint] = null;
        continue;
      }
      const token = value.trim();
      if (!TOKEN.test(token)) throw new HttpError(400, "Token tidak valid. Salin ulang tanpa spasi.", "invalid_request");
      secrets[column] = await encryptSecret(token);
      hints[hint] = `…${token.slice(-4)}`;
    }
    if (!Object.keys(secrets).length) throw new HttpError(400, "Tidak ada token yang diisi", "invalid_request");
    const { error } = await admin.from("ad_secrets").upsert({ organization_id: orgId, ...secrets, updated_at: new Date().toISOString() });
    if (error) throw error;
    const { error: hintError } = await admin.from("ad_settings").upsert({ organization_id: orgId, ...hints, updated_at: new Date().toISOString() });
    if (hintError) throw hintError;
    await audit(admin, member, "update", "ad_settings", null,
      Object.fromEntries(Object.keys(secrets).map((k) => [k.replace(/_encrypted$/, ""), { from: "•••", to: "•••" }])));
    return json(hints);
  }

  const platform = input.platform ?? "meta";
  if (!PLATFORMS.includes(platform)) throw new HttpError(400, "Unknown platform", "invalid_request");

  if (input.action === "test_event") {
    const t = await tokens(admin, orgId);
    const code = (input.test_event_code ?? (platform === "meta" ? settings?.test_event_code : null) ?? "").trim();
    if (platform === "google") {
      const auth = settings ? googleAuth(settings, t) : null;
      if (!auth || !settings?.google_lead_action_id) throw new HttpError(400, "Lengkapi akun Google Ads dan ID aksi konversi Lead dulu", "not_configured");
      // validateOnly: Google checks the account and the conversion action; a made-up click id is expected to be refused.
      try {
        await googleUpload(auth, await googleAccessToken(auth), {
          clickId: "balas-test", actionId: settings.google_lead_action_id, at: new Date(), value: null, currency: "IDR", orderId: `test-${crypto.randomUUID()}`,
        }, true);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/gclid|click|UNPARSEABLE|INVALID_CLICK/i.test(message)) throw err;
      }
      return json({ ok: true });
    }
    if (!code) throw new HttpError(400, "Isi kode uji dari Events Manager → Uji event", "invalid_request");
    const event = { event_id: `test-${crypto.randomUUID()}`, event_time: Math.floor(Date.now() / 1000) };
    if (platform === "tiktok") {
      if (!settings?.tiktok_pixel_code || !t.tiktok) throw new HttpError(400, "Isi Pixel Code dan token TikTok dulu", "not_configured");
      await tiktokEvents(settings.tiktok_pixel_code, t.tiktok, [{ ...event, event: "SubmitForm", user: { external_id: "balas-test" } }], code);
      return json({ ok: true });
    }
    if (!settings?.pixel_id || !t.capi) throw new HttpError(400, "Isi Pixel ID dan token Conversions API dulu", "not_configured");
    const result = await postEvents(settings.pixel_id, t.capi, [{ ...event, event_name: "Lead", action_source: "chat", user_data: { external_id: ["balas-test"] } }], code);
    return json({ ok: true, events_received: result.events_received ?? 0, fbtrace_id: result.fbtrace_id ?? null });
  }

  if (input.action === "sync_spend") {
    if (!settings) throw new HttpError(400, "Isi akun iklan dan token dulu", "not_configured");
    const errorColumn = { meta: "last_spend_error", google: "google_spend_error", tiktok: "tiktok_spend_error" }[platform];
    try {
      const rows = await syncSpend(admin, settings, platform);
      return json({ rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.from("ad_settings").update({ [errorColumn]: message.slice(0, 300) }).eq("organization_id", orgId);
      throw err;
    }
  }

  throw new HttpError(400, "Unknown action", "invalid_request");
});
