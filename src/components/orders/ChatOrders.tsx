import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { OrderDetail, StatusBadge } from "./OrderDetail";
import { OrderDialog } from "./OrderDialog";
import { rupiah } from "./orders";

// The chat's orders, and a button to create one.
export function ChatOrders({
  conversationId,
  orgId,
  contact,
}: {
  conversationId: string;
  orgId: string;
  contact: { name: string; phone: string };
}) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: orders = [] } = useQuery({
    queryKey: ["chat-orders", conversationId],
    queryFn: async () =>
      (
        await supabase
          .from("orders")
          .select("id, number, status, total, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(10)
      ).data ?? [],
    refetchInterval: 30_000,
  });
  const open = orders.filter((o) => ["awaiting_payment", "paid", "processing"].includes(o.status)).length;

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className={cn("gap-1", open > 0 && "border-primary/40 text-primary")}>
            <ShoppingBag className="h-4 w-4" />
            Pesanan{orders.length ? ` (${orders.length})` : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-2 text-sm">
          {orders.length === 0 && <p className="text-muted-foreground">Belum ada pesanan di chat ini.</p>}
          {orders.map((o) => (
            <button key={o.id} onClick={() => setOpenId(o.id)} className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left hover:bg-muted">
              <span>
                <span className="block font-medium">{o.number}</span>
                <span className="text-xs text-muted-foreground">{rupiah(o.total)}</span>
              </span>
              <StatusBadge status={o.status} />
            </button>
          ))}
          <Button size="sm" className="w-full" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Buat pesanan
          </Button>
        </PopoverContent>
      </Popover>
      <OrderDialog
        open={creating}
        onOpenChange={setCreating}
        orgId={orgId}
        conversationId={conversationId}
        defaults={contact}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["chat-orders", conversationId] })}
      />
      <OrderDetail orderId={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </>
  );
}
