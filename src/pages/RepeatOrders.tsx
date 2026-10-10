import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Loader2, Megaphone, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { toast } from "sonner";
import { SEGMENTS } from "@/components/contacts/segments";

const DEFAULT_MESSAGE = "Halo kak {nama} 😊 {produk} kakak sepertinya sebentar lagi habis ya. Mau kami siapkan lagi? Balas pesan ini saja, nanti kami bantu.";
const NO_TEMPLATE = "none";
const STATUS: Record<string, [string, string]> = {
  pending: ["Terjadwal", "bg-primary/10 text-primary"],
  sending: ["Mengirim", "bg-primary/10 text-primary"],
  sent: ["Terkirim", "bg-success/15 text-success"],
  skipped: ["Dilewati", "bg-muted text-muted-foreground"],
  cancelled: ["Batal (sudah pesan)", "bg-muted text-muted-foreground"],
};
const when = (iso: string | null) => (iso ? format(new Date(iso), "d MMM HH.mm", { locale: localeId }) : "–");

function Settings({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ enabled: false, days_before: 3, message: DEFAULT_MESSAGE, template: NO_TEMPLATE, dormant_days: 60 });
  const [busy, setBusy] = useState(false);
  const { data: settings, isLoading } = useQuery({
    queryKey: ["repeat-settings", orgId],
    queryFn: async () => (await supabase.from("repeat_settings").select("*").eq("organization_id", orgId).maybeSingle()).data,
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["approved-templates", orgId],
    queryFn: async () => (await supabase.from("templates").select("name, language, status").eq("status", "APPROVED").order("name")).data ?? [],
  });
  useEffect(() => {
    if (settings) {
      setForm({
        enabled: settings.enabled,
        days_before: settings.days_before,
        message: settings.message,
        template: settings.template_name ? `${settings.template_name}|${settings.template_language}` : NO_TEMPLATE,
        dormant_days: settings.dormant_days,
      });
    }
  }, [settings]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const [name, language] = form.template === NO_TEMPLATE ? [null, "id"] : form.template.split("|");
    const { error } = await supabase.from("repeat_settings").upsert({
      organization_id: orgId,
      enabled: form.enabled,
      days_before: form.days_before,
      message: form.message.trim(),
      template_name: name,
      template_language: language,
      dormant_days: form.dormant_days,
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Pengaturan repeat order disimpan");
    qc.invalidateQueries({ queryKey: ["repeat-settings", orgId] });
    qc.invalidateQueries({ queryKey: ["segment-counts"] });
  };

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  const preview = form.message.split("{nama}").join("Rina").split("{produk}").join("Kopi Gayo 250g");
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Pengingat beli lagi</CardTitle>
          <CardDescription>Dikirim otomatis beberapa hari sebelum produk pelanggan biasanya habis.</CardDescription>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} disabled={!canEdit} aria-label="Aktifkan pengingat" />
          {form.enabled ? "Aktif" : "Mati"}
        </label>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="rp-msg">Pesan</Label>
            <Textarea id="rp-msg" rows={3} maxLength={1000} disabled={!canEdit} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            <p className="text-xs text-muted-foreground">
              <code>{"{nama}"}</code> = nama depan pelanggan, <code>{"{produk}"}</code> = produk yang dibeli. Contoh: “{preview}”
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rp-days">Kirim berapa hari sebelum habis</Label>
            <Input id="rp-days" type="number" min={0} max={60} disabled={!canEdit} value={form.days_before} onChange={(e) => setForm({ ...form, days_before: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rp-tpl">Template (nomor WhatsApp API resmi)</Label>
            <Select value={form.template} onValueChange={(v) => setForm({ ...form, template: v })} disabled={!canEdit}>
              <SelectTrigger id="rp-tpl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE}>Tanpa template</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                    {t.name} ({t.language})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Lewat 24 jam sejak chat terakhir, nomor resmi wajib template: {"{{1}}"} = nama, {"{{2}}"} = produk. Nomor QR tidak perlu.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rp-dormant">Pelanggan “tidur” setelah (hari tanpa pesanan)</Label>
            <Input id="rp-dormant" type="number" min={14} max={365} disabled={!canEdit} value={form.dormant_days} onChange={(e) => setForm({ ...form, dormant_days: Math.min(365, Math.max(14, Number(e.target.value) || 60)) })} />
          </div>
          {canEdit && (
            <div className="flex items-end justify-end">
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Simpan
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function Products({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({
    queryKey: ["products-repurchase"],
    queryFn: async () => (await supabase.from("products").select("id, name, repurchase_days").eq("is_active", true).order("name")).data ?? [],
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = async (id: string, value: string) => {
    const days = value.trim() ? Math.min(365, Math.max(1, Math.round(Number(value) || 0))) : null;
    const { error } = await supabase.from("products").update({ repurchase_days: days }).eq("id", id);
    if (error) return toast.error(errorMessage(error));
    toast.success("Disimpan");
    qc.invalidateQueries({ queryKey: ["products-repurchase"] });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Produk & masa habis</CardTitle>
        <CardDescription>Isi perkiraan berapa hari produk habis dipakai (mis. kopi 250g = 30). Kosong = tidak diingatkan.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {products.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            Belum ada produk. Tambahkan di <Link to="/ai" className="text-primary underline">AI Agent → Pengetahuan → Produk</Link>.
          </p>
        ) : (
          <ul className="divide-y">
            {products.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="flex-1">{p.name}</span>
                <Input
                  aria-label={`Masa habis ${p.name} (hari)`}
                  type="number"
                  min={1}
                  max={365}
                  className="w-24"
                  disabled={!canEdit}
                  placeholder="–"
                  value={draft[p.id] ?? (p.repurchase_days ? String(p.repurchase_days) : "")}
                  onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })}
                  onBlur={(e) => {
                    if (draft[p.id] !== undefined && Number(draft[p.id] || 0) !== (p.repurchase_days ?? 0)) save(p.id, e.target.value);
                  }}
                />
                <span className="w-8 text-muted-foreground">hari</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Segments({ orgId }: { orgId: string }) {
  const { data: counts = [] } = useQuery({
    queryKey: ["segment-counts", orgId],
    queryFn: async () => (await supabase.rpc("segment_counts")).data ?? [],
  });
  const n = (s: string) => Number(counts.find((c) => c.segment === s)?.contacts ?? 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Segmen pelanggan</CardTitle>
        <CardDescription>Dihitung otomatis dari pesanan dan chat. Kirim broadcast khusus ke satu segmen.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {SEGMENTS.map((s) => (
          <div key={s.value} className="space-y-1 rounded-xl border p-3">
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.className}`}>{s.label}</span>
            <p className="text-2xl font-extrabold tabular-nums">{n(s.value).toLocaleString("id-ID")}</p>
            <p className="text-xs text-muted-foreground">{s.description}</p>
            <div className="flex gap-3 pt-1 text-sm font-medium">
              <Link to={`/contacts?segment=${s.value}`} className="text-primary underline-offset-2 hover:underline">
                Lihat
              </Link>
              <Link to={`/broadcast?segment=${s.value}`} className="flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                <Megaphone className="h-3.5 w-3.5" /> Broadcast
              </Link>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function RepeatOrders() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const isAdmin = profile!.role === "admin";
  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ["repeat-reminders", orgId],
    refetchInterval: 60_000,
    queryFn: async () =>
      (
        await supabase
          .from("repeat_reminders")
          .select("id, products, due_at, status, reason, sent_at, conversation_id, converted_order_id, contact:contacts(name, profile_name, wa_id), converted:orders!repeat_reminders_converted_order_id_fkey(total)")
          .order("due_at", { ascending: false })
          .limit(50)
      ).data ?? [],
  });
  const sent = reminders.filter((r) => r.status === "sent");
  const converted = sent.filter((r) => r.converted_order_id);
  const revenue = converted.reduce((n, r) => n + Number((r.converted as { total: number } | null)?.total ?? 0), 0);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Repeat className="h-6 w-6 text-primary" /> Repeat Order
        </h1>
        <p className="text-muted-foreground">Ingatkan pelanggan untuk beli lagi tepat sebelum produknya habis, dan kelompokkan pelanggan untuk broadcast.</p>
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        {[
          ["Pengingat terkirim", sent.length.toLocaleString("id-ID"), "50 terakhir"],
          ["Pesan lagi", converted.length.toLocaleString("id-ID"), sent.length ? `${Math.round((converted.length / sent.length) * 100)}% dari yang diingatkan` : "dalam 14 hari setelah pengingat"],
          ["Omzet dari pengingat", `Rp${Math.round(revenue).toLocaleString("id-ID")}`, "pesanan lunas setelah pengingat"],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-extrabold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Settings orgId={orgId} canEdit={isAdmin} />
        <Products canEdit={isAdmin} />
      </div>
      <Segments orgId={orgId} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pengingat</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <Loader2 className="m-6 h-5 w-5 animate-spin text-muted-foreground" />
          ) : reminders.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Belum ada. Pengingat dibuat saat pesanan berisi produk yang punya masa habis menjadi lunas.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pelanggan</TableHead>
                    <TableHead>Produk</TableHead>
                    <TableHead>Jadwal</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reminders.map((r) => {
                    const c = r.contact as { name: string | null; profile_name: string | null; wa_id: string } | null;
                    const [label, cls] = STATUS[r.status] ?? [r.status, ""];
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link to={`/inbox/${r.conversation_id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                            {c?.name || c?.profile_name || c?.wa_id || "–"}
                          </Link>
                        </TableCell>
                        <TableCell>{r.products}</TableCell>
                        <TableCell className="whitespace-nowrap">{when(r.sent_at ?? r.due_at)}</TableCell>
                        <TableCell>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`} title={r.reason ?? undefined}>
                            {label}
                          </span>
                          {r.converted_order_id && <Badge className="ml-1 bg-success/15 text-success hover:bg-success/15">Pesan lagi</Badge>}
                          {r.status === "skipped" && r.reason && <p className="mt-0.5 text-xs text-muted-foreground">{r.reason}</p>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
