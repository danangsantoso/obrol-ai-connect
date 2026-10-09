// Meta ad tracking.
//  sweep       - send queued Conversions API events and fetch ad spend hourly
//                (service role; cron every minute, see deploy/scripts/ai-sweep.sh)
//  save_tokens - admin stores the Conversions API token and/or the ad account
//                token (encrypted; only the last 4 characters are shown)
//  test_event  - admin sends a test event (Events Manager → Test events)
//  sync_spend  - admin fetches the ad spend now
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, audit, isServiceRole, requireMember } from "../_shared/supabase.ts";
import { encryptSecret } from "../_shared/crypto.ts";
import { type AdSettings, dispatchEvents, postEvents, syncDueSpend, syncSpend, tokens } from "../_shared/capi.ts";

interface Input {
  action: "sweep" | "save_tokens" | "test_event" | "sync_spend";
  capi_token?: string | null;
  ads_token?: string | null;
  test_event_code?: string;
}

const TOKEN = /^[A-Za-z0-9_|.-]{20,1000}$/;

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
    for (const [field, column, hint] of [["capi_token", "capi_token_encrypted", "capi_token_hint"], ["ads_token", "ads_token_encrypted", "ads_token_hint"]] as const) {
      const value = input[field];
      if (value === undefined) continue;
      if (value === null || value.trim() === "") {
        secrets[column] = null;
        hints[hint] = null;
        continue;
      }
      const token = value.trim();
      if (!TOKEN.test(token)) throw new HttpError(400, "Token tidak valid. Salin ulang dari Meta tanpa spasi.", "invalid_request");
      secrets[column] = await encryptSecret(token);
      hints[hint] = `…${token.slice(-4)}`;
    }
    if (!Object.keys(secrets).length) throw new HttpError(400, "Tidak ada token yang diisi", "invalid_request");
    const { error } = await admin.from("ad_secrets").upsert({ organization_id: orgId, ...secrets, updated_at: new Date().toISOString() });
    if (error) throw error;
    const { error: hintError } = await admin.from("ad_settings").upsert({ organization_id: orgId, ...hints, updated_at: new Date().toISOString() });
    if (hintError) throw hintError;
    await audit(admin, member, "update", "ad_settings", null,
      Object.fromEntries(Object.entries(hints).map(([k, v]) => [k, { from: "•••", to: v }])));
    return json(hints);
  }

  if (input.action === "test_event") {
    const { capi } = await tokens(admin, orgId);
    if (!settings?.pixel_id || !capi) throw new HttpError(400, "Isi Pixel ID dan token Conversions API dulu", "not_configured");
    const code = (input.test_event_code ?? settings.test_event_code ?? "").trim();
    if (!code) throw new HttpError(400, "Isi kode uji dari Events Manager → Uji event", "invalid_request");
    const result = await postEvents(settings.pixel_id, capi, [{
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      event_id: `test-${crypto.randomUUID()}`,
      action_source: "chat",
      user_data: { external_id: ["balas-test"] },
    }], code);
    return json({ ok: true, events_received: result.events_received ?? 0, fbtrace_id: result.fbtrace_id ?? null });
  }

  if (input.action === "sync_spend") {
    if (!settings) throw new HttpError(400, "Isi ID akun iklan dan token akses dulu", "not_configured");
    try {
      const rows = await syncSpend(admin, settings);
      return json({ rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.from("ad_settings").update({ last_spend_error: message.slice(0, 300) }).eq("organization_id", orgId);
      throw err;
    }
  }

  throw new HttpError(400, "Unknown action", "invalid_request");
});
