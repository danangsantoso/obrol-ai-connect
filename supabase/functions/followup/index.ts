// Automatic follow-up sequences, satisfaction surveys and scheduled messages.
//  sweep - put silent chats into automatic sequences, send the steps that are
//          due, the AI's own follow-ups of chats it serves, and satisfaction
//          surveys of resolved chats, scheduled messages and snoozed chats
//          that are due, and repeat order reminders (service role;
//          cron every minute, see deploy/scripts/ai-sweep.sh)
// Agents start and stop follow-ups with the followup_enroll / followup_stop
// database functions.
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, isServiceRole } from "../_shared/supabase.ts";
import { sweepAiFollowups, sweepFollowups } from "../_shared/followup.ts";
import { sweepCsat } from "../_shared/csat.ts";
import { sweepScheduled } from "../_shared/scheduled.ts";
import { sweepRepeat } from "../_shared/repeat.ts";

serveJson(async (req) => {
  const input = await readJson<{ action?: string }>(req);
  if (input.action !== "sweep") throw new HttpError(400, "Unknown action", "invalid_request");
  if (!isServiceRole(req)) throw new HttpError(401, "Service role required", "unauthorized");
  const admin = adminClient();
  const [followups, surveys, aiFollowups, scheduled, repeat] = await Promise.all([
    sweepFollowups(admin),
    sweepCsat(admin),
    sweepAiFollowups(admin),
    sweepScheduled(admin),
    sweepRepeat(admin),
  ]);
  return json({ ...followups, surveys, ai_followups: aiFollowups, ...scheduled, ...repeat });
});
