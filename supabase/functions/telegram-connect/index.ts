// Connects a Telegram bot (token from @BotFather) as a channel, or disconnects it. Admins only.
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, requireMember } from "../_shared/supabase.ts";
import { decryptSecret, encryptSecret } from "../_shared/crypto.ts";
import { deleteWebhook, getMe, setWebhook } from "../_shared/telegram.ts";
import { quotaError } from "../_shared/plans.ts";

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

serveJson(async (req) => {
  const admin = adminClient();
  const member = await requireMember(req, admin, ["admin"]);
  const input = await readJson<{ action: "connect" | "disconnect"; bot_token?: string; channel_id?: string }>(req);

  if (input.action === "connect") {
    const token = input.bot_token?.trim() ?? "";
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      throw new HttpError(400, "Format token bot tidak valid. Contoh: 123456789:AAH…", "invalid_request");
    }
    const publicApi = Deno.env.get("PUBLIC_API_URL");
    if (!publicApi) throw new HttpError(500, "PUBLIC_API_URL is not configured", "not_configured");
    const bot = await getMe(token);

    const { data: existing } = await admin
      .from("channels")
      .select("id, organization_id")
      .eq("provider", "telegram")
      .eq("external_id", String(bot.id))
      .maybeSingle();
    if (existing && existing.organization_id !== member.organization_id) {
      throw new HttpError(409, `@${bot.username} sudah terhubung ke organisasi lain.`, "already_connected");
    }
    const fields = {
      name: `@${bot.username}`,
      external_username: bot.username,
      is_active: true,
      connection_status: "connected",
      connection_updated_at: new Date().toISOString(),
    };
    let channelId = existing?.id as string | undefined;
    if (channelId) {
      const { error } = await admin.from("channels").update(fields).eq("id", channelId);
      if (error) throw error;
    } else {
      const { data, error } = await admin
        .from("channels")
        .insert({ organization_id: member.organization_id, provider: "telegram", external_id: String(bot.id), ...fields })
        .select("id")
        .single();
      if (error) throw quotaError(error) ?? error;
      channelId = data.id;
    }

    const secret = randomHex(24);
    const { error } = await admin.from("channel_secrets").upsert({
      channel_id: channelId,
      access_token_encrypted: await encryptSecret(token),
      webhook_secret: secret,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    await setWebhook(token, `${publicApi.replace(/\/$/, "")}/functions/v1/telegram-webhook?channel=${channelId}`, secret);
    return json({ channel_id: channelId, username: bot.username });
  }

  if (input.action === "disconnect") {
    const { data: ch } = await admin
      .from("channels")
      .select("id, provider")
      .eq("id", input.channel_id ?? "")
      .eq("organization_id", member.organization_id)
      .maybeSingle();
    if (!ch || ch.provider !== "telegram") throw new HttpError(404, "Channel not found", "not_found");
    const { data: secret } = await admin.from("channel_secrets").select("access_token_encrypted").eq("channel_id", ch.id).maybeSingle();
    if (secret?.access_token_encrypted) {
      await deleteWebhook(await decryptSecret(secret.access_token_encrypted)).catch((err) => console.warn("deleteWebhook failed", err));
    }
    await admin.from("channel_secrets").delete().eq("channel_id", ch.id);
    await admin.from("channels").update({ is_active: false, connection_status: "disconnected" }).eq("id", ch.id);
    return json({ disconnected: true });
  }

  throw new HttpError(400, "Unknown action", "invalid_request");
});
