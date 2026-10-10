// Orders, payment links and shipping rates.
//  - Payment: bank transfer (manual confirmation), Xendit invoice or Midtrans
//    Snap. Keys are per tenant, encrypted in payment_secrets.
//  - Shipping: none, a flat fee, or live rates from Biteship.
// Prices always come from the product catalog, except custom lines an agent
// adds by hand.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";
import { decryptSecret } from "./crypto.ts";
import { sendToConversation } from "./send.ts";

export interface PaymentSettings {
  organization_id: string;
  provider: "manual" | "xendit" | "midtrans";
  bank_accounts: { bank: string; number: string; holder: string }[];
  payment_note: string;
  midtrans_production: boolean;
  invoice_hours: number;
  shipping_mode: "none" | "flat" | "biteship";
  flat_shipping_cost: number;
  origin_postal_code: string | null;
  couriers: string;
  ai_create_orders: boolean;
}

export interface PaymentConfig {
  settings: PaymentSettings;
  timezone: string;
  shop: string;
  keys: { xendit?: string; xenditCallback?: string; midtrans?: string; biteship?: string };
}

export interface OrderItem {
  product_id: string | null;
  name: string;
  qty: number;
  price: number;
  weight_grams: number;
}

export interface Order {
  id: string;
  organization_id: string;
  number: string;
  conversation_id: string | null;
  contact_id: string | null;
  status: string;
  items: OrderItem[];
  subtotal: number;
  shipping_cost: number;
  discount: number;
  total: number;
  currency: string;
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  courier: string | null;
  courier_service: string | null;
  tracking_number: string | null;
  notes: string | null;
  payment_provider: string;
  payment_ref: string | null;
  payment_url: string | null;
  expires_at: string | null;
  paid_at: string | null;
}

export interface Rate {
  courier: string;
  courier_name: string;
  service: string;
  service_name: string;
  price: number;
  etd: string;
}

const DEFAULT_SETTINGS: Omit<PaymentSettings, "organization_id"> = {
  provider: "manual",
  bank_accounts: [],
  payment_note: "",
  midtrans_production: false,
  invoice_hours: 24,
  shipping_mode: "none",
  flat_shipping_cost: 0,
  origin_postal_code: null,
  couriers: "jne,sicepat,jnt,anteraja",
  ai_create_orders: false,
};

