import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type OrderRow = Tables<"orders">;
export type PaymentSettingsRow = Tables<"payment_settings">;
export interface OrderItem {
  product_id: string | null;
  name: string;
  qty: number;
  price: number;
  weight_grams?: number;
}
export interface Rate {
  courier: string;
  courier_name: string;
  service: string;
  service_name: string;
  price: number;
  etd: string;
}

export const rupiah = (n: number | string | null | undefined) => `Rp${Math.round(Number(n ?? 0)).toLocaleString("id-ID")}`;

export const ORDER_STATUS: Record<string, { label: string; className: string }> = {
  awaiting_payment: { label: "Menunggu bayar", className: "bg-warning/15 text-warning" },
  paid: { label: "Lunas", className: "bg-success/15 text-success" },
  processing: { label: "Diproses", className: "bg-primary/10 text-primary" },
  shipped: { label: "Dikirim", className: "bg-primary/10 text-primary" },
  completed: { label: "Selesai", className: "bg-muted text-foreground" },
  cancelled: { label: "Dibatalkan", className: "bg-destructive/10 text-destructive" },
  expired: { label: "Kedaluwarsa", className: "bg-muted text-muted-foreground" },
};

// The next steps an agent can take on an order (mirrors the server rules).
export const NEXT_STATUS: Record<string, string[]> = {
  awaiting_payment: ["cancelled"],
  expired: ["cancelled"],
  paid: ["processing", "shipped", "completed", "cancelled"],
  processing: ["shipped", "completed", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

export const PROVIDER_LABEL: Record<string, string> = { manual: "Transfer manual", xendit: "Xendit", midtrans: "Midtrans" };

export function usePaymentSettings(orgId: string) {
  return useQuery({
    queryKey: ["payment-settings", orgId],
    queryFn: async () => (await supabase.from("payment_settings").select("*").maybeSingle()).data,
  });
}

export function useCatalog(orgId: string) {
  return useQuery({
    queryKey: ["catalog", orgId],
    queryFn: async () =>
      (await supabase.from("products").select("id, name, price, weight_grams, is_active").eq("is_active", true).order("name")).data ?? [],
  });
}

export function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
