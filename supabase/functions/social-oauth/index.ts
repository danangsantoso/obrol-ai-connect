// "Login with Facebook" for Messenger and Instagram channels.
//  POST start       -> Facebook login URL (admins)
//  GET  ?code&state -> Facebook redirects here; tokens are exchanged and the
//                      admin's Pages (with linked Instagram accounts) remembered
//  POST pages       -> Pages found, to pick from (admins)
//  POST connect     -> creates channels for the picked Pages / Instagram accounts
//  POST disconnect  -> stops a channel and removes its token
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, audit, requireMember } from "../_shared/supabase.ts";
import { decryptSecret, encryptSecret } from "../_shared/crypto.ts";
import { dialogUrl, exchangeCode, listPages, subscribePage, unsubscribePage } from "../_shared/meta.ts";
import { quotaError } from "../_shared/plans.ts";

interface StoredPage {
  id: string;
  name: string;
  token: string; // encrypted
  instagram: { id: string; username: string | null; avatar: string | null } | null;
}

const STATE_TTL_MS = 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return await callback(req);
  if (req.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST" } }, 405);
  try {
    return await action(req);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: { code: err.code, message: err.message } }, err.status);
    console.error(err);
    return json({ error: { code: "internal", message: "Internal error" } }, 500);
  }
});

function appUrl(path: string): string {
  return `${(Deno.env.get("APP_URL") ?? "").replace(/\/$/, "")}${path}`;
}

function redirect(path: string): Response {
  return new Response(null, { status: 302, headers: { Location: appUrl(path) } });
}

async function callback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const admin = adminClient();
  const { data: row } = await admin.from("oauth_states").select("state, created_at").eq("state", state).maybeSingle();
  if (!row || Date.now() - new Date(row.created_at).getTime() > STATE_TTL_MS) {
    return redirect(`/settings?social_error=${encodeURIComponent("Sesi login kedaluwarsa, coba lagi.")}`);
  }

  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (denied || !code) {
    await admin.from("oauth_states").delete().eq("state", state);
    return redirect(`/settings?social_error=${encodeURIComponent(denied ?? "Login Facebook dibatalkan.")}`);
  }

  try {
    const userToken = await exchangeCode(code);
    const pages = await listPages(userToken);
    const stored: StoredPage[] = [];
    for (const p of pages) {
      stored.push({
        id: p.id,
        name: p.name,
        token: await encryptSecret(p.access_token),
        instagram: p.instagram_business_account
          ? {
            id: p.instagram_business_account.id,
            username: p.instagram_business_account.username ?? null,
            avatar: p.instagram_business_account.profile_picture_url ?? null,
          }
          : null,
      });
    }
    await admin.from("oauth_states").update({ result: { pages: stored } }).eq("state", state);
    return redirect(`/settings?social=${encodeURIComponent(state)}`);
  } catch (err) {
    console.error("facebook login failed", err);
    const message = err instanceof HttpError ? err.message : "Login Facebook gagal.";
    await admin.from("oauth_states").delete().eq("state", state);
    return redirect(`/settings?social_error=${encodeURIComponent(message)}`);
  }
}

async function loadState(admin: SupabaseClient, state: string, orgId: string): Promise<StoredPage[]> {
  const { data } = await admin
    .from("oauth_states")
    .select("organization_id, result, created_at")
    .eq("state", state ?? "")
    .maybeSingle();
  if (!data || data.organization_id !== orgId || Date.now() - new Date(data.created_at).getTime() > STATE_TTL_MS) {
    throw new HttpError(404, "Sesi login Facebook tidak ditemukan atau kedaluwarsa. Ulangi login.", "state_not_found");
  }
  if (!data.result) throw new HttpError(409, "Login Facebook belum selesai.", "state_pending");
  return (data.result as { pages: StoredPage[] }).pages;
}

