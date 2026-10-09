import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Loader2, Megaphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { rpShort } from "./shared";

// The ad a chat came from, and its closings.
export function useChatAds(conversationId: string) {
  return useQuery({
    queryKey: ["chat-ads", conversationId],
    queryFn: async () => {
      const [{ data: lead }, { data: closings }, { data: orders }] = await Promise.all([
        supabase.from("ad_leads").select("id, source, campaign_name, ad_name, headline, created_at").eq("conversation_id", conversationId).maybeSingle(),
        supabase.from("ad_conversions").select("id, kind, value, note, created_by, occurred_at, order_id").eq("conversation_id", conversationId).is("cancelled_at", null).order("occurred_at"),
        supabase.from("orders").select("id, number, total, status").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(5),
      ]);
      return { lead, closings: closings ?? [], orders: orders ?? [] };
    },
  });
}

export function adLabel(lead: { source: string; campaign_name: string | null; ad_name: string | null; headline: string | null }) {
  const what = lead.campaign_name ?? lead.headline ?? lead.ad_name;
  return `${lead.source === "link" ? "Landing page" : "Iklan"}${what ? ` · ${what}` : ""}`;
}

// Strip above the messages: where the customer came from and the closing total.
export function AdLeadBanner({ conversationId, compact = false }: { conversationId: string; compact?: boolean }) {
  const { data } = useChatAds(conversationId);
  if (!data?.lead && !data?.closings.length) return null;
  const total = (data.closings ?? []).reduce((n, c) => n + Number(c.value), 0);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm", data.lead ? "border-primary/20 bg-primary/5 text-primary-dark" : "bg-success/5")}>
      {data.lead && (
        <span className="flex min-w-0 items-center gap-1.5">
          <Megaphone className="h-4 w-4 shrink-0" />
          <b>{data.lead.source === "link" ? "Dari iklan lewat landing page" : "Dari iklan klik-ke-chat"}</b>
          {!compact && (
            <span className="truncate">
              {[data.lead.campaign_name, data.lead.ad_name ?? data.lead.headline].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      )}
      {data.closings.length > 0 && (
        <span className="ml-auto flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
          <BadgeCheck className="h-3.5 w-3.5" /> Closing {rpShort(total)}
        </span>
      )}
    </div>
  );
}

const PAID = ["paid", "processing", "shipped", "completed"];

export function ClosingDialog({
  conversationId,
  contactName,
  meId,
  canManage,
  open,
  onOpenChange,
}: {
  conversationId: string;
  contactName: string;
  meId: string;
  canManage: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data } = useChatAds(conversationId);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [send, setSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const paidOrders = (data?.orders ?? []).filter((o) => PAID.includes(o.status));
  const amount = Number(value.replace(/\D/g, ""));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["chat-ads", conversationId] });
    qc.invalidateQueries({ queryKey: ["ads-summary"] });
    qc.invalidateQueries({ queryKey: ["ads-report"] });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("mark_closing", { p_conversation: conversationId, p_value: amount, p_note: note.trim() || undefined, p_send: send });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`Closing ${rpShort(amount)} dicatat${data?.lead && send ? " dan dikirim ke Meta" : ""}`);
    setValue("");
    setNote("");
    refresh();
    onOpenChange(false);
  };
  const cancel = async (id: string) => {
    if (!window.confirm("Batalkan closing ini?")) return;
    const { error } = await supabase.rpc("cancel_closing", { p_id: id });
    if (error) return toast.error(errorMessage(error));
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Tandai closing · {contactName}</DialogTitle>
            <DialogDescription>
              {data?.lead
                ? `Nilai ini dihitung di ROAS ${data.lead.campaign_name ? `“${data.lead.campaign_name}”` : "iklan asal pelanggan"} dan bisa dikirim ke Meta sebagai Purchase.`
                : "Pelanggan ini tidak tercatat dari iklan. Closing tetap dicatat, tapi tidak masuk ROAS iklan."}
            </DialogDescription>
          </DialogHeader>

          {(paidOrders.length > 0 || (data?.closings.length ?? 0) > 0) && (
            <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">Sudah tercatat</p>
              {(data?.closings ?? []).map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-success" />
                  <span className="flex-1">
                    {c.kind === "order" ? `Pesanan ${data?.orders.find((o) => o.id === c.order_id)?.number ?? "lunas"}` : c.note || "Closing manual"}
                  </span>
                  <b className="tabular-nums">{rpShort(c.value)}</b>
                  {c.kind === "manual" && (c.created_by === meId || canManage) && (
                    <button type="button" onClick={() => cancel(c.id)} aria-label="Batalkan closing" className="text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Pesanan yang lunas di menu Pesanan otomatis dihitung; isi di bawah hanya untuk transaksi di luar menu Pesanan.</p>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="closing-value">Nilai closing (Rp)</Label>
            <Input
              id="closing-value"
              inputMode="numeric"
              autoFocus
              value={value ? Number(value.replace(/\D/g, "")).toLocaleString("id-ID") : ""}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              placeholder="200.000"
              className="text-lg font-bold"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="closing-note">Catatan (opsional)</Label>
            <Input id="closing-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. transfer BCA, COD" />
          </div>
          {data?.lead && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={send} onCheckedChange={(v) => setSend(v === true)} />
              Kirim ke Meta (Purchase) agar iklan belajar mencari pembeli
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" className="bg-success text-success-foreground hover:bg-success/90" disabled={busy || amount <= 0}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Simpan closing
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
