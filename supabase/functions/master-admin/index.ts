// Master Admin (platform owner) console actions. Master Admins sit outside all
// tenants and never read tenant chats; they manage tenants and their Superadmins.
//  create_tenant      - new organization + its first Superadmin (role admin)
//  add_superadmin     - another Superadmin for an existing tenant
//  set_tenant_active  - suspend (all members' logins blocked) or reactivate
//  reset_password     - Superadmin back to the default password (change at next
//                       login) without two-step verification (lost phone)
//  rename_tenant
//  set_tenant_plan    - plan and paid-until date (or extend by N days)
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, removeMfa, requireMasterAdmin } from "../_shared/supabase.ts";
import { assertUserQuota, quotaError } from "../_shared/plans.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_PASSWORD = "12345678";
const BAN_FOREVER = "876000h";

interface Input {
  action: "create_tenant" | "add_superadmin" | "set_tenant_active" | "reset_password" | "rename_tenant" | "set_tenant_plan";
  plan_id?: string | null;
  expires_at?: string | null;
  extend_days?: number;
  organization_id?: string;
  name?: string;
  admin_name?: string;
  admin_email?: string;
  password?: string;
  active?: boolean;
  user_id?: string;
}

async function createSuperadmin(admin: SupabaseClient, orgId: string, input: Input) {
  const email = (input.admin_email ?? "").trim().toLowerCase();
  const fullName = (input.admin_name ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Email Superadmin tidak valid", "invalid_request");
  const password = input.password?.trim() || DEFAULT_PASSWORD;
  if (password.length < 8) throw new HttpError(400, "Password minimal 8 karakter", "invalid_request");
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) throw new HttpError(409, "Email ini sudah dipakai. Gunakan email lain.", "conflict");

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw new HttpError(400, error.message, "auth_error");
  const { error: profileError } = await admin
    .from("profiles")
    .update({ organization_id: orgId, role: "admin", full_name: fullName || null, must_change_password: true })
    .eq("id", data.user.id);
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw quotaError(profileError) ?? profileError;
  }
  return { user_id: data.user.id, email, password };
}

async function tenantOf(admin: SupabaseClient, id: string | undefined) {
  const { data } = await admin.from("organizations").select("id, name, is_active").eq("id", id ?? "").maybeSingle();
  if (!data) throw new HttpError(404, "Tenant tidak ditemukan", "not_found");
  return data;
}

serveJson(async (req) => {
  const admin = adminClient();
  await requireMasterAdmin(req, admin);
  const input = await readJson<Input>(req);

  switch (input.action) {
    case "create_tenant": {
      const name = (input.name ?? "").trim();
      if (name.length < 2 || name.length > 120) throw new HttpError(400, "Nama tenant 2–120 karakter", "invalid_request");
      const { data: org, error } = await admin.from("organizations").insert({ name }).select("id").single();
      if (error) throw error;
      try {
        const superadmin = await createSuperadmin(admin, org.id, input);
        return json({ organization_id: org.id, superadmin });
      } catch (err) {
        // No empty tenant left behind when the Superadmin cannot be created.
        await admin.from("organizations").delete().eq("id", org.id);
        throw err;
      }
    }
    case "set_tenant_plan": {
      const org = await tenantOf(admin, input.organization_id);
      const { data: current } = await admin.from("organizations").select("plan_expires_at").eq("id", org.id).single();
      let expires: string | null = input.expires_at === undefined ? current?.plan_expires_at ?? null : input.expires_at;
      if (input.extend_days) {
        const days = Math.floor(Number(input.extend_days));
        if (!(days >= 1 && days <= 3660)) throw new HttpError(400, "Perpanjangan 1–3660 hari", "invalid_request");
        // Extend from the current end date, or from today when it has passed.
        const from = Math.max(Date.now(), current?.plan_expires_at ? new Date(current.plan_expires_at).getTime() : 0);
        expires = new Date(from + days * 86_400_000).toISOString();
      }
      if (expires && isNaN(new Date(expires).getTime())) throw new HttpError(400, "Tanggal tidak valid", "invalid_request");
      const patch: Record<string, unknown> = { plan_expires_at: expires };
      if (input.plan_id !== undefined) {
        if (input.plan_id) {
          const { data: plan } = await admin.from("plans").select("id").eq("id", input.plan_id).maybeSingle();
          if (!plan) throw new HttpError(404, "Paket tidak ditemukan", "not_found");
        }
        patch.plan_id = input.plan_id;
      }
      const { error } = await admin.from("organizations").update(patch).eq("id", org.id);
      if (error) throw error;
      return json({ organization_id: org.id, ...patch });
    }
    case "add_superadmin": {
      const org = await tenantOf(admin, input.organization_id);
      await assertUserQuota(admin, org.id);
      return json({ superadmin: await createSuperadmin(admin, org.id, input) });
    }
    case "rename_tenant": {
      const org = await tenantOf(admin, input.organization_id);
      const name = (input.name ?? "").trim();
      if (name.length < 2 || name.length > 120) throw new HttpError(400, "Nama tenant 2–120 karakter", "invalid_request");
      const { error } = await admin.from("organizations").update({ name }).eq("id", org.id);
      if (error) throw error;
      return json({ renamed: true });
    }
    case "set_tenant_active": {
      const org = await tenantOf(admin, input.organization_id);
      const active = input.active === true;
      const { error } = await admin
        .from("organizations")
        .update({ is_active: active, suspended_at: active ? null : new Date().toISOString() })
        .eq("id", org.id);
      if (error) throw error;
      // Block (or allow again) every member's login.
      const { data: members } = await admin.from("profiles").select("id").eq("organization_id", org.id);
      for (const m of members ?? []) {
        const { error: banError } = await admin.auth.admin.updateUserById(m.id, { ban_duration: active ? "none" : BAN_FOREVER });
        if (banError) console.error("ban", m.id, banError.message);
      }
      return json({ organization_id: org.id, is_active: active, members: members?.length ?? 0 });
    }
    case "reset_password": {
      const { data: target } = await admin
        .from("profiles")
        .select("id, role, organization_id")
        .eq("id", input.user_id ?? "")
        .maybeSingle();
      if (!target?.organization_id || target.role !== "admin") throw new HttpError(404, "Superadmin tidak ditemukan", "not_found");
      const { error } = await admin.auth.admin.updateUserById(target.id, { password: DEFAULT_PASSWORD });
      if (error) throw new HttpError(400, error.message, "auth_error");
      await removeMfa(admin, target.id);
      await admin.from("profiles").update({ must_change_password: true }).eq("id", target.id);
      return json({ reset: true, password: DEFAULT_PASSWORD });
    }
    default:
      throw new HttpError(400, "Unknown action", "invalid_request");
  }
});
