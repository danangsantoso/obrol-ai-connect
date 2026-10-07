// Sends queued webhook deliveries. Woken by the database (pg_net) right after
// an event and every minute by cron for retries. It takes no input and only
// drains the queue, so it needs no credentials.
//
// Each POST carries:
//   X-Balas-Event: message.received
//   X-Balas-Delivery: <delivery id>
//   X-Balas-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the webhook secret>
import { adminClient } from "../_shared/supabase.ts";

// Minutes to wait after the 1st, 2nd, ... failed attempt; then give up.
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Due {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  url: string;
  secret: string;
}

async function deliver(d: Due): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const raw = JSON.stringify({ id: d.id, ...d.payload });
  const t = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(d.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Balas.id-Webhook/1",
        "X-Balas-Event": d.event,
        "X-Balas-Delivery": d.id,
        "X-Balas-Signature": `t=${t},v1=${await sign(d.secret, `${t}.${raw}`)}`,
      },
      body: raw,
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    return { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message.slice(0, 300) : "network error" };
  }
}

Deno.serve(async () => {
  const admin = adminClient();
  let sent = 0;
  // A few rounds so a burst of events goes out in one wake-up.
  for (let round = 0; round < 5; round++) {
    const { data, error } = await admin.rpc("claim_webhook_deliveries", { p_limit: 50 });
    if (error) {
      console.error(error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    const due = (data ?? []) as Due[];
    if (due.length === 0) break;
    await Promise.all(
      due.map(async (d) => {
        const r = await deliver(d);
        const now = new Date().toISOString();
        const retry = !r.ok && d.attempts <= BACKOFF_MINUTES.length;
        await admin
          .from("webhook_deliveries")
          .update({
            status: r.ok ? "delivered" : retry ? "pending" : "failed",
            response_status: r.status,
            error: r.error,
            delivered_at: r.ok ? now : null,
            next_attempt_at: retry ? new Date(Date.now() + BACKOFF_MINUTES[d.attempts - 1] * 60_000).toISOString() : now,
          })
          .eq("id", d.id);
        await admin
          .from("webhooks")
          .update({ last_delivery_at: now, last_status: r.status, last_error: r.error })
          .eq("id", d.webhook_id);
        sent++;
      }),
    );
  }
  if (Math.random() < 0.02) await admin.rpc("purge_webhook_deliveries");
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
