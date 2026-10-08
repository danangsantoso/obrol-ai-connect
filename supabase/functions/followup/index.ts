// Automatic follow-up sequences and satisfaction surveys.
//  sweep - put silent chats into automatic sequences, send the steps that are
//          due, and send satisfaction surveys of resolved chats (service role;
//          cron every minute, see deploy/scripts/ai-sweep.sh)
// Agents start and stop follow-ups with the followup_enroll / followup_stop
// database functions.
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, isServiceRole } from "../_shared/supabase.ts";
import { sweepFollowups } from "../_shared/followup.ts";
import { sweepCsat } from "../_shared/csat.ts";

serveJson(async (req) => {
  const input = await readJson<{ action?: string }>(req);
  if (input.action !== "sweep") throw new HttpError(400, "Unknown action", "invalid_request");
  if (!isServiceRole(req)) throw new HttpError(401, "Service role required", "unauthorized");
  const admin = adminClient();
  const [followups, surveys] = await Promise.all([sweepFollowups(admin), sweepCsat(admin)]);
  return json({ ...followups, surveys });
});
