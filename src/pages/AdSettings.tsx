import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Loader2, RefreshCw, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { callFunction, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PLATFORMS, platformLabel, rpShort, useAdSettings } from "@/components/ads/shared";
import { GoogleAdsCard, TiktokCard, TokenField } from "@/components/ads/PlatformSettings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "d MMM HH.mm", { locale: localeId }) : "–");
const EVENT_STATUS: Record<string, [string, string]> = {
  sent: ["Terkirim", "bg-success/15 text-success"],
  pending: ["Menunggu / diulang", "bg-warning/15 text-warning"],
  sending: ["Mengirim", "bg-primary/10 text-primary"],
  failed: ["Gagal", "bg-destructive/10 text-destructive"],
  skipped: ["Dilewati", "bg-muted text-muted-foreground"],
};

export default function AdSettings() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const qc = useQueryClient();
  const { data: settings, isLoading } = useAdSettings(orgId);
  const [form, setForm] = useState({ pixel_id: "", test_event_code: "", waba_id: "", ad_account_id: "", send_lead: true, send_purchase: true, send_checkout: false, attribution_days: 28 });
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState({ date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }), platform: "meta", campaign_name: "", spend: "" });

  useEffect(() => {
    if (settings) {
      setForm({
        pixel_id: settings.pixel_id ?? "",
        test_event_code: settings.test_event_code ?? "",
        waba_id: settings.waba_id ?? "",
        ad_account_id: settings.ad_account_id ?? "",
        send_lead: settings.send_lead,
        send_purchase: settings.send_purchase,
        send_checkout: settings.send_checkout,
        attribution_days: settings.attribution_days,
      });
    }
  }, [settings]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["ad-settings", orgId] });
  const { data: events = [] } = useQuery({
    queryKey: ["capi-events", orgId],
    refetchInterval: 30_000,
    queryFn: async () =>
      (await supabase.from("capi_events").select("id, platform, event_name, status, last_error, attempts, created_at, sent_at, lead:ad_leads(contact:contacts(name, profile_name, wa_id)), conversion:ad_conversions(value)").order("id", { ascending: false }).limit(15)).data ?? [],
  });
  const { data: manualSpend = [] } = useQuery({
    queryKey: ["manual-spend", orgId],
    queryFn: async () => (await supabase.from("ad_spend").select("id, date, platform, campaign_name, spend").eq("manual", true).order("date", { ascending: false }).limit(20)).data ?? [],
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save");
    const account = form.ad_account_id.trim().replace(/^(?!act_)(\d+)$/, "act_$1");
    const { error } = await supabase.from("ad_settings").upsert({
      organization_id: orgId,
      pixel_id: form.pixel_id.trim() || null,
      test_event_code: form.test_event_code.trim() || null,
      waba_id: form.waba_id.trim() || null,
      ad_account_id: account || null,
      send_lead: form.send_lead,
      send_purchase: form.send_purchase,
      send_checkout: form.send_checkout,
      attribution_days: form.attribution_days,
      updated_at: new Date().toISOString(),
    });
    setBusy(null);
    if (error) return toast.error(error.code === "23514" ? "Periksa format: Pixel/WABA hanya angka, akun iklan seperti act_123456789." : errorMessage(error));
    toast.success("Pengaturan disimpan");
    refresh();
  };

  const run = async (action: "test_event" | "sync_spend") => {
    setBusy(action);
    try {
      const r = await callFunction<{ events_received?: number; rows?: number }>("meta-ads", { action, test_event_code: form.test_event_code.trim() || undefined });
      toast.success(action === "test_event" ? "Event uji diterima Meta. Cek tab Uji event di Events Manager." : `Biaya iklan diperbarui (${r.rows ?? 0} baris)`);
      refresh();
      qc.invalidateQueries({ queryKey: ["ads-summary"] });
      qc.invalidateQueries({ queryKey: ["ads-report"] });
    } catch (err) {
      toast.error(errorMessage(err));
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const addSpend = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("ad_spend").upsert(
      {
        organization_id: orgId,
        date: manual.date,
        platform: manual.platform,
        campaign_name: manual.campaign_name.trim(),
        spend: Number(manual.spend.replace(/\D/g, "")),
        manual: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,platform,date,ad_key" },
    );
    if (error) return toast.error(errorMessage(error));
    toast.success("Biaya disimpan");
    setManual({ ...manual, spend: "" });
    qc.invalidateQueries({ queryKey: ["manual-spend", orgId] });
  };
  const removeSpend = async (id: number) => {
    const { error } = await supabase.from("ad_spend").delete().eq("id", id);
    if (error) toast.error(errorMessage(error));
    qc.invalidateQueries({ queryKey: ["manual-spend", orgId] });
  };

  if (isLoading) return <Loader2 className="m-6 h-5 w-5 animate-spin text-muted-foreground" />;
  const connected = Boolean(settings?.pixel_id && settings?.capi_token_hint);
  const accountConnected = Boolean(settings?.ad_account_id && settings?.ads_token_hint);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="space-y-1">
        <Link to="/ads" className="text-sm font-medium text-primary">
          ← Iklan
        </Link>
        <h1 className="text-2xl font-bold">Pengaturan iklan</h1>
        <p className="text-muted-foreground">
          Hubungkan Meta, Google Ads dan TikTok: event lead &amp; closing dikirim ke platform asal pelanggan, dan biaya iklan diambil otomatis.
        </p>
      </div>

      <form onSubmit={save} className="space-y-6">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Meta · 1. Pixel / Dataset (Conversions API)</CardTitle>
            {connected ? (
              <Badge className="bg-success/15 text-success hover:bg-success/15">Terhubung · event terakhir {when(settings?.last_event_at)}</Badge>
            ) : (
              <Badge variant="outline">Belum terhubung</Badge>
            )}
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pixel">Pixel / Dataset ID</Label>
              <Input id="pixel" inputMode="numeric" value={form.pixel_id} onChange={(e) => setForm({ ...form, pixel_id: e.target.value.replace(/\D/g, "") })} placeholder="1234567890123456" />
              <p className="text-xs text-muted-foreground">Events Manager → pilih Pixel/Dataset → Pengaturan → ID.</p>
            </div>
            <TokenField
              id="capi-token"
              label="Token Conversions API"
              field="capi_token"
              hint={settings?.capi_token_hint}
              help="Events Manager → Pixel → Pengaturan → Conversions API → Buat token akses. Disimpan terenkripsi."
              onSaved={refresh}
            />
            <div className="space-y-1">
              <Label htmlFor="waba">ID akun WhatsApp Business (WABA)</Label>
              <Input id="waba" inputMode="numeric" value={form.waba_id} onChange={(e) => setForm({ ...form, waba_id: e.target.value.replace(/\D/g, "") })} placeholder="109876543210" />
              <p className="text-xs text-muted-foreground">Untuk iklan klik-ke-WhatsApp di nomor API resmi: Meta mencocokkan event langsung ke iklannya.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="test">Kode uji (opsional)</Label>
              <div className="flex gap-2">
                <Input id="test" value={form.test_event_code} onChange={(e) => setForm({ ...form, test_event_code: e.target.value })} placeholder="TEST12345" />
                <Button type="button" variant="outline" onClick={() => run("test_event")} disabled={busy !== null || !connected}>
                  {busy === "test_event" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} Uji
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Dari Events Manager → Uji event. Selama terisi, semua event masuk ke tab uji; kosongkan setelah selesai.</p>
            </div>
            {settings?.last_event_error && <p className="rounded-md bg-warning/10 p-2 text-sm text-warning md:col-span-2">Error terakhir dari Meta: {settings.last_event_error}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event yang dikirim (semua platform)</CardTitle>
            <CardDescription>Nomor HP pelanggan dikirim dalam bentuk sandi (hash SHA-256) sesuai aturan platform. Isi chat tidak pernah dikirim.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y rounded-lg border p-0">
            {(
              [
                ["send_lead", "Lead", "Saat pelanggan dari iklan mengirim chat pertama"],
                ["send_purchase", "Purchase + nilai rupiah", "Saat pesanan lunas, atau agen menekan “Tandai closing”"],
                ["send_checkout", "InitiateCheckout", "Saat pesanan dibuat (belum bayar). Berguna bila closing jarang."],
              ] as const
            ).map(([key, title, desc]) => (
              <div key={key} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1">
                  <Label htmlFor={key} className="text-sm font-semibold">
                    {title}
                  </Label>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
                <Switch id={key} checked={form[key]} onCheckedChange={(v) => setForm({ ...form, [key]: v })} />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-4 px-4 py-3">
              <div className="flex-1">
                <Label htmlFor="window" className="text-sm font-semibold">
                  Jendela atribusi (hari)
                </Label>
                <p className="text-sm text-muted-foreground">Closing dihitung ke iklan pertama yang membawa pelanggan, selama masih dalam jangka ini.</p>
              </div>
              <Input id="window" type="number" min={1} max={90} className="w-24" value={form.attribution_days} onChange={(e) => setForm({ ...form, attribution_days: Math.min(90, Math.max(1, Number(e.target.value) || 28)) })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Meta · 2. Biaya iklan (untuk CPL &amp; ROAS)</CardTitle>
            {accountConnected && (
              <Badge className={settings?.last_spend_error ? "bg-warning/15 text-warning hover:bg-warning/15" : "bg-success/15 text-success hover:bg-success/15"}>
                {settings?.last_spend_error ? "Gagal mengambil" : `Diperbarui ${when(settings?.last_spend_sync_at)}`}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="acc">ID akun iklan</Label>
              <Input id="acc" value={form.ad_account_id} onChange={(e) => setForm({ ...form, ad_account_id: e.target.value.trim() })} placeholder="act_998877665544" />
              <p className="text-xs text-muted-foreground">Ads Manager → menu akun di kiri atas → ID akun (angka).</p>
            </div>
            <TokenField
              id="ads-token"
              label="Token akses (izin ads_read)"
              field="ads_token"
              hint={settings?.ads_token_hint}
              help="Business Settings → Pengguna sistem → Buat token, centang ads_read. Token pengguna sistem tidak kedaluwarsa."
              onSaved={refresh}
            />
            {settings?.last_spend_error && <p className="rounded-md bg-warning/10 p-2 text-sm text-warning md:col-span-2">{settings.last_spend_error}</p>}
            <div className="md:col-span-2">
              <Button type="button" variant="outline" onClick={() => run("sync_spend")} disabled={busy !== null || !accountConnected}>
                {busy === "sync_spend" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Ambil biaya sekarang
              </Button>
              <span className="ml-2 text-xs text-muted-foreground">Otomatis setiap jam.</span>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={busy !== null}>
            {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Simpan pengaturan Meta
          </Button>
        </div>
      </form>

      <GoogleAdsCard orgId={orgId} settings={settings} />
      <TiktokCard orgId={orgId} settings={settings} />

      {(
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Isi biaya iklan manual</CardTitle>
            <CardDescription>
              Untuk platform tanpa token akun iklan, isi biaya per kampanye per hari. Nama kampanye harus sama dengan nama di link landing page / parameter
              utm_campaign.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={addSpend} className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="ms-date">Tanggal</Label>
                <Input id="ms-date" type="date" required value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ms-platform">Platform</Label>
                <Select value={manual.platform} onValueChange={(v) => setManual({ ...manual, platform: v })}>
                  <SelectTrigger id="ms-platform" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-48 flex-1 space-y-1">
                <Label htmlFor="ms-camp">Kampanye</Label>
                <Input id="ms-camp" required value={manual.campaign_name} onChange={(e) => setManual({ ...manual, campaign_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ms-spend">Biaya (Rp)</Label>
                <Input id="ms-spend" inputMode="numeric" required value={manual.spend} onChange={(e) => setManual({ ...manual, spend: e.target.value })} />
              </div>
              <Button type="submit">Simpan</Button>
            </form>
            {manualSpend.length > 0 && (
              <ul className="divide-y rounded-md border text-sm">
                {manualSpend.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-28 text-muted-foreground">{m.date}</span>
                    <span className="w-16 text-xs font-semibold">{platformLabel(m.platform)}</span>
                    <span className="flex-1">{m.campaign_name}</span>
                    <span className="tabular-nums">{rpShort(m.spend)}</span>
                    <Button size="sm" variant="ghost" onClick={() => removeSpend(m.id)} aria-label={`Hapus biaya ${m.campaign_name} ${m.date}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event terakhir</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Belum ada event.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Pelanggan</TableHead>
                    <TableHead>Nilai</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => {
                    const c = (e.lead as { contact?: { name: string | null; profile_name: string | null; wa_id: string } } | null)?.contact;
                    const [label, cls] = EVENT_STATUS[e.status] ?? [e.status, ""];
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap">{when(e.created_at)}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-xs font-semibold">
                            <span className={cn("h-2 w-2 rounded-full", PLATFORMS.find((x) => x.value === e.platform)?.color)} />
                            {platformLabel(e.platform)}
                          </span>
                        </TableCell>
                        <TableCell className="font-semibold">{e.event_name}</TableCell>
                        <TableCell>{c ? c.name || c.profile_name || c.wa_id : "–"}</TableCell>
                        <TableCell>{(e.conversion as { value: number } | null)?.value ? rpShort((e.conversion as { value: number }).value) : "–"}</TableCell>
                        <TableCell>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`} title={e.last_error ?? undefined}>
                            {label}
                            {e.status === "pending" && e.attempts > 0 ? ` (${e.attempts}×)` : ""}
                          </span>
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
