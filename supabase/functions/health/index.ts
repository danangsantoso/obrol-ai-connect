// Uptime check for an external monitor (UptimeRobot, Uptime Kuma):
//   GET https://<api>/functions/v1/health -> 200 {"ok":true} | 503 {"ok":false}
// 200 means the functions runtime, the API gateway and the database all answer.
// Nothing else is revealed.
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
  let ok = false;
  try {
    const { error } = await adminClient().from("app_config").select("key").limit(1);
    ok = !error;
  } catch {
    ok = false;
  }
  return new Response(req.method === "HEAD" ? null : JSON.stringify({ ok }), {
    status: ok ? 200 : 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});
