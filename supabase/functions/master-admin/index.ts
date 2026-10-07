// Master Admin (platform owner) console actions. Master Admins sit outside all
// tenants and never read tenant chats; they manage tenants and their Superadmins.
//  create_tenant      - new organization + its first Superadmin (role admin)
//  add_superadmin     - another Superadmin for an existing tenant
//  set_tenant_active  - suspend (all members' logins blocked) or reactivate
//  reset_password     - Superadmin back to the default password, change at next login
//  rename_tenant
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, requireMasterAdmin } from "../_shared/supabase.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_PASSWORD = "12345678";
const BAN_FOREVER = "876000h";

interface Input {
  action: "create_tenant" | "add_superadmin" | "set_tenant_active" | "reset_password" | "rename_tenant";
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
  if (profileError) throw profileError;
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
    case "add_superadmin": {
      const org = await tenantOf(admin, input.organization_id);
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
      await admin.from("profiles").update({ must_change_password: true }).eq("id", target.id);
      return json({ reset: true, password: DEFAULT_PASSWORD });
    }
    default:
      throw new HttpError(400, "Unknown action", "invalid_request");
  }
});