async function action(req: Request): Promise<Response> {
  const admin = adminClient();
  const member = await requireMember(req, admin, ["admin"]);
  const input = await readJson<{
    action: "start" | "pages" | "connect" | "disconnect";
    state?: string;
    channel_id?: string;
    items?: { page_id: string; messenger: boolean; instagram: boolean }[];
  }>(req);

  if (input.action === "start") {
    await admin.from("oauth_states").delete().lt("created_at", new Date(Date.now() - STATE_TTL_MS).toISOString());
    const state = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
    const url = dialogUrl(state); // throws when the app is not configured
    const { error } = await admin.from("oauth_states").insert({ state, organization_id: member.organization_id, user_id: member.id });
    if (error) throw error;
    return json({ url });
  }

  if (input.action === "pages") {
    const pages = await loadState(admin, input.state ?? "", member.organization_id);
    const { data: existing } = await admin
      .from("channels")
      .select("provider, external_id, organization_id")
      .in("provider", ["messenger", "instagram"]);
    const taken = (provider: string, id: string | undefined) => {
      const ch = (existing ?? []).find((c) => c.provider === provider && c.external_id === id);
      return ch ? (ch.organization_id === member.organization_id ? "here" : "elsewhere") : null;
    };
    return json({
      pages: pages.map((p) => ({
        id: p.id,
        name: p.name,
        messenger: taken("messenger", p.id),
        instagram: p.instagram ? { ...p.instagram, connected: taken("instagram", p.instagram.id) } : null,
      })),
    });
  }

  if (input.action === "connect") {
    const pages = await loadState(admin, input.state ?? "", member.organization_id);
    let connected = 0;
    for (const item of input.items ?? []) {
      const page = pages.find((p) => p.id === item.page_id);
      if (!page || (!item.messenger && !item.instagram)) continue;
      const token = await decryptSecret(page.token);
      await subscribePage(page.id, token);
      if (item.messenger) {
        await upsertChannel(admin, member.organization_id, {
          provider: "messenger",
          external_id: page.id,
          page_id: page.id,
          name: page.name,
          external_username: page.name,
        }, page.token);
        connected++;
      }
      if (item.instagram && page.instagram) {
        await upsertChannel(admin, member.organization_id, {
          provider: "instagram",
          external_id: page.instagram.id,
          page_id: page.id,
          name: page.instagram.username ? `@${page.instagram.username}` : `Instagram ${page.name}`,
          external_username: page.instagram.username,
        }, page.token);
        connected++;
      }
    }
    await admin.from("oauth_states").delete().eq("state", input.state ?? "");
    if (connected) await audit(admin, member, "create", "channel", `Facebook/Instagram (${connected} kanal)`);
    return json({ connected });
  }

  if (input.action === "disconnect") {
    const { data: ch } = await admin
      .from("channels")
      .select("id, provider, page_id")
      .eq("id", input.channel_id ?? "")
      .eq("organization_id", member.organization_id)
      .maybeSingle();
    if (!ch || !["messenger", "instagram"].includes(ch.provider)) throw new HttpError(404, "Channel not found", "not_found");
    const { data: secret } = await admin.from("channel_secrets").select("access_token_encrypted").eq("channel_id", ch.id).maybeSingle();
    await admin.from("channels").update({ is_active: false, connection_status: "disconnected" }).eq("id", ch.id);
    await admin.from("channel_secrets").delete().eq("channel_id", ch.id);
    // Keep the Page subscribed while another active channel still uses it.
    const { count } = await admin
      .from("channels")
      .select("id", { count: "exact", head: true })
      .eq("page_id", ch.page_id)
      .eq("is_active", true);
    if (secret && !count) await unsubscribePage(ch.page_id, await decryptSecret(secret.access_token_encrypted));
    await audit(admin, member, "delete", "channel", ch.provider === "instagram" ? "Instagram" : "Messenger", null, ch.id);
    return json({ disconnected: true });
  }

  throw new HttpError(400, "Unknown action", "invalid_request");
}

async function upsertChannel(
  admin: SupabaseClient,
  orgId: string,
  fields: { provider: "messenger" | "instagram"; external_id: string; page_id: string; name: string; external_username: string | null },
  encryptedToken: string,
) {
  const { data: existing } = await admin
    .from("channels")
    .select("id, organization_id")
    .eq("provider", fields.provider)
    .eq("external_id", fields.external_id)
    .maybeSingle();
  if (existing && existing.organization_id !== orgId) {
    throw new HttpError(409, `${fields.name} sudah terhubung ke organisasi lain.`, "already_connected");
  }
  let channelId = existing?.id as string | undefined;
  if (channelId) {
    const { error } = await admin
      .from("channels")
      .update({ ...fields, is_active: true, connection_status: "connected", connection_updated_at: new Date().toISOString() })
      .eq("id", channelId);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("channels")
      .insert({ organization_id: orgId, ...fields, connection_status: "connected", connection_updated_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error) throw quotaError(error) ?? error;
    channelId = data.id;
  }
  const { error } = await admin
    .from("channel_secrets")
    .upsert({ channel_id: channelId, access_token_encrypted: encryptedToken, updated_at: new Date().toISOString() });
  if (error) throw error;
}
