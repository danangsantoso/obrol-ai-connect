// Admin adds a team member: an account with the default password 12345678
// (or one the admin chooses), which the member must change at first sign-in;
// or an email invitation (needs SMTP).
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, requireMember, type Role } from "../_shared/supabase.ts";

interface InviteRequest {
  email: string;
  full_name?: string;
  role: Role;
  team_ids?: string[];
  password?: string;
  // Send an email invitation instead of creating the account with a password.
  invite_by_email?: boolean;
}

const DEFAULT_PASSWORD = "12345678";

const ROLES: Role[] = ["admin", "supervisor", "agent"];

serveJson(async (req) => {
  const admin = adminClient();
  const caller = await requireMember(req, admin, ["admin"]);
  const input = await readJson<InviteRequest>(req);

  const email = input.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Email is not valid", "invalid_request");
  if (!ROLES.includes(input.role)) throw new HttpError(400, "Role is not valid", "invalid_request");
  const password = input.invite_by_email ? undefined : input.password?.trim() || DEFAULT_PASSWORD;
  if (password !== undefined && password.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters", "invalid_request");
  }
  const fullName = input.full_name?.trim() ?? "";

  const teamIds = input.team_ids ?? [];
  if (teamIds.length) {
    const { data: teams, error } = await admin
      .from("teams")
      .select("id")
      .eq("organization_id", caller.organization_id)
      .in("id", teamIds);
    if (error) throw error;
    if (teams.length !== new Set(teamIds).size) throw new HttpError(400, "Unknown team", "invalid_request");
  }

  const { data: existing } = await admin
    .from("profiles")
    .select("id, organization_id")
    .eq("email", email)
    .maybeSingle();

  let userId: string;
  let invited = false;
  if (existing) {
    if (existing.organization_id && existing.organization_id !== caller.organization_id) {
      throw new HttpError(409, "This email already belongs to another organization", "conflict");
    }
    if (existing.organization_id === caller.organization_id) {
      throw new HttpError(409, "This person is already a member", "conflict");
    }
    userId = existing.id;
  } else if (password) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw new HttpError(400, error.message, "auth_error");
    userId = data.user.id;
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: Deno.env.get("APP_URL") ?? req.headers.get("origin") ?? undefined,
    });
    if (error) throw new HttpError(400, error.message, "auth_error");
    userId = data.user.id;
    invited = true;
  }

  const update: Record<string, unknown> = {
    organization_id: caller.organization_id,
    role: input.role,
    // A password chosen by someone else is temporary.
    must_change_password: Boolean(password) && !existing,
  };
  if (fullName) update.full_name = fullName;
  const { error: profileError } = await admin.from("profiles").update(update).eq("id", userId);
  if (profileError) throw profileError;

  if (teamIds.length) {
    const { error } = await admin
      .from("team_members")
      .upsert(teamIds.map((team_id) => ({ team_id, profile_id: userId })));
    if (error) throw error;
  }

  return json({ user_id: userId, invited });
});
