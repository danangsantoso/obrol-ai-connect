// Payment notifications from Xendit and Midtrans. Each tenant sets this URL
// in its provider dashboard (shown in Pengaturan > Pembayaran):
//   .../functions/v1/payment-webhook?org=<organization id>&provider=xendit|midtrans
// Xendit is verified with the tenant's callback token (x-callback-token),
// Midtrans with signature_key = SHA512(order_id + status_code + gross_amount + server key).
import { adminClient } from "../_shared/supabase.ts";
import { loadPaymentConfig, markPaid } from "../_shared/payments.ts";

const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function same(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha512(text: string) {
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok({ error: "Use POST" }, 405);
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org") ?? "";
  const provider = url.searchParams.get("provider");
  if (!UUID.test(orgId)) return ok({ error: "unknown organization" }, 404);
  const admin = adminClient();
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return ok({ error: "invalid body" }, 400);
  const cfg = await loadPaymentConfig(admin, orgId);

  let orderId = "";
  let outcome: "paid" | "expired" | "ignore" = "ignore";
  let paidAmount = 0;
  if (provider === "xendit") {
    if (!cfg.keys.xenditCallback || !same(req.headers.get("x-callback-token") ?? "", cfg.keys.xenditCallback)) {
      return ok({ error: "invalid callback token" }, 401);
    }
    orderId = String(body.external_id ?? "");
    const status = String(body.status ?? "").toUpperCase();
    paidAmount = Number(body.paid_amount ?? body.amount ?? 0);
    outcome = status === "PAID" || status === "SETTLED" ? "paid" : status === "EXPIRED" ? "expired" : "ignore";
  } else if (provider === "midtrans") {
    if (!cfg.keys.midtrans) return ok({ error: "not configured" }, 401);
    const expected = await sha512(`${body.order_id}${body.status_code}${body.gross_amount}${cfg.keys.midtrans}`);
    if (!same(String(body.signature_key ?? ""), expected)) return ok({ error: "invalid signature" }, 401);
    orderId = String(body.order_id ?? "");
    const status = String(body.transaction_status ?? "");
    paidAmount = Number(body.gross_amount ?? 0);
    if (status === "settlement" || (status === "capture" && (body.fraud_status ?? "accept") === "accept")) outcome = "paid";
    else if (["expire", "cancel", "deny"].includes(status)) outcome = "expired";
  } else {
    return ok({ error: "unknown provider" }, 400);
  }

  if (!UUID.test(orderId)) return ok({ ignored: "unknown order" });
  const { data: order } = await admin.from("orders").select("id, organization_id, total, status")
    .eq("id", orderId).eq("organization_id", orgId).maybeSingle();
  if (!order) return ok({ ignored: "unknown order" });

  if (outcome === "paid") {
    if (paidAmount + 0.5 < Number(order.total)) {
      await admin.from("order_events").insert({ organization_id: orgId, order_id: order.id, event: "underpaid", note: `Dibayar ${paidAmount}, tagihan ${order.total}` });
      return ok({ ignored: "amount below total" });
    }
    await markPaid(admin, order.id, `Lunas via ${provider}`, null);
  } else if (outcome === "expired" && order.status === "awaiting_payment") {
    await admin.from("orders").update({ status: "expired" }).eq("id", order.id).eq("status", "awaiting_payment");
    await admin.from("order_events").insert({ organization_id: orgId, order_id: order.id, event: "expired", note: `Dari ${provider}` });
  }
  return ok();
});
