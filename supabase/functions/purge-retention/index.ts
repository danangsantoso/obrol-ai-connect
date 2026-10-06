// Daily retention job: deletes messages older than each organization's
// retention period and removes their media files from storage.
// Called by cron on the VPS with the service role key (see deploy/README.md).
import { HttpError, json, serveJson } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const BATCH = 100;

serveJson(async (req) => {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || token !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    throw new HttpError(401, "Service role key required", "unauthorized");
  }

  const admin = adminClient();
  const { data, error } = await admin.rpc("purge_expired_messages");
  if (error) throw error;

  const paths = (data ?? []) as string[];
  let removed = 0;
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    const { data: deleted, error: removeError } = await admin.storage.from("media").remove(chunk);
    if (removeError) console.error("media removal failed", removeError);
    removed += deleted?.length ?? 0;
  }

  return json({ purged_media: paths.length, removed_files: removed });
});
