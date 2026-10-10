import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, MessageSquare, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { callFunction, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { NEXT_STATUS, ORDER_STATUS, type OrderItem, type OrderRow, PROVIDER_LABEL, formatDateTime, rupiah, trackingLabel } from "./orders";

const EVENT_LABEL: Record<string, string> = {
  created: "Pesanan dibuat",
  invoice_sent: "Tagihan dikirim",
  paid: "Lunas",
  underpaid: "Pembayaran kurang",
  processing: "Diproses",
  shipped: "Dikirim",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  expired: "Kedaluwarsa",
};

export function StatusBadge({ status }: { status: string }) {
  const s = ORDER_STATUS[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("border-0", s.className)}>
      {s.label}
    </Badge>
  );
}

export function OrderDetail({ orderId, onOpenChange }: { orderId: string | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [resi, setResi] = useState({ tracking: "", courier: "" });

  const { data } = useQuery({
    queryKey: ["order", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const [{ data: order }, { data: events }] = await Promise.all([
        supabase.from("orders").select("*").eq("id", orderId!).single(),
        supabase.from("order_events").select("*, actor:profiles(full_name, email)").eq("order_id", orderId!).order("created_at"),
      ]);
      return { order: order as OrderRow, events: events ?? [] };
    },
  });
  const order = data?.order;

  const run = async (action: string, body: Record<string, unknown> = {}, done = "Pesanan diperbarui") => {
    if (!order) return;
    setBusy(action + (body.status ?? ""));
    try {
      await callFunction("orders", { action, order_id: order.id, ...body });
      toast.success(done);
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["chat-orders"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const next = order ? NEXT_STATUS[order.status] ?? [] : [];
  const items = (order?.items as unknown as OrderItem[]) ?? [];

  return (
    <Sheet open={!!orderId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {!order ? (
          <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {order.number} <StatusBadge status={order.status} />
              </SheetTitle>
              <SheetDescription>
                Dibuat {formatDateTime(order.created_at)} {order.created_by_ai ? "oleh AI" : ""} · {PROVIDER_LABEL[order.payment_provider] ?? order.payment_provider}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-1 text-sm">
              {items.map((i, k) => (
                <div key={k} className="flex justify-between gap-2">
                  <span>{i.qty}x {i.name}</span>
                  <span>{rupiah(i.price * i.qty)}</span>
                </div>
              ))}
              {(Number(order.shipping_cost) > 0 || order.courier) && (
                <div className="flex justify-between gap-2 text-muted-foreground">
                  <span>Ongkir {[order.courier, order.courier_service].filter(Boolean).join(" ")}</span>
                  <span>{rupiah(order.shipping_cost)}</span>
                </div>
              )}
              {Number(order.discount) > 0 && (
                <div className="flex justify-between gap-2 text-muted-foreground"><span>Diskon</span><span>-{rupiah(order.discount)}</span></div>
              )}
              <div className="flex justify-between gap-2 border-t pt-1 font-semibold"><span>Total</span><span>{rupiah(order.total)}</span></div>
            </div>

            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <p className="font-medium">{order.customer_name ?? "-"} {order.phone && <span className="font-normal text-muted-foreground">· {order.phone}</span>}</p>
              <p className="text-muted-foreground">{[order.address, order.city, order.postal_code].filter(Boolean).join(", ") || "Alamat belum diisi"}</p>
              {order.tracking_number && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span>
                    Resi: <span className="font-mono">{order.tracking_number}</span>
                  </span>
                  {order.status === "shipped" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      disabled={busy !== null}
                      onClick={async () => {
                        setBusy("track");
                        try {
                          const r = await callFunction<{ label: string | null }>("orders", { action: "track", order_id: order.id });
                          toast.success(r.label ? `Posisi paket: ${r.label}` : "Status paket diperbarui");
                          queryClient.invalidateQueries({ queryKey: ["order", orderId] });
                          queryClient.invalidateQueries({ queryKey: ["orders"] });
                        } catch (err) {
                          toast.error(errorMessage(err));
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === "track" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Truck className="mr-1 h-3.5 w-3.5" />} Cek resi
                    </Button>
                  )}
                </div>
              )}
              {(order.tracking_status || order.delivered_at) && (
                <p className="text-xs text-muted-foreground">
                  {order.delivered_at ? `Paket diterima ${formatDateTime(order.delivered_at)}` : `Posisi: ${trackingLabel(order.tracking_status)}`}
                  {order.tracking_checked_at && !order.delivered_at && ` · dicek ${formatDateTime(order.tracking_checked_at)}`}
                </p>
              )}
              {order.notes && <p className="mt-1">Catatan: {order.notes}</p>}
            </div>

            <div className="flex flex-wrap gap-2">
              {order.conversation_id && (
                <Button asChild variant="outline" size="sm">
                  <Link to={`/inbox/${order.conversation_id}`}><MessageSquare className="mr-1 h-4 w-4" /> Buka chat</Link>
                </Button>
              )}
              {order.payment_url && (
                <Button asChild variant="outline" size="sm">
                  <a href={order.payment_url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" /> Link bayar</a>
                </Button>
              )}
              {order.status === "awaiting_payment" && (
                <>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("send_invoice", {}, "Tagihan dikirim ulang")}>
                    Kirim ulang tagihan
                  </Button>
                  <Button size="sm" disabled={busy !== null} onClick={() => run("mark_paid", {}, "Pesanan ditandai lunas")}>
                    Tandai lunas
                  </Button>
                </>
              )}
              {order.status === "expired" && (
                <Button size="sm" disabled={busy !== null} onClick={() => run("mark_paid", {}, "Pesanan ditandai lunas")}>
                  Tandai lunas
                </Button>
              )}
              {next.includes("processing") && (
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("set_status", { status: "processing" })}>
                  Proses
                </Button>
              )}
              {next.includes("completed") && (
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("set_status", { status: "completed", notify: true })}>
                  Selesai
                </Button>
              )}
              {next.includes("cancelled") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={busy !== null}
                  onClick={() => {
                    const reason = window.prompt("Alasan pembatalan (dikirim ke pelanggan):");
                    if (reason !== null) run("set_status", { status: "cancelled", reason, notify: true }, "Pesanan dibatalkan");
                  }}
                >
                  Batalkan
                </Button>
              )}
            </div>

            {next.includes("shipped") && (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">Kirim pesanan</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={resi.courier} onChange={(e) => setResi({ ...resi, courier: e.target.value })} placeholder={order.courier ?? "Kurir"} aria-label="Kurir pengiriman" />
                  <Input value={resi.tracking} onChange={(e) => setResi({ ...resi, tracking: e.target.value })} placeholder="Nomor resi" aria-label="Nomor resi" />
                </div>
                <Button
                  size="sm"
                  disabled={busy !== null || !resi.tracking.trim()}
                  onClick={() => run("set_status", { status: "shipped", tracking_number: resi.tracking, courier: resi.courier || order.courier }, "Resi dikirim ke pelanggan")}
                >
                  Simpan resi & beri tahu pelanggan
                </Button>
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-medium">Riwayat</p>
              <ol className="space-y-2 border-l pl-4 text-sm">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{EVENT_LABEL[e.event] ?? e.event}</span>
                    {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(e.created_at)}
                      {(e.actor as { full_name: string | null; email: string } | null) &&
                        ` · ${(e.actor as { full_name: string | null; email: string }).full_name || (e.actor as { email: string }).email}`}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
