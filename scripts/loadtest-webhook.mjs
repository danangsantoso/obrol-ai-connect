#!/usr/bin/env node
// Load test for the WhatsApp webhook: sends signed, Meta-shaped messages and
// reports throughput and latency. Use against a test number / channel only.
//
//   node scripts/loadtest-webhook.mjs --url https://api.balas.id/functions/v1/whatsapp-webhook \
//     --secret <WHATSAPP_APP_SECRET> --phone-number-id <channel phone_number_id> \
//     --messages 200 --contacts 50 --concurrency 10
import crypto from "node:crypto";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    url: { type: "string" },
    secret: { type: "string" },
    "phone-number-id": { type: "string" },
    messages: { type: "string", default: "200" },
    contacts: { type: "string", default: "50" },
    concurrency: { type: "string", default: "10" },
    prefix: { type: "string", default: "6289900" },
  },
});

if (!opts.url || !opts.secret || !opts["phone-number-id"]) {
  console.error("Required: --url, --secret, --phone-number-id");
  process.exit(2);
}

const total = Number(opts.messages);
const contacts = Number(opts.contacts);
const concurrency = Number(opts.concurrency);
const run = Date.now().toString(36);

function payload(i) {
  const from = `${opts.prefix}${String(i % contacts).padStart(5, "0")}`;
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "LOADTEST", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: opts["phone-number-id"] },
      contacts: [{ wa_id: from, profile: { name: `Load Test ${i % contacts}` } }],
      messages: [{
        from,
        id: `wamid.LOAD.${run}.${i}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: `Pesan uji beban #${i}` },
      }],
    } }] }],
  };
}

async function send(i) {
  const raw = JSON.stringify(payload(i));
  const signature = "sha256=" + crypto.createHmac("sha256", opts.secret).update(raw).digest("hex");
  const started = performance.now();
  const res = await fetch(opts.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
    body: raw,
  }).catch((err) => ({ ok: false, status: String(err.cause?.code ?? err.message) }));
  return { ok: res.ok, status: res.status, ms: performance.now() - started };
}

const results = [];
let next = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < total) results.push(await send(next++));
  }),
);
const seconds = (performance.now() - started) / 1000;

const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))].toFixed(0);
const failures = results.filter((r) => !r.ok);
const byStatus = Object.groupBy ? Object.groupBy(failures, (r) => r.status) : {};

console.log(`messages     ${results.length} to ${contacts} contacts, concurrency ${concurrency}`);
console.log(`duration     ${seconds.toFixed(1)} s (${(results.length / seconds).toFixed(1)} msg/s)`);
console.log(`latency ms   p50 ${pct(50)}  p95 ${pct(95)}  max ${pct(100)}`);
console.log(`failed       ${failures.length}${failures.length ? " " + JSON.stringify(Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, v.length]))) : ""}`);
console.log(`run id       ${run} (wa_message_id prefix wamid.LOAD.${run}.)`);
process.exit(failures.length ? 1 : 0);
