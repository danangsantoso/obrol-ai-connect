import { useState } from "react";
import { Loader2, Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { callFunction, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { type OrderRow, type Rate, rupiah, useCatalog, usePaymentSettings } from "./orders";

interface Line {
  product_id: string;
  custom: boolean;
  name: string;
  price: string;
  qty: number;
}

const CUSTOM = "__custom";
const digits = (s: string) => Number(s.replace(/\D/g, "")) || 0;

export function OrderDialog({
  open,
  onOpenChange,
  orgId,
  conversationId,
  defaults,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  conversationId: string;
  defaults: { name: string; phone: string };
  onCreated: (order: OrderRow) => void;
}) {
  const { data: catalog = [] } = useCatalog(orgId);
  const { data: settings } = usePaymentSettings(orgId);
  const mode = settings?.shipping_mode ?? "none";
  const [lines, setLines] = useState<Line[]>([{ product_id: "", custom: false, name: "", price: "", qty: 1 }]);
  const [customer, setCustomer] = useState({ name: defaults.name, phone: defaults.phone, address: "", city: "", postal_code: "" });
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [manualShip, setManualShip] = useState({ courier: "", cost: "" });
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [sendInvoice, setSendInvoice] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const priceOf = (l: Line) => {
    const p = catalog.find((x) => x.id === l.product_id);
    return p ? Number(p.price ?? 0) : digits(l.price);
  };
  const subtotal = lines.reduce((n, l) => n + priceOf(l) * l.qty, 0);
  const shipping =
    mode === "flat" ? Number(settings?.flat_shipping_cost ?? 0) : mode === "biteship" ? (rate !== null && rates ? rates[rate].price : 0) : digits(manualShip.cost);
  const total = Math.max(0, subtotal + shipping - digits(discount));

  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const items = () =>
    lines
      .filter((l) => l.product_id || l.name.trim())
      .map((l) => (l.product_id ? { product_id: l.product_id, qty: l.qty } : { name: l.name.trim(), price: digits(l.price), qty: l.qty }));

  const checkRates = async () => {
    setBusy("rates");
    try {
      const r = await callFunction<{ rates: Rate[] }>("orders", { action: "rates", postal_code: customer.postal_code, items: items() });
      setRates(r.rates);
      setRate(r.rates.length ? 0 : null);
      if (!r.rates.length) toast.error("Tidak ada kurir untuk kode pos ini");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    const list = items();
    if (!list.length) return toast.error("Tambahkan produk");
    if (lines.some((l) => l.custom && l.name.trim() && !l.price.trim())) return toast.error("Isi harga untuk produk lainnya");
    if (mode === "biteship" && rate === null) return toast.error("Cek ongkir dan pilih kurir dulu");
    let shippingInput: { courier: string; service: string; cost: number } | null = null;
    if (mode === "flat") shippingInput = { courier: "", service: "", cost: shipping };
    else if (mode === "biteship" && rates && rate !== null) {
      const r = rates[rate];
      shippingInput = { courier: r.courier_name, service: r.service_name, cost: r.price };
    } else if (manualShip.courier.trim() || digits(manualShip.cost)) {
      shippingInput = { courier: manualShip.courier.trim(), service: "", cost: digits(manualShip.cost) };
    }
    setBusy("create");
    try {
      const r = await callFunction<{ order: OrderRow; invoice_error: string | null }>("orders", {
        action: "create",
        conversation_id: conversationId,
        items: list,
        customer,
        shipping: shippingInput,
        discount: digits(discount),
        notes,
        send_invoice: sendInvoice,
      });
      if (r.invoice_error) toast.warning(`Pesanan ${r.order.number} dibuat, tapi tagihan gagal dikirim: ${r.invoice_error}`);
      else toast.success(`Pesanan ${r.order.number} dibuat${sendInvoice ? " dan tagihan dikirim" : ""}`);
      onCreated(r.order);
      onOpenChange(false);
      setLines([{ product_id: "", custom: false, name: "", price: "", qty: 1 }]);
      setRates(null);
      setRate(null);
      setDiscount("");
      setNotes("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Buat pesanan</DialogTitle>
          <DialogDescription>Harga produk diambil dari katalog. Tagihan dan cara bayar dikirim ke chat ini.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Produk</Label>
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_120px_80px_auto]">
                {l.custom ? (
                  <Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="Nama produk lainnya" aria-label={`Nama produk ${i + 1}`} />
                ) : (
                  <Select
                    value={l.product_id || undefined}
                    onValueChange={(v) => setLine(i, v === CUSTOM ? { product_id: "", custom: true } : { product_id: v, custom: false, name: "" })}
                  >
                    <SelectTrigger aria-label={`Produk ${i + 1}`}>
                      <SelectValue placeholder="Pilih produk" />
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.map((p) => (
                        <SelectItem key={p.id} value={p.id} disabled={p.price === null}>
                          {p.name} · {p.price === null ? "harga belum diisi" : rupiah(p.price)}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM}>Lainnya (isi manual)…</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Input
                  value={l.product_id ? rupiah(priceOf(l)) : l.price}
                  readOnly={!!l.product_id}
                  onChange={(e) => setLine(i, { price: e.target.value })}
                  placeholder="Harga"
                  inputMode="numeric"
                  aria-label={`Harga ${i + 1}`}
                />
                <Input type="number" min={1} max={999} value={l.qty} onChange={(e) => setLine(i, { qty: Math.min(999, Math.max(1, Number(e.target.value) || 1)) })} aria-label={`Jumlah ${i + 1}`} />
                <Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Hapus baris ${i + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { product_id: "", custom: false, name: "", price: "", qty: 1 }])}>
              <Plus className="mr-1 h-4 w-4" /> Tambah produk
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="o-name">Nama penerima</Label>
              <Input id="o-name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="o-phone">No. HP</Label>
              <Input id="o-phone" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="o-address">Alamat</Label>
              <Input id="o-address" value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="o-city">Kota</Label>
              <Input id="o-city" value={customer.city} onChange={(e) => setCustomer({ ...customer, city: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="o-postal">Kode pos</Label>
              <Input id="o-postal" inputMode="numeric" maxLength={5} value={customer.postal_code} onChange={(e) => { setCustomer({ ...customer, postal_code: e.target.value.replace(/\D/g, "") }); setRates(null); setRate(null); }} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Ongkir</Label>
            {mode === "flat" && <p className="text-sm">Tarif tetap {rupiah(settings?.flat_shipping_cost)}</p>}
            {mode === "biteship" && (
              <div className="space-y-2">
                <Button type="button" variant="outline" size="sm" onClick={checkRates} disabled={busy !== null || customer.postal_code.length !== 5}>
                  {busy === "rates" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Truck className="mr-1 h-4 w-4" />} Cek ongkir
                </Button>
                {rates && (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {rates.map((r, i) => (
                      <button
                        key={`${r.courier}-${r.service}`}
                        type="button"
                        onClick={() => setRate(i)}
                        className={cn("rounded-md border p-2 text-left text-sm", rate === i && "border-primary ring-1 ring-primary")}
                      >
                        <span className="font-medium">{r.courier_name} {r.service_name}</span> · {rupiah(r.price)}
                        {r.etd && <span className="block text-xs text-muted-foreground">{r.etd}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mode === "none" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={manualShip.courier} onChange={(e) => setManualShip({ ...manualShip, courier: e.target.value })} placeholder="Kurir (opsional)" aria-label="Kurir" />
                <Input value={manualShip.cost} onChange={(e) => setManualShip({ ...manualShip, cost: e.target.value })} placeholder="Ongkir (Rp)" inputMode="numeric" aria-label="Ongkir" />
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="o-discount">Diskon (Rp)</Label>
              <Input id="o-discount" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="o-notes">Catatan</Label>
              <Textarea id="o-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg bg-muted/60 p-3 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{rupiah(subtotal)}</span></div>
            <div className="flex justify-between"><span>Ongkir</span><span>{rupiah(shipping)}</span></div>
            {digits(discount) > 0 && <div className="flex justify-between"><span>Diskon</span><span>-{rupiah(digits(discount))}</span></div>}
            <div className="mt-1 flex justify-between border-t pt-1 font-semibold" data-testid="order-total"><span>Total</span><span>{rupiah(total)}</span></div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={sendInvoice} onCheckedChange={(v) => setSendInvoice(v === true)} aria-label="Kirim tagihan ke chat" />
            Kirim tagihan dan cara bayar ke chat
          </label>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={busy !== null}>
            {busy === "create" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Buat pesanan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
