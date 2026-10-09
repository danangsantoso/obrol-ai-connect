import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export type Role = "admin" | "supervisor" | "agent";

export interface Member {
  id: string;
  organization_id: string;
  role: Role;
  full_name: string | null;
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Service-role client: bypasses RLS. Only use after checking the caller's rights.
export function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Client acting as the caller, so RLS and auth.uid() apply.
export function callerClient(req: Request): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}

// Someone who turned on two-step verification must have passed it in this
// session (aal2), otherwise a stolen password alone would be enough.
export function assertMfa(user: { factors?: { status: string }[] | null }, token: string) {
  if (!user.factors?.some((f) => f.status === "verified")) return;
  let aal: unknown;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    aal = JSON.parse(atob(part + "===".slice((part.length + 3) % 4))).aal;
  } catch {
    aal = undefined;
  }
  if (aal !== "aal2") throw new HttpError(401, "Masukkan kode verifikasi 2 langkah dulu", "mfa_required");
}

// Resolves the signed-in caller to an active member of an organization.
export async function requireMember(
  req: Request,
  admin: SupabaseClient,
  roles?: Role[],
): Promise<Member> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Missing access token", "unauthorized");

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid or expired session", "unauthorized");
  assertMfa(data.user, token);

  const { data: profile } = await admin
    .from("profiles")
    .select("id, organization_id, role, full_name, is_active, organizations(is_active)")
    .eq("id", data.user.id)
    .maybeSingle();

  const tenant = (profile as { organizations?: { is_active: boolean } | null } | null)?.organizations;
  if (!profile?.organization_id || !profile.is_active || tenant?.is_active === false) {
    throw new HttpError(403, "Your account is not active in an organization", "forbidden");
  }
  if (roles && !roles.includes(profile.role)) {
    throw new HttpError(403, "You do not have permission for this action", "forbidden");
  }
  return profile as Member;
}

// Resolves the signed-in caller to a platform Master Admin (outside all tenants).
export async function requireMasterAdmin(req: Request, admin: SupabaseClient): Promise<{ id: string; email: string }> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Missing access token", "unauthorized");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid or expired session", "unauthorized");
  assertMfa(data.user, token);
  const { data: row } = await admin.from("platform_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!row) throw new HttpError(403, "Hanya Master Admin yang boleh melakukan ini", "forbidden");
  return { id: data.user.id, email: data.user.email ?? "" };
}

// True when the request carries the service role key (cron jobs, database triggers).
export function isServiceRole(req: Request): boolean {
  const given = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Removes the two-step verification of someone who lost their phone (password reset).
export async function removeMfa(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw new HttpError(400, error.message, "auth_error");
  for (const f of data.factors) {
    const { error: delError } = await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
    if (delError) throw new HttpError(400, delError.message, "auth_error");
  }
}

// Activity log entry for an action a member took through an Edge Function
// (row changes made with the service role are not logged by the triggers).
export async function audit(
  admin: SupabaseClient,
  member: { id: string; organization_id: string },
  action: "create" | "update" | "delete",
  entity: string,
  entityName: string | null,
  changes: Record<string, { from: unknown; to: unknown }> | null = null,
  entityId: string | null = null,
) {
  const { error } = await admin.rpc("audit_write", {
    p_org: member.organization_id,
    p_actor: member.id,
    p_action: action,
    p_entity: entity,
    p_entity_id: entityId,
    p_entity_name: entityName,
    p_changes: changes,
  });
  if (error) console.error("activity log failed", error.message);
}
