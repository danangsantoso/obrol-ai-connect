// Orders and payments.
//  set_keys     - store the tenant's Xendit / Midtrans / Biteship keys (admins)
//  rates        - shipping rates for a postal code (members)
//  create       - create an order for a chat and send the invoice (members with access to the chat)
//  send_invoice - send the invoice again
//  mark_paid    - confirm a bank transfer by hand
//  set_status   - processing / shipped (with tracking number) / completed / cancelled
//  track        - check the parcel of a shipped order now (Biteship)
//  sweep        - expire unpaid orders past their deadline and track shipped
//                 parcels with Biteship (service role; cron)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, callerClient, isServiceRole, requireMember } from "../_shared/supabase.ts";
import { encryptSecret } from "../_shared/crypto.ts";
import {
  createOrder,
  loadPaymentConfig,
  markPaid,
  type NewOrder,
  type Order,
  type OrderItem,
  sendInvoice,
  setOrderStatus,
  shippingRates,
  courierCode,
  refreshTracking,
  sweepTracking,
  trackingLabel,
} from "../_shared/payments.ts";

interface OrdersRequest {
  action: string;
  order_id?: string;
  conversation_id?: string;
  items?: NewOrder["items"];
  customer?: NewOrder["customer"];
  shipping?: { courier: string; service: string; cost: number } | null;
  discount?: number;
  notes?: string;
  send_invoice?: boolean;
  postal_code?: string;
  status?: string;
  tracking_number?: string;
  courier?: string;
  reason?: string;
  notify?: boolean;
  keys?: Record<string, string | null>;
}

const KEY_FIELDS = {
  xendit_secret_key: "xendit_key_hint",
  xendit_callback_token: null,
  midtrans_server_key: "midtrans_key_hint",
  biteship_api_key: "biteship_key_hint",
} as const;

// The caller must be able to see the order (row-level security decides).
async function visibleOrder(req: Request, admin: SupabaseClient, orderId: string | undefined): Promise<Order> {
  if (!orderId) throw new HttpError(400, "order_id is required", "invalid_request");
  const { data } = await callerClient(req).from("orders").select("id").eq("id", orderId).maybeSingle();
  if (!data) throw new HttpError(404, "Pesanan tidak ditemukan", "not_found");
  const { data: order } = await admin.from("orders").select("*").eq("id", orderId).single();
  return order as Order;
}

serveJson(async (req) => {
  const admin = adminClient();
  const input = await readJson<OrdersRequest>(req);

  if (input.action === "sweep") {
    if (!isServiceRole(req)) throw new HttpError(401, "Service role required", "unauthorized");
    const { data, error } = await admin.rpc("expire_orders");
    if (error) throw error;
    const tracking = await sweepTracking(admin);
    return json({ expired: data, ...tracking });
  }

  const member = await requireMember(req, admin);
  const orgId = member.organization_id;

  switch (input.action) {
    case "set_keys": {
      if (member.role !== "admin") throw new HttpError(403, "Hanya admin", "forbidden");
      const secrets: Record<string, string | null> = {};
      const hints: Record<string, string | null> = {};
      for (const [field, hint] of Object.entries(KEY_FIELDS)) {
        if (!input.keys || !(field in input.keys)) continue;
        const value = input.keys[field]?.trim() || null;
        if (value && (value.length < 8 || value.length > 500)) throw new HttpError(400, `${field} tidak valid`, "invalid_request");
        secrets[field] = value ? await encryptSecret(value) : null;
        if (hint) hints[hint] = value ? `…${value.slice(-4)}` : null;
      }
      const { error } = await admin.from("payment_secrets").upsert({ organization_id: orgId, ...secrets, updated_at: new Date().toISOString() });
      if (error) throw error;
      const { error: hintError } = await admin.from("payment_settings").upsert({ organization_id: orgId, ...hints }, { onConflict: "organization_id" });
      if (hintError) throw hintError;
      return json({ ok: true, ...hints });
    }

    case "rates": {
      const cfg = await loadPaymentConfig(admin, orgId);
      const { data: products } = await admin.from("products").select("id, name, price, weight_grams").eq("organization_id", orgId);
      const items: OrderItem[] = (input.items ?? []).map((l) => {
        const p = products?.find((x) => x.id === l.product_id);
        return { product_id: p?.id ?? null, name: p?.name ?? l.name ?? "Barang", qty: Math.max(1, Number(l.qty) || 1), price: Number(p?.price ?? l.price ?? 0), weight_grams: p?.weight_grams ?? 1000 };
      });
      if (!items.length) items.push({ product_id: null, name: "Barang", qty: 1, price: 0, weight_grams: 1000 });
      return json({ rates: await shippingRates(cfg, input.postal_code?.trim() ?? "", items) });
    }

    case "create": {
      if (!input.conversation_id) throw new HttpError(400, "conversation_id is required", "invalid_request");
      const { data: allowed } = await callerClient(req).rpc("can_access_conversation", { conv_id: input.conversation_id });
      if (allowed !== true) throw new HttpError(404, "Chat tidak ditemukan", "not_found");
      const order = await createOrder(admin, orgId, {
        conversationId: input.conversation_id,
        createdBy: member.id,
        byAi: false,
        items: input.items ?? [],
        customer: input.customer ?? {},
        shipping: input.shipping ?? null,
        discount: input.discount,
        notes: input.notes,
      });
      let invoiceError: string | null = null;
      if (input.send_invoice !== false) {
        try {
          await sendInvoice(admin, order, member.id);
        } catch (err) {
          invoiceError = err instanceof Error ? err.message : String(err);
        }
      }
      return json({ order, invoice_error: invoiceError });
    }

    case "send_invoice": {
      const order = await visibleOrder(req, admin, input.order_id);
      if (order.status !== "awaiting_payment") throw new HttpError(409, "Pesanan ini tidak sedang menunggu pembayaran", "invalid_status");
      return json({ message: await sendInvoice(admin, order, member.id) });
    }

    case "mark_paid": {
      const order = await visibleOrder(req, admin, input.order_id);
      const paid = await markPaid(admin, order.id, "Dikonfirmasi manual", member.id);
      if (!paid) throw new HttpError(409, "Pesanan ini tidak sedang menunggu pembayaran", "invalid_status");
      return json({ order: paid });
    }

    case "set_status": {
      const order = await visibleOrder(req, admin, input.order_id);
      return json({
        order: await setOrderStatus(admin, order.id, {
          status: input.status ?? "",
          tracking_number: input.tracking_number,
          courier: input.courier,
          reason: input.reason,
          notify: input.notify,
        }, member.id),
      });
    }
    case "track": {
      const order = await visibleOrder(req, admin, input.order_id);
      const cfg = await loadPaymentConfig(admin, orgId);
      if (!cfg.keys.biteship) throw new HttpError(400, "API key Biteship belum diisi di Pengaturan Pembayaran", "shipping_not_configured");
      if (!order.tracking_number) throw new HttpError(400, "Pesanan ini belum punya nomor resi", "invalid_request");
      if (!courierCode(order.courier)) throw new HttpError(400, `Kurir "${order.courier ?? "-"}" tidak dikenali untuk cek resi`, "invalid_request");
      const tracking = await refreshTracking(admin, order, cfg.keys.biteship);
      return json({ tracking, label: trackingLabel(tracking?.status ?? null) });
    }
  }
  throw new HttpError(400, "Unknown action", "invalid_request");
});
