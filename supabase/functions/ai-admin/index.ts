// Stores or removes the organization's AI provider API key (encrypted), and
// checks that the provider answers with the saved settings. Admins only.
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, requireMember } from "../_shared/supabase.ts";
import { encryptSecret } from "../_shared/crypto.ts";
import { loadAi } from "../_shared/ai.ts";
import { complete, LlmError } from "../_shared/llm.ts";

interface AdminRequest {
  action: "set_key" | "clear_key" | "check";
  api_key?: string;
}

serveJson(async (req) => {
  const admin = adminClient();
  const member = await requireMember(req, admin, ["admin"]);
  const input = await readJson<AdminRequest>(req);
  const orgId = member.organization_id;

  if (input.action === "set_key") {
    const key = input.api_key?.trim() ?? "";
    if (key.length < 8 || key.length > 500) throw new HttpError(400, "API key tidak valid", "invalid_request");
    const { error } = await admin.from("ai_secrets").upsert({
      organization_id: orgId,
      api_key_encrypted: await encryptSecret(key),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    const { error: hintError } = await admin
      .from("ai_settings")
      .upsert({ organization_id: orgId, api_key_hint: `…${key.slice(-4)}` }, { onConflict: "organization_id" });
    if (hintError) throw hintError;
    return json({ api_key_hint: `…${key.slice(-4)}` });
  }

  if (input.action === "clear_key") {
    await admin.from("ai_secrets").delete().eq("organization_id", orgId);
    await admin.from("ai_settings").update({ api_key_hint: null, enabled: false }).eq("organization_id", orgId);
    return json({ api_key_hint: null });
  }

  if (input.action === "check") {
    const ai = await loadAi(admin, orgId);
    const started = Date.now();
    try {
      const result = await complete(
        ai.llm,
        'Ini uji koneksi. Balas dengan JSON {"reply": "OK", "handoff": false, "reason": ""}.',
        [{ role: "user", content: "Tes koneksi Balas.id" }],
      );
      return json({ ok: true, provider: ai.llm.provider, model: ai.llm.model, latency_ms: Date.now() - started, sample: result.text.slice(0, 200) });
    } catch (err) {
      if (err instanceof LlmError) throw new HttpError(502, err.message, "ai_error");
      throw err;
    }
  }

  throw new HttpError(400, "Unknown action", "invalid_request");
});
