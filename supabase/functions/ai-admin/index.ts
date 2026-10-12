// Stores or removes the organization's AI provider API key (encrypted), and
// checks that the provider answers with the saved settings. Admins only.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, audit, requireMember } from "../_shared/supabase.ts";
import { encryptSecret } from "../_shared/crypto.ts";
import { loadAi } from "../_shared/ai.ts";
import { complete, LlmError } from "../_shared/llm.ts";

interface AdminRequest {
  action: "set_key" | "clear_key" | "check";
  api_key?: string;
  // "stt" = the speech-to-text key (voice notes); default the chat model's key.
  kind?: "chat" | "stt";
  // Panggilan server (service role): tenant yang diuji.
  organization_id?: string;
  // Hanya untuk panggilan server: paksa model utama supaya lapis cadangan terbukti.
  force_model?: string;
}

// Uji koneksi AI. Mengembalikan model yang benar-benar menjawab sehingga lapis
// cadangan bisa dibuktikan bekerja, bukan hanya diklaim.
async function checkAi(admin: SupabaseClient, orgId: string, forceModel?: string) {
  if (!orgId) throw new HttpError(400, "organization_id wajib untuk panggilan server", "invalid_request");
  const ai = await loadAi(admin, orgId);
  const target = forceModel ? { ...ai.llm, model: forceModel } : ai.llm;
  const started = Date.now();
  try {
    const result = await complete(
      target,
      'Ini uji koneksi. Balas dengan JSON {"reply": "OK", "handoff": false, "reason": ""}.',
      [{ role: "user", content: "Tes koneksi Balas.id" }],
    );
    return json({
      ok: true,
      provider: result.provider ?? target.provider,
      model: result.model ?? target.model,
      layer_used: result.layer ?? 1,
      layers: 1 + (target.fallbacks?.length ?? 0),
      latency_ms: Date.now() - started,
      sample: result.text.slice(0, 200),
    });
  } catch (err) {
    if (err instanceof LlmError) throw new HttpError(502, err.message, "ai_error");
    throw err;
  }
}

serveJson(async (req) => {
  const admin = adminClient();
  const input = await readJson<AdminRequest>(req);

  // Skrip pemeliharaan di server (uji lapis model) memakai service role key,
  // karena saat tidak ada admin yang login pun model harus bisa diuji.
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (bearer && serviceKey && bearer === serviceKey) {
    if (input.action !== "check") {
      throw new HttpError(403, "Panggilan server hanya boleh memakai action check", "forbidden");
    }
    return await checkAi(admin, String(input.organization_id ?? ""), input.force_model);
  }

  const member = await requireMember(req, admin, ["admin"]);
  const orgId = member.organization_id;

  const stt = input.kind === "stt";
  const secretColumn = stt ? "stt_api_key_encrypted" : "api_key_encrypted";
  const hintColumn = stt ? "stt_key_hint" : "api_key_hint";

  if (input.action === "set_key") {
    const key = input.api_key?.trim() ?? "";
    if (key.length < 8 || key.length > 500) throw new HttpError(400, "API key tidak valid", "invalid_request");
    const { error } = await admin.from("ai_secrets").upsert({
      organization_id: orgId,
      [secretColumn]: await encryptSecret(key),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    const { error: hintError } = await admin
      .from("ai_settings")
      .upsert({ organization_id: orgId, [hintColumn]: `…${key.slice(-4)}` }, { onConflict: "organization_id" });
    if (hintError) throw hintError;
    await audit(admin, member, "update", "ai_settings", null, { [hintColumn]: { from: "•••", to: `…${key.slice(-4)}` } });
    return json({ [hintColumn]: `…${key.slice(-4)}`, api_key_hint: stt ? undefined : `…${key.slice(-4)}` });
  }

  if (input.action === "clear_key") {
    await admin.from("ai_secrets").update({ [secretColumn]: null }).eq("organization_id", orgId);
    await admin.from("ai_settings")
      .update(stt ? { stt_key_hint: null } : { api_key_hint: null, enabled: false })
      .eq("organization_id", orgId);
    await audit(admin, member, "update", "ai_settings", null, { [hintColumn]: { from: "•••", to: null } });
    return json({ [hintColumn]: null });
  }

  if (input.action === "check") {
    return await checkAi(admin, orgId);
  }

  throw new HttpError(400, "Unknown action", "invalid_request");
});
