// Plan limits checked before work that would exceed them (the database
// enforces them too; checking first gives a clear message and leaves no
// half-created user behind).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export async function assertUserQuota(admin: SupabaseClient, orgId: string) {
  const { data: org } = await admin.from("organizations").select("plans(max_users)").eq("id", orgId).single<{ plans: { max_users: number | null } | null }>();
  const max = org?.plans?.max_users;
  if (!max) return;
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true);
  if ((count ?? 0) >= max) {
    throw new HttpError(409, `Kuota pengguna paket sudah penuh (${max} pengguna). Hubungi pengelola platform untuk menaikkan paket.`, "quota_exceeded");
  }
}

// Turns a limit raised by the database into a readable 409.
export function quotaError(err: { code?: string; message?: string } | null): HttpError | null {
  if (err?.code === "P0001" && err.message?.startsWith("Kuota")) return new HttpError(409, err.message, "quota_exceeded");
  return null;
}
