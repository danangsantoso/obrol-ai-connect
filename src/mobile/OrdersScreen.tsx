import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { callFunction, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ORDER_STATUS, formatDateTime, rupiah, type OrderItem, type OrderRow } from "@/components/orders/orders";
import { BottomNav, Empty, Screen, Segmented } from "./ui";
import { Sheet } from "./ChatScreen";

type Tab = "pay" | "process" | "sent";
const TAB_STATUS: Record<Tab, string[]> = { pay: ["awaiting_payment"], process: ["paid", "processing"], sent: ["shipped"] };

export default function OrdersScreen() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("pay");
  const [busy, setBusy] = useState<string | null>(null);
  const [shipping, setShipping] = useState<OrderRow | null>(null);
  const [resi, setResi] = useState({ courier: "", tracking: "" });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["m-orders", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .in("status", ["awaiting_payment", "paid", "processing", "shipped"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });
  const count = (t: Tab) => orders.filter((o) => TAB_STATUS[t].includes(o.status)).length;
  const rows = orders.filter((o) => TAB_STATUS[tab].includes(o.status));

  const act = async (order: OrderRow, body: Record<string, unknown>, done: string) => {
    setBusy(order.id);
    try {
      await callFunction("orders", { order_id: order.id, ...body });
      toast.success(done);
      queryClient.invalidateQueries({ queryKey: ["m-orders", orgId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const confirmPaid = (o: OrderRow) => {
    if (!window.confirm(`Konfirmasi pembayaran ${o.number} sebesar ${rupiah(o.total)}? Pastikan dana sudah masuk ke rekening.`)) return;
    act(o, { action: "mark_paid" }, "Pembayaran dikonfirmasi");
  };
  const ship = async () => {
    if (!shipping) return;
    const ok = await act(
      shipping,
      { action: "set_status", status: "shipped", courier: resi.courier.trim() || undefined, tracking_number: resi.tracking.trim() || undefined, notify: true },
      "Pesanan dikirim, pelanggan dikabari",
    );
    if (ok) setShipping(null);
  };

  return (
    <Screen
      header={
        <header className="space-y-3 border-b border-slate-200 bg-white px-4 pb-3.5 pt-[max(env(safe-area-inset-top),16px)]">
          <h1 className="text-[22px] font-extrabold">Pesanan</h1>
          <Segmented<Tab>
            label="Status pesanan"
            value={tab}
            onChange={setTab}
            options={[
              { value: "pay", label: "Belum bayar", count: count("pay") },
              { value: "process", label: "Diproses", count: count("process") },
              { value: "sent", label: "Dikirim", count: count("sent") },
            ]}
          />
        </header>
      }
      footer={<BottomNav />}
    >
      {isLoading ? (
        <Empty>Memuat pesanan…</Empty>
      ) : rows.length === 0 ? (
        <Empty>Tidak ada pesanan di sini.</Empty>
      ) : (
        <div className="space-y-3 p-4">
          {rows.map((o) => {
            const st = ORDER_STATUS[o.status];
            return (
              <article key={o.id} className="space-y-2.5 rounded-2xl bg-white p-4">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[15px] font-extrabold">{o.number}</span>
                  <span className={cn("rounded-lg px-2 py-1 text-xs font-bold", st?.className)}>{st?.label ?? o.status}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold">{o.customer_name || "Pelanggan"}</p>
                  <p className="text-[13px] text-slate-600">
                    {(o.items as unknown as OrderItem[]).map((i) => `${i.qty}x ${i.name}`).join(", ")}
                    {o.tracking_number ? ` · ${[o.courier, o.tracking_number].filter(Boolean).join(" ")}` : ""}
                  </p>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <span className="text-base font-extrabold">{rupiah(o.total)}</span>
                  <span className="text-xs text-slate-600">{formatDateTime(o.created_at)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {o.conversation_id ? (
                    <Link to={`/m/chat/${o.conversation_id}`} className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 text-[13px] font-bold">
                      Buka chat
                    </Link>
                  ) : (
                    <span />
                  )}
                  {o.status === "awaiting_payment" && (
                    <button disabled={busy === o.id} onClick={() => confirmPaid(o)} className="flex min-h-[44px] items-center justify-center rounded-xl bg-green-700 text-[13px] font-bold text-white">
                      {busy === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Konfirmasi bayar"}
                    </button>
                  )}
                  {(o.status === "paid" || o.status === "processing") && (
                    <button
                      onClick={() => {
                        setResi({ courier: o.courier ?? "", tracking: o.tracking_number ?? "" });
                        setShipping(o);
                      }}
                      className="min-h-[44px] rounded-xl bg-primary text-[13px] font-bold text-white"
                    >
                      Input resi
                    </button>
                  )}
                  {o.status === "shipped" && (
                    <button
                      disabled={busy === o.id}
                      onClick={() => act(o, { action: "set_status", status: "completed" }, "Pesanan selesai")}
                      className="flex min-h-[44px] items-center justify-center rounded-xl bg-primary text-[13px] font-bold text-white"
                    >
                      {busy === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tandai selesai"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {shipping && (
        <Sheet title={`Kirim ${shipping.number}`} onClose={() => setShipping(null)}>
          <div className="space-y-3 px-2 pb-2">
            <div className="space-y-1.5">
              <label htmlFor="m-courier" className="text-[13px] font-semibold">
                Kurir
              </label>
              <input
                id="m-courier"
                value={resi.courier}
                onChange={(e) => setResi({ ...resi, courier: e.target.value })}
                placeholder="JNE, J&T, SiCepat…"
                className="h-12 w-full rounded-xl border border-slate-300 px-3.5 text-[15px] outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="m-resi" className="text-[13px] font-semibold">
                Nomor resi
              </label>
              <input
                id="m-resi"
                value={resi.tracking}
                onChange={(e) => setResi({ ...resi, tracking: e.target.value })}
                className="h-12 w-full rounded-xl border border-slate-300 px-3.5 text-[15px] outline-none focus:border-primary"
              />
            </div>
            <p className="text-xs text-slate-600">Pelanggan otomatis dikabari lewat chat beserta nomor resinya.</p>
            <button onClick={ship} disabled={busy === shipping.id} className="flex min-h-[50px] w-full items-center justify-center rounded-2xl bg-primary font-bold text-white">
              {busy === shipping.id ? <Loader2 className="h-5 w-5 animate-spin" /> : "Tandai dikirim"}
            </button>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
