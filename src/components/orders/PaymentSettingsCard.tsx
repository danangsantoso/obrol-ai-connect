import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { callFunction, errorMessage } from "@/lib/api";
import { toast } from "sonner";
import { usePaymentSettings } from "./orders";

interface Bank {
  bank: string;
  number: string;
  holder: string;
}

const DEFAULTS = {
  provider: "manual" as "manual" | "xendit" | "midtrans",
  bank_accounts: [] as Bank[],
  payment_note: "",
  midtrans_production: false,
  invoice_hours: 24,
  shipping_mode: "none" as "none" | "flat" | "biteship",
  flat_shipping_cost: 0,
  origin_postal_code: "",
  couriers: "jne,sicepat,jnt,anteraja",
  ai_create_orders: false,
};

function KeyInput({ id, label, hint, field, onSaved }: { id: string; label: string; hint: string | null; field: string; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (clear = false) => {
    setBusy(true);
    try {
      await callFunction("orders", { action: "set_keys", keys: { [field]: clear ? null : value.trim() } });
      toast.success(clear ? "Key dihapus" : "Key disimpan");
      setValue("");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="flex items-center gap-2">
        {label} {hint && <Badge variant="secondary">tersimpan {hint}</Badge>}
      </Label>
      <div className="flex gap-2">
        <Input id={id} type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder={hint ? "Isi untuk mengganti" : ""} autoComplete="off" />
        <Button type="button" variant="outline" onClick={() => save()} disabled={busy || value.trim().length < 8}>
          <KeyRound className="mr-1 h-4 w-4" /> Simpan
        </Button>
        {hint && (
          <Button type="button" variant="ghost" size="icon" onClick={() => save(true)} disabled={busy} aria-label={`Hapus ${label}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Copyable({ value }: { value: string }) {
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-xs" />
      <Button type="button" variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("URL disalin"))} aria-label="Salin URL">
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function PaymentSettingsCard({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data: settings, isFetched } = usePaymentSettings(orgId);
  const [form, setForm] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isFetched || loaded) return;
    setLoaded(true);
    if (!settings) return;
    setForm({
      provider: settings.provider as typeof DEFAULTS.provider,
      bank_accounts: (settings.bank_accounts as unknown as Bank[]) ?? [],
      payment_note: settings.payment_note,
      midtrans_production: settings.midtrans_production,
      invoice_hours: settings.invoice_hours,
      shipping_mode: settings.shipping_mode as typeof DEFAULTS.shipping_mode,
      flat_shipping_cost: Number(settings.flat_shipping_cost),
      origin_postal_code: settings.origin_postal_code ?? "",
      couriers: settings.couriers,
      ai_create_orders: settings.ai_create_orders,
    });
  }, [settings, isFetched, loaded]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["payment-settings", orgId] });
  const hookUrl = (provider: string) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-webhook?org=${orgId}&provider=${provider}`;

  const save = async () => {
    if (form.shipping_mode === "biteship" && !/^\d{5}$/.test(form.origin_postal_code)) return toast.error("Isi kode pos asal (5 angka)");
    if (form.provider === "manual" && form.bank_accounts.some((b) => !b.bank.trim() || !b.number.trim() || !b.holder.trim())) {
      return toast.error("Lengkapi data rekening");
    }
    setSaving(true);
    const { error } = await supabase.from("payment_settings").upsert(
      {
        organization_id: orgId,
        ...form,
        origin_postal_code: form.origin_postal_code.trim() || null,
        couriers: form.couriers.toLowerCase().replace(/\s+/g, "") || "jne",
        payment_note: form.payment_note.trim(),
        bank_accounts: form.bank_accounts.map((b) => ({ bank: b.bank.trim(), number: b.number.trim(), holder: b.holder.trim() })),
      },
      { onConflict: "organization_id" },
    );
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Pengaturan pembayaran disimpan");
    refresh();
  };

  const setBank = (i: number, patch: Partial<Bank>) =>
    setForm({ ...form, bank_accounts: form.bank_accounts.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pembayaran & ongkir</CardTitle>
        <CardDescription>
          Cara pelanggan membayar pesanan dari chat, dan cara menghitung ongkir. Tagihan dikirim otomatis ke chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset disabled={!isAdmin} className="space-y-6">
          <section className="space-y-3">
            <div className="grid max-w-3xl gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Metode pembayaran</Label>
                <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v as typeof form.provider })}>
                  <SelectTrigger aria-label="Metode pembayaran">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Transfer bank (dikonfirmasi agen)</SelectItem>
                    <SelectItem value="xendit">Xendit (link bayar: VA, QRIS, e-wallet)</SelectItem>
                    <SelectItem value="midtrans">Midtrans Snap (VA, QRIS, e-wallet, kartu)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-hours">Batas waktu bayar (jam)</Label>
                <Input
                  id="pay-hours"
                  type="number"
                  min={1}
                  max={168}
                  value={form.invoice_hours}
                  onChange={(e) => setForm({ ...form, invoice_hours: Math.min(168, Math.max(1, Number(e.target.value) || 24)) })}
                />
              </div>
            </div>

            {form.provider === "manual" && (
              <div className="max-w-3xl space-y-2">
                <Label>Rekening tujuan transfer</Label>
                {form.bank_accounts.map((b, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[120px_1fr_1fr_auto]">
                    <Input value={b.bank} placeholder="BCA" onChange={(e) => setBank(i, { bank: e.target.value })} aria-label="Bank" />
                    <Input value={b.number} placeholder="Nomor rekening" onChange={(e) => setBank(i, { number: e.target.value })} aria-label="Nomor rekening" />
                    <Input value={b.holder} placeholder="Atas nama" onChange={(e) => setBank(i, { holder: e.target.value })} aria-label="Atas nama" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => setForm({ ...form, bank_accounts: form.bank_accounts.filter((_, j) => j !== i) })} aria-label="Hapus rekening">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {form.bank_accounts.length < 5 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, bank_accounts: [...form.bank_accounts, { bank: "", number: "", holder: "" }] })}>
                    <Plus className="mr-1 h-4 w-4" /> Tambah rekening
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">Pelanggan mengirim bukti transfer di chat; agen menekan "Tandai lunas" di pesanan.</p>
              </div>
            )}

            {form.provider === "xendit" && (
              <div className="max-w-3xl space-y-3 rounded-lg border p-3">
                <KeyInput id="xendit-key" label="Secret key Xendit" hint={settings?.xendit_key_hint ?? null} field="xendit_secret_key" onSaved={refresh} />
                <KeyInput id="xendit-cb" label="Callback verification token" hint={null} field="xendit_callback_token" onSaved={refresh} />
                <div className="space-y-1">
                  <Label>URL callback invoice (isi di Xendit Dashboard → Settings → Webhooks → Invoices paid)</Label>
                  <Copyable value={hookUrl("xendit")} />
                </div>
              </div>
            )}

            {form.provider === "midtrans" && (
              <div className="max-w-3xl space-y-3 rounded-lg border p-3">
                <KeyInput id="midtrans-key" label="Server key Midtrans" hint={settings?.midtrans_key_hint ?? null} field="midtrans_server_key" onSaved={refresh} />
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={form.midtrans_production} onCheckedChange={(v) => setForm({ ...form, midtrans_production: v })} aria-label="Mode produksi Midtrans" />
                  Mode produksi (matikan untuk sandbox/uji coba)
                </label>
                <div className="space-y-1">
                  <Label>Payment Notification URL (Midtrans Dashboard → Settings → Configuration)</Label>
                  <Copyable value={hookUrl("midtrans")} />
                </div>
              </div>
            )}

            <div className="max-w-3xl space-y-1">
              <Label htmlFor="pay-note">Catatan di tagihan (opsional)</Label>
              <Textarea id="pay-note" rows={2} maxLength={1000} value={form.payment_note} onChange={(e) => setForm({ ...form, payment_note: e.target.value })} placeholder="Pesanan diproses setelah pembayaran diterima." />
            </div>
          </section>

          <section className="space-y-3">
            <div className="grid max-w-3xl gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Ongkir</Label>
                <Select value={form.shipping_mode} onValueChange={(v) => setForm({ ...form, shipping_mode: v as typeof form.shipping_mode })}>
                  <SelectTrigger aria-label="Cara hitung ongkir">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tidak ada / diisi agen</SelectItem>
                    <SelectItem value="flat">Tarif tetap</SelectItem>
                    <SelectItem value="biteship">Tarif kurir otomatis (Biteship)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.shipping_mode === "flat" && (
                <div className="space-y-1">
                  <Label htmlFor="flat-cost">Ongkir tetap (Rp)</Label>
                  <Input id="flat-cost" inputMode="numeric" value={form.flat_shipping_cost} onChange={(e) => setForm({ ...form, flat_shipping_cost: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
                </div>
              )}
              {form.shipping_mode === "biteship" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="origin">Kode pos asal pengiriman</Label>
                    <Input id="origin" inputMode="numeric" maxLength={5} value={form.origin_postal_code} onChange={(e) => setForm({ ...form, origin_postal_code: e.target.value.replace(/\D/g, "") })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="couriers">Kurir (kode, pisahkan koma)</Label>
                    <Input id="couriers" value={form.couriers} onChange={(e) => setForm({ ...form, couriers: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            {form.shipping_mode === "biteship" && (
              <div className="max-w-3xl">
                <KeyInput id="biteship-key" label="API key Biteship" hint={settings?.biteship_key_hint ?? null} field="biteship_api_key" onSaved={refresh} />
              </div>
            )}
          </section>

          <label className="flex max-w-3xl items-start gap-3 rounded-lg border p-3 text-sm">
            <Switch checked={form.ai_create_orders} onCheckedChange={(v) => setForm({ ...form, ai_create_orders: v })} aria-label="AI boleh membuat pesanan" />
            <span>
              <span className="font-medium">AI boleh membuat pesanan dan mengirim tagihan</span>
              <span className="block text-muted-foreground">
                Saat pelanggan setuju membeli dan datanya lengkap, AI membuat pesanan (harga dari katalog, ongkir termurah) lalu mengirim
                rincian dan cara bayar. AI juga bisa menjawab pertanyaan ongkir bila pelanggan menyebut kode pos.
              </span>
            </span>
          </label>
        </fieldset>
        {isAdmin && (
          <Button onClick={save} disabled={saving}>
            Simpan pengaturan pembayaran
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
