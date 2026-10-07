// Passwords of team members.
//  change - the signed-in member sets a new password (required after the
//           default / reset password); clears must_change_password
//  reset  - an admin resets a member of their organization to the default
//           password; the member must change it at the next sign-in
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, requireMember } from "../_shared/supabase.ts";

const DEFAULT_PASSWORD = "12345678";

serveJson(async (req) => {
  const admin = adminClient();
  const input = await readJson<{ action: "change" | "reset"; password?: string; user_id?: string }>(req);

  if (input.action === "change") {
    // Any signed-in user, including a Master Admin who belongs to no tenant.
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) throw new HttpError(401, "Invalid or expired session", "unauthorized");
    const member = { id: auth.user.id };
    const password = input.password ?? "";
    if (password.length < 8) throw new HttpError(400, "Password minimal 8 karakter", "invalid_request");
    if (password === DEFAULT_PASSWORD) {
      throw new HttpError(400, "Jangan memakai password bawaan. Pilih password lain.", "invalid_request");
    }
    const { error } = await admin.auth.admin.updateUserById(member.id, { password });
    if (error) throw new HttpError(400, error.message, "auth_error");
    const { error: profileError } = await admin.from("profiles").update({ must_change_password: false }).eq("id", member.id);
    if (profileError) throw profileError;
    return json({ changed: true });
  }

  if (input.action === "reset") {
    const caller = await requireMember(req, admin, ["admin"]);
    const { data: target } = await admin
      .from("profiles")
      .select("id, organization_id")
      .eq("id", input.user_id ?? "")
      .maybeSingle();
    if (!target || target.organization_id !== caller.organization_id) {
      throw new HttpError(404, "Anggota tidak ditemukan", "not_found");
    }
    if (target.id === caller.id) throw new HttpError(400, "Anda tidak bisa mereset password sendiri", "invalid_request");
    const { error } = await admin.auth.admin.updateUserById(target.id, { password: DEFAULT_PASSWORD });
    if (error) throw new HttpError(400, error.message, "auth_error");
    const { error: profileError } = await admin.from("profiles").update({ must_change_password: true }).eq("id", target.id);
    if (profileError) throw profileError;
    return json({ reset: true, password: DEFAULT_PASSWORD });
  }

  throw new HttpError(400, "Unknown action", "invalid_request");
});
