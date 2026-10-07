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
  const { data: row } = await admin.from("platform_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!row) throw new HttpError(403, "Hanya Master Admin yang boleh melakukan ini", "forbidden");
  return { id: data.user.id, email: data.user.email ?? "" };
}