export const rupiah = (n: number) => `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

export async function loadPaymentConfig(admin: SupabaseClient, orgId: string): Promise<PaymentConfig> {
  const [{ data: settings }, { data: secrets }, { data: org }] = await Promise.all([
    admin.from("payment_settings").select("*").eq("organization_id", orgId).maybeSingle(),
    admin.from("payment_secrets").select("*").eq("organization_id", orgId).maybeSingle(),
    admin.from("organizations").select("name, timezone").eq("id", orgId).single(),
  ]);
  const dec = async (v: string | null | undefined) => (v ? await decryptSecret(v) : undefined);
  return {
    settings: { ...DEFAULT_SETTINGS, organization_id: orgId, ...(settings ?? {}) } as PaymentSettings,
    timezone: org?.timezone ?? "Asia/Jakarta",
    shop: org?.name ?? "Toko",
    keys: {
      xendit: await dec(secrets?.xendit_secret_key),
      xenditCallback: await dec(secrets?.xendit_callback_token),
      midtrans: await dec(secrets?.midtrans_server_key),
      biteship: await dec(secrets?.biteship_api_key),
    },
  };
}

const basic = (key: string) => `Basic ${btoa(`${key}:`)}`;

async function callProvider<T>(name: string, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new HttpError(502, `${name} tidak bisa dihubungi: ${(err as Error).message}`, "payment_error");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { message?: string; error_messages?: string[]; error?: string }).message ??
      (body as { error_messages?: string[] }).error_messages?.join(", ") ?? (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new HttpError(502, `${name}: ${msg}`, "payment_error");
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------
export async function shippingRates(cfg: PaymentConfig, destinationPostal: string, items: OrderItem[]): Promise<Rate[]> {
  const s = cfg.settings;
  if (s.shipping_mode === "flat") {
    return [{ courier: "flat", courier_name: "", service: "flat", service_name: "", price: Number(s.flat_shipping_cost), etd: "" }];
  }
  if (s.shipping_mode !== "biteship") return [];
  if (!cfg.keys.biteship) throw new HttpError(400, "API key Biteship belum diisi di Pengaturan Pembayaran", "shipping_not_configured");
  if (!s.origin_postal_code) throw new HttpError(400, "Kode pos asal pengiriman belum diisi", "shipping_not_configured");
  if (!/^\d{5}$/.test(destinationPostal)) throw new HttpError(400, "Kode pos tujuan harus 5 angka", "invalid_request");
  const base = Deno.env.get("BITESHIP_API_BASE") || "https://api.biteship.com";
  const body = await callProvider<{ pricing?: Record<string, unknown>[] }>("Biteship", `${base}/v1/rates/couriers`, {
    method: "POST",
    headers: { Authorization: cfg.keys.biteship, "Content-Type": "application/json" },
    body: JSON.stringify({
      origin_postal_code: Number(s.origin_postal_code),
      destination_postal_code: Number(destinationPostal),
      couriers: s.couriers,
      items: items.map((i) => ({ name: i.name, value: Math.round(i.price), weight: i.weight_grams, quantity: i.qty })),
    }),
  });
  return (body.pricing ?? [])
    .map((p) => ({
      courier: String(p.courier_code ?? ""),
      courier_name: String(p.courier_name ?? p.courier_code ?? ""),
      service: String(p.courier_service_code ?? ""),
      service_name: String(p.courier_service_name ?? p.courier_service_code ?? ""),
      price: Number(p.price ?? 0),
      etd: String(p.duration ?? p.shipment_duration_range ?? ""),
    }))
    .filter((r) => r.courier && r.price >= 0)
    .sort((a, b) => a.price - b.price);
}

// ---------------------------------------------------------------------------
// Payment links
// ---------------------------------------------------------------------------
interface Link {
  ref: string | null;
  url: string | null;
  expires_at: string;
}

async function paymentLink(cfg: PaymentConfig, o: Omit<Order, "payment_ref" | "payment_url" | "expires_at" | "paid_at" | "status">): Promise<Link> {
  const s = cfg.settings;
  const expires = new Date(Date.now() + s.invoice_hours * 3600_000).toISOString();
  const lines = [
    ...o.items.map((i) => ({ id: i.product_id ?? "item", name: i.name.slice(0, 50), price: Math.round(i.price), quantity: i.qty })),
    ...(o.shipping_cost > 0 ? [{ id: "shipping", name: `Ongkir ${o.courier ?? ""}`.trim().slice(0, 50), price: Math.round(o.shipping_cost), quantity: 1 }] : []),
    ...(o.discount > 0 ? [{ id: "discount", name: "Diskon", price: -Math.round(o.discount), quantity: 1 }] : []),
  ];

  if (s.provider === "xendit") {
    if (!cfg.keys.xendit) throw new HttpError(400, "Secret key Xendit belum diisi di Pengaturan Pembayaran", "payment_not_configured");
    const base = Deno.env.get("XENDIT_API_BASE") || "https://api.xendit.co";
    const inv = await callProvider<{ id: string; invoice_url: string; expiry_date?: string }>("Xendit", `${base}/v2/invoices`, {
      method: "POST",
      headers: { Authorization: basic(cfg.keys.xendit), "Content-Type": "application/json" },
      body: JSON.stringify({
        external_id: o.id,
        amount: Math.round(o.total),
        currency: "IDR",
        description: `Pesanan ${o.number} - ${cfg.shop}`,
        invoice_duration: s.invoice_hours * 3600,
        customer: { given_names: o.customer_name ?? "Pelanggan", ...(o.phone ? { mobile_number: o.phone } : {}) },
        items: lines.filter((l) => l.price > 0).map((l) => ({ name: l.name, quantity: l.quantity, price: l.price })),
      }),
    });
    return { ref: inv.id, url: inv.invoice_url, expires_at: inv.expiry_date ?? expires };
  }

  if (s.provider === "midtrans") {
    if (!cfg.keys.midtrans) throw new HttpError(400, "Server key Midtrans belum diisi di Pengaturan Pembayaran", "payment_not_configured");
    const base = Deno.env.get("MIDTRANS_API_BASE") ||
      (s.midtrans_production ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com");
    const snap = await callProvider<{ token: string; redirect_url: string }>("Midtrans", `${base}/snap/v1/transactions`, {
      method: "POST",
      headers: { Authorization: basic(cfg.keys.midtrans), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        transaction_details: { order_id: o.id, gross_amount: Math.round(o.total) },
        item_details: lines,
        customer_details: { first_name: o.customer_name ?? "Pelanggan", ...(o.phone ? { phone: o.phone } : {}) },
        expiry: { unit: "hour", duration: s.invoice_hours },
      }),
    });
    return { ref: snap.token, url: snap.redirect_url, expires_at: expires };
  }

  return { ref: null, url: null, expires_at: expires };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export interface NewOrder {
  conversationId: string;
  createdBy: string | null;
  byAi: boolean;
  items: { product_id?: string | null; name?: string; qty: number; price?: number }[];
  customer: { name?: string | null; phone?: string | null; address?: string | null; city?: string | null; postal_code?: string | null };
  // An agent's chosen rate; "cheapest" picks the lowest live rate.
  shipping?: { courier: string; service: string; cost: number } | "cheapest" | null;
  discount?: number;
  notes?: string | null;
  // Cancel the chat's earlier unpaid orders (the AI re-confirming an order).
  replaceUnpaid?: boolean;
}

interface Product {
  id: string;
  name: string;
  price: number | null;
  keywords: string;
  weight_grams: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// The catalog product meant by a name: exact, then a keyword, then contained.
export function matchProduct(products: Product[], name: string): Product | null {
  const n = norm(name);
  if (!n) return null;
  return products.find((p) => norm(p.name) === n) ??
    products.find((p) => p.keywords.split(",").map(norm).filter(Boolean).includes(n)) ??
    products.find((p) => norm(p.name).includes(n) || n.includes(norm(p.name))) ??
    null;
}

export async function createOrder(admin: SupabaseClient, orgId: string, input: NewOrder): Promise<Order> {
  const cfg = await loadPaymentConfig(admin, orgId);
  const { data: conv } = await admin
    .from("conversations")
    .select("id, organization_id, contact_id, contacts(name, profile_name, wa_id), channels(provider)")
    .eq("id", input.conversationId)
    .single<{ id: string; organization_id: string; contact_id: string; contacts: { name: string | null; profile_name: string | null; wa_id: string }; channels: { provider: string } }>();
  if (!conv || conv.organization_id !== orgId) throw new HttpError(404, "Chat tidak ditemukan", "not_found");

  const { data: products } = await admin
    .from("products").select("id, name, price, keywords, weight_grams").eq("organization_id", orgId).eq("is_active", true);
  const catalog = (products ?? []) as Product[];

  if (!input.items?.length) throw new HttpError(400, "Pesanan harus berisi produk", "invalid_request");
  if (input.items.length > 50) throw new HttpError(400, "Maksimal 50 baris produk", "invalid_request");
  const items: OrderItem[] = input.items.map((line) => {
    const qty = Math.floor(Number(line.qty));
    if (!(qty >= 1 && qty <= 999)) throw new HttpError(400, "Jumlah produk harus 1-999", "invalid_request");
    const product = line.product_id
      ? catalog.find((p) => p.id === line.product_id) ?? null
      : line.name ? matchProduct(catalog, line.name) : null;
    if (product) {
      if (product.price === null) throw new HttpError(400, `Harga ${product.name} belum diisi di katalog`, "invalid_request");
      return { product_id: product.id, name: product.name, qty, price: Number(product.price), weight_grams: product.weight_grams };
    }
    // Only an agent may add a line that is not in the catalog, with its own price.
    if (input.byAi || !line.name?.trim() || line.price === undefined || !(Number(line.price) >= 0)) {
      throw new HttpError(400, `Produk "${line.name ?? line.product_id}" tidak ada di katalog`, "unknown_product");
    }
    return { product_id: null, name: line.name.trim().slice(0, 160), qty, price: Number(line.price), weight_grams: 1000 };
  });
  const subtotal = items.reduce((n, i) => n + i.price * i.qty, 0);

  const c = input.customer ?? {};
  const postal = c.postal_code?.trim() || null;
  let courier: string | null = null;
  let service: string | null = null;
  let shippingCost = 0;
  if (input.shipping === "cheapest") {
    if (cfg.settings.shipping_mode !== "none") {
      if (cfg.settings.shipping_mode === "biteship" && !postal) {
        throw new HttpError(400, "Kode pos tujuan dibutuhkan untuk menghitung ongkir", "postal_code_required");
      }
      const rates = await shippingRates(cfg, postal ?? "", items);
      if (!rates.length) throw new HttpError(422, "Tidak ada kurir yang melayani alamat ini", "no_shipping_rate");
      courier = rates[0].courier_name || null;
      service = rates[0].service_name || null;
      shippingCost = rates[0].price;
    }
  } else if (input.shipping) {
    courier = input.shipping.courier.trim().slice(0, 60) || null;
    service = input.shipping.service.trim().slice(0, 60) || null;
    shippingCost = Math.max(0, Number(input.shipping.cost) || 0);
  }
  const discount = input.byAi ? 0 : Math.max(0, Number(input.discount) || 0);
  const total = Math.max(0, subtotal + shippingCost - discount);

  const { data: number, error: numError } = await admin.rpc("next_order_number", { p_org: orgId });
  if (numError) throw numError;
  const id = crypto.randomUUID();
  const contactPhone = /^\d{8,15}$/.test(conv.contacts.wa_id) ? conv.contacts.wa_id : null;
  const draft = {
    id,
    organization_id: orgId,
    number: number as string,
    conversation_id: conv.id,
    contact_id: conv.contact_id,
    items,
    subtotal,
    shipping_cost: shippingCost,
    discount,
    total,
    currency: "IDR",
    customer_name: c.name?.trim() || conv.contacts.name || conv.contacts.profile_name || null,
    phone: c.phone?.trim() || contactPhone,
    address: c.address?.trim() || null,
    city: c.city?.trim() || null,
    postal_code: postal,
    courier,
    courier_service: service,
    tracking_number: null,
    notes: input.notes?.trim() || null,
    payment_provider: cfg.settings.provider,
  };
  const link = await paymentLink(cfg, draft);

  if (input.replaceUnpaid) {
    const { data: old } = await admin.from("orders").update({ status: "cancelled", cancel_reason: "Diganti pesanan baru" })
      .eq("conversation_id", conv.id).eq("status", "awaiting_payment").select("id");
    for (const o of old ?? []) {
      await admin.from("order_events").insert({ organization_id: orgId, order_id: o.id, event: "cancelled", note: "Diganti pesanan baru" });
    }
  }

  const { data: order, error } = await admin.from("orders").insert({
    ...draft,
    created_by: input.createdBy,
    created_by_ai: input.byAi,
    status: "awaiting_payment",
    payment_ref: link.ref,
    payment_url: link.url,
    expires_at: link.expires_at,
  }).select().single();
  if (error) throw error;
  await admin.from("order_events").insert({
    organization_id: orgId, order_id: id, actor_id: input.createdBy, event: "created",
    note: input.byAi ? "Dibuat AI dari chat" : null,
  });
  return order as Order;
}

function formatDate(iso: string, tz: string) {
  return new Date(iso).toLocaleString("id-ID", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// The message the customer gets with the order and how to pay.
export function invoiceText(order: Order, cfg: PaymentConfig): string {
  const lines = [`🧾 *Pesanan ${order.number}*`];
  for (const i of order.items) lines.push(`${i.qty}x ${i.name} — ${rupiah(i.price * i.qty)}`);
  if (order.shipping_cost > 0 || order.courier) {
    lines.push(`Ongkir${order.courier ? ` ${[order.courier, order.courier_service].filter(Boolean).join(" ")}` : ""} — ${rupiah(order.shipping_cost)}`);
  }
  if (order.discount > 0) lines.push(`Diskon — -${rupiah(order.discount)}`);
  lines.push(`*Total: ${rupiah(order.total)}*`);
  if (order.address) {
    lines.push("", `Dikirim ke: ${[order.customer_name, order.phone].filter(Boolean).join(", ")}`);
    lines.push([order.address, order.city, order.postal_code].filter(Boolean).join(", "));
  }
  lines.push("");
  if (order.payment_url) {
    lines.push(`Bayar di sini (transfer bank, QRIS, e-wallet):`, order.payment_url);
    if (order.expires_at) lines.push(`Berlaku sampai ${formatDate(order.expires_at, cfg.timezone)}.`);
  } else {
    const banks = cfg.settings.bank_accounts ?? [];
    if (banks.length) {
      lines.push("Silakan transfer ke:");
      for (const b of banks) lines.push(`• ${b.bank} ${b.number} a.n. ${b.holder}`);
    } else {
      lines.push("Info pembayaran akan kami kirimkan sebentar lagi.");
    }
    lines.push("Setelah transfer, kirim bukti transfer di chat ini ya 🙏");
  }
  if (cfg.settings.payment_note?.trim()) lines.push("", cfg.settings.payment_note.trim());
  return lines.join("\n");
}

export async function sendInvoice(admin: SupabaseClient, order: Order, senderId: string | null, extra: Record<string, unknown> = {}) {
  if (!order.conversation_id) throw new HttpError(400, "Pesanan ini tidak terhubung ke chat", "invalid_request");
  const cfg = await loadPaymentConfig(admin, order.organization_id);
  const message = await sendToConversation(admin, order.conversation_id, { type: "text", text: invoiceText(order, cfg) }, senderId, {
    ...extra,
    order: { id: order.id, number: order.number },
  });
  await admin.from("order_events").insert({ organization_id: order.organization_id, order_id: order.id, actor_id: senderId, event: "invoice_sent" });
  return message;
}

// Tells the customer; a failed message never undoes the status change.
async function notify(admin: SupabaseClient, order: Order, text: string, senderId: string | null) {
  if (!order.conversation_id) return;
  try {
    await sendToConversation(admin, order.conversation_id, { type: "text", text }, senderId, { order: { id: order.id, number: order.number } });
  } catch (err) {
    console.error(`could not notify customer about order ${order.number}`, err);
  }
}

export async function markPaid(admin: SupabaseClient, orderId: string, source: string, actorId: string | null): Promise<Order | null> {
  const { data: order } = await admin.from("orders").update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", orderId).in("status", ["awaiting_payment", "expired"]).select().maybeSingle();
  if (!order) return null;
  await admin.from("order_events").insert({ organization_id: order.organization_id, order_id: order.id, actor_id: actorId, event: "paid", note: source });
  await notify(
    admin,
    order as Order,
    `✅ Pembayaran pesanan *${order.number}* sebesar *${rupiah(order.total)}* sudah kami terima. Terima kasih kak, pesanan segera kami proses 🙏`,
    actorId,
  );
  return order as Order;
}

const NEXT_STATUS: Record<string, string[]> = {
  awaiting_payment: ["cancelled"],
  expired: ["cancelled"],
  paid: ["processing", "shipped", "completed", "cancelled"],
  processing: ["shipped", "completed", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

export async function setOrderStatus(
  admin: SupabaseClient,
  orderId: string,
  input: { status: string; tracking_number?: string; courier?: string; reason?: string; notify?: boolean },
  actorId: string | null,
): Promise<Order> {
  const { data: current } = await admin.from("orders").select("*").eq("id", orderId).single();
  if (!current) throw new HttpError(404, "Pesanan tidak ditemukan", "not_found");
  if (!NEXT_STATUS[current.status]?.includes(input.status)) {
    throw new HttpError(409, `Pesanan berstatus ${current.status} tidak bisa diubah ke ${input.status}`, "invalid_status");
  }
  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === "shipped") {
    if (!input.tracking_number?.trim()) throw new HttpError(400, "Isi nomor resi", "invalid_request");
    patch.tracking_number = input.tracking_number.trim().slice(0, 80);
    if (input.courier?.trim()) patch.courier = input.courier.trim().slice(0, 60);
    patch.shipped_at = new Date().toISOString();
  }
  if (input.status === "cancelled") patch.cancel_reason = input.reason?.trim() || null;
  const { data: order, error } = await admin.from("orders").update(patch).eq("id", orderId).eq("status", current.status).select().single();
  if (error) throw new HttpError(409, "Status pesanan baru saja berubah, muat ulang", "conflict");
  await admin.from("order_events").insert({
    organization_id: order.organization_id, order_id: order.id, actor_id: actorId, event: input.status,
    note: input.status === "shipped" ? `Resi ${order.tracking_number}` : input.reason ?? null,
  });
  if (input.notify !== false) {
    if (input.status === "shipped") {
      await notify(admin, order as Order, `📦 Pesanan *${order.number}* sudah dikirim${order.courier ? ` via ${order.courier}` : ""}.\nNo. resi: *${order.tracking_number}*`, actorId);
    } else if (input.status === "cancelled" && input.notify) {
      await notify(admin, order as Order, `Pesanan *${order.number}* dibatalkan${order.cancel_reason ? `: ${order.cancel_reason}` : ""}.`, actorId);
    } else if (input.status === "completed" && input.notify) {
      await notify(admin, order as Order, `Pesanan *${order.number}* sudah selesai. Terima kasih sudah berbelanja di toko kami 🙏`, actorId);
    }
  }
  return order as Order;
}

// ---------------------------------------------------------------------------
// Shipment tracking (Biteship)
// ---------------------------------------------------------------------------
// Courier codes Biteship knows, from what agents type ("J&T", "SiCepat REG", "POS Indonesia").
const COURIERS: [RegExp, string][] = [
  [/^j\s*&?\s*t|^jnt/, "jnt"],
  [/^jne/, "jne"],
  [/^si\s*cepat/, "sicepat"],
  [/^anter\s*aja/, "anteraja"],
  [/^pos/, "pos"],
  [/^tiki/, "tiki"],
  [/^ninja/, "ninja"],
  [/^lion/, "lion"],
  [/^id\s*express|^idx/, "idexpress"],
  [/^sap/, "sap"],
  [/^wahana/, "wahana"],
  [/^rpx/, "rpx"],
  [/^paxel/, "paxel"],
  [/^sentral\s*cargo/, "sentralcargo"],
];

export function courierCode(courier: string | null): string | null {
  const c = (courier ?? "").trim().toLowerCase();
  return COURIERS.find(([re]) => re.test(c))?.[1] ?? null;
}

const TRACKING_LABELS: Record<string, string> = {
  confirmed: "pesanan diterima kurir",
  allocated: "kurir sudah ditugaskan",
  picking_up: "kurir menuju lokasi penjemputan",
  picked: "paket sudah diambil kurir",
  dropping_off: "paket sedang diantar ke alamat tujuan",
  on_going: "paket dalam perjalanan",
  return_in_transit: "paket dalam perjalanan kembali ke pengirim",
  on_hold: "paket tertahan di kurir",
  delivered: "paket sudah diterima",
  rejected: "paket ditolak",
  courier_not_found: "kurir belum ditemukan",
  returned: "paket dikembalikan ke pengirim",
  cancelled: "pengiriman dibatalkan",
  disposed: "paket dimusnahkan",
};
export const trackingLabel = (status: string | null) => (status ? TRACKING_LABELS[status] ?? status.replace(/_/g, " ") : null);

export interface Tracking {
  status: string;
  note: string | null;
  updated_at: string | null;
}

// The latest status of a parcel.
export async function trackShipment(key: string, waybill: string, courier: string): Promise<Tracking> {
  const base = Deno.env.get("BITESHIP_API_BASE") || "https://api.biteship.com";
  const body = await callProvider<{ status?: string; history?: { note?: string; status?: string; updated_at?: string }[] }>(
    "Biteship",
    `${base}/v1/trackings/${encodeURIComponent(waybill)}/couriers/${courier}`,
    { headers: { Authorization: key } },
  );
  const last = body.history?.[body.history.length - 1];
  return { status: String(body.status ?? last?.status ?? "on_going").toLowerCase(), note: last?.note ?? null, updated_at: last?.updated_at ?? null };
}

// A delivered parcel completes the order and the customer hears it arrived.
async function delivered(admin: SupabaseClient, order: Order) {
  const { data: done } = await admin.from("orders")
    .update({ status: "completed", delivered_at: new Date().toISOString(), tracking_status: "delivered", tracking_checked_at: new Date().toISOString() })
    .eq("id", order.id).eq("status", "shipped").select().maybeSingle();
  if (!done) return;
  await admin.from("order_events").insert({ organization_id: order.organization_id, order_id: order.id, actor_id: null, event: "completed", note: "Paket diterima (cek resi otomatis)" });
  await notify(
    admin,
    done as Order,
    `📦 Paket pesanan *${order.number}* sudah sampai di alamat tujuan. Terima kasih sudah berbelanja, semoga suka ya kak 🙏\nKalau ada kendala dengan barangnya, kabari kami di chat ini.`,
    null,
  );
}

// Checks one order now (AI "cek resi" and the sweep). Returns the status, or null when it cannot be tracked.
export async function refreshTracking(admin: SupabaseClient, order: Order, key: string): Promise<Tracking | null> {
  const courier = courierCode(order.courier);
  if (!courier || !order.tracking_number) return null;
  const t = await trackShipment(key, order.tracking_number, courier);
  if (t.status === "delivered" && order.status === "shipped") {
    await delivered(admin, order);
  } else {
    await admin.from("orders").update({ tracking_status: t.status, tracking_checked_at: new Date().toISOString() }).eq("id", order.id);
  }
  return t;
}

// Shipped orders of organizations with a Biteship key, every 3 hours each (minute sweep).
export async function sweepTracking(admin: SupabaseClient, deadlineMs = Date.now() + 40_000) {
  const { data: keyed } = await admin.from("payment_secrets").select("organization_id, biteship_api_key").not("biteship_api_key", "is", null);
  if (!keyed?.length) return { tracked: 0, delivered: 0 };
  const keys = new Map<string, string>();
  const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
  const { data: orders } = await admin.from("orders").select("*")
    .eq("status", "shipped").not("tracking_number", "is", null)
    .in("organization_id", keyed.map((k) => k.organization_id))
    .gt("shipped_at", new Date(Date.now() - 45 * 86400_000).toISOString())
    .or(`tracking_checked_at.is.null,tracking_checked_at.lt.${threeHoursAgo}`)
    .order("tracking_checked_at", { ascending: true, nullsFirst: true })
    .limit(25);
  let tracked = 0;
  let arrived = 0;
  for (const order of (orders ?? []) as (Order & { shipped_at: string })[]) {
    if (Date.now() > deadlineMs) break;
    try {
      if (!keys.has(order.organization_id)) {
        const enc = keyed.find((k) => k.organization_id === order.organization_id)?.biteship_api_key;
        keys.set(order.organization_id, enc ? await decryptSecret(enc) : "");
      }
      const key = keys.get(order.organization_id);
      if (!key || !courierCode(order.courier)) {
        await admin.from("orders").update({ tracking_checked_at: new Date().toISOString() }).eq("id", order.id);
        continue;
      }
      const t = await refreshTracking(admin, order, key);
      tracked++;
      if (t?.status === "delivered") arrived++;
    } catch (err) {
      // Wrong number or courier: try again in three hours.
      await admin.from("orders").update({ tracking_checked_at: new Date().toISOString() }).eq("id", order.id);
      if (!(err instanceof HttpError)) console.error(`tracking ${order.number} failed`, err);
    }
  }
  return { tracked, delivered: arrived };
}
