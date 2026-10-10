import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Loader2, RefreshCw, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { callFunction, errorMessage } from "@/lib/api";
import { toast } from "sonner";

const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "d MMM HH.mm", { locale: localeId }) : "–");

export type TokenFieldName = "capi_token" | "ads_token" | "google_developer_token" | "google_client_secret" | "google_refresh_token" | "tiktok_token";

// A secret: shown only as its last 4 characters once stored.
export function TokenField({
  id,
  label,
  hint,
  help,
  field,
  onSaved,
}: {
  id: string;
  label: string;
  hint: string | null | undefined;
  help: React.ReactNode;
  field: TokenFieldName;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (token: string | null) => {
    setBusy(true);
    try {
      await callFunction("meta-ads", { action: "save_tokens", [field]: token });
      toast.success(token ? "Disimpan" : "Dihapus");
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
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={hint ? `Tersimpan (${hint}). Tempel yang baru untuk mengganti.` : "Tempel di sini"}
        />
        <Button type="button" onClick={() => save(value)} disabled={busy || value.trim().length < 16}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
        </Button>
        {hint && (
          <Button type="button" variant="ghost" onClick={() => window.confirm("Hapus ini?") && save(null)} disabled={busy} aria-label={`Hapus ${label}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

type Settings = Tables<"ad_settings"> | null | undefined;

function useRun(orgId: string, platform: "google" | "tiktok") {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ad-settings", orgId] });
  const run = async (action: "test_event" | "sync_spend", extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const r = await callFunction<{ rows?: number }>("meta-ads", { action, platform, ...extra });
      toast.success(action === "test_event" ? "Uji berhasil: akun dan token benar." : `Biaya iklan diperbarui (${r.rows ?? 0} baris)`);
      qc.invalidateQueries({ queryKey: ["ads-summary"] });
      qc.invalidateQueries({ queryKey: ["ads-report"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      refresh();
      setBusy(null);
    }
  };
  return { busy, setBusy, run, refresh };
}

const digits = (v: string) => v.replace(/\D/g, "");

export function GoogleAdsCard({ orgId, settings }: { orgId: string; settings: Settings }) {
  const { busy, setBusy, run, refresh } = useRun(orgId, "google");
  const [form, setForm] = useState({ customer: "", login: "", client: "", lead: "", purchase: "" });
  useEffect(() => {
    setForm({
      customer: settings?.google_customer_id ?? "",
      login: settings?.google_login_customer_id ?? "",
      client: settings?.google_client_id ?? "",
      lead: settings?.google_lead_action_id ?? "",
      purchase: settings?.google_purchase_action_id ?? "",
    });
  }, [settings]);
  const linked = Boolean(settings?.google_customer_id && settings?.google_token_hint);

  const save = async () => {
    setBusy("save");
    const { error } = await supabase.from("ad_settings").upsert({
      organization_id: orgId,
      google_customer_id: digits(form.customer) || null,
      google_login_customer_id: digits(form.login) || null,
      google_client_id: form.client.trim() || null,
      google_lead_action_id: digits(form.lead) || null,
      google_purchase_action_id: digits(form.purchase) || null,
      updated_at: new Date().toISOString(),
    });
    setBusy(null);
    if (error) return toast.error(error.code === "23514" ? "Periksa format: Customer ID 10 angka (boleh dengan tanda -), ID aksi konversi hanya angka." : errorMessage(error));
    toast.success("Pengaturan Google Ads disimpan");
    refresh();
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Google Ads</CardTitle>
          <CardDescription>Lead dan closing dari klik Google (gclid) dikirim sebagai konversi offline; biaya diambil tiap jam.</CardDescription>
        </div>
        {linked ? (
          <Badge className={settings?.google_event_error || settings?.google_spend_error ? "bg-warning/15 text-warning hover:bg-warning/15" : "bg-success/15 text-success hover:bg-success/15"}>
            Terhubung · biaya {when(settings?.google_spend_sync_at)}
          </Badge>
        ) : (
          <Badge variant="outline">Belum terhubung</Badge>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="g-customer">Customer ID akun iklan</Label>
          <Input id="g-customer" inputMode="numeric" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="123-456-7890" />
          <p className="text-xs text-muted-foreground">Pojok kanan atas Google Ads, di samping nama akun.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="g-login">Customer ID akun manajer (MCC, opsional)</Label>
          <Input id="g-login" inputMode="numeric" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} placeholder="kosongkan bila tanpa MCC" />
          <p className="text-xs text-muted-foreground">Isi bila token dibuat lewat akun manajer.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="g-lead">ID aksi konversi “Lead”</Label>
          <Input id="g-lead" inputMode="numeric" value={form.lead} onChange={(e) => setForm({ ...form, lead: e.target.value })} placeholder="987654321" />
          <p className="text-xs text-muted-foreground">Tujuan → Konversi → buat aksi “Impor → klik”; ID ada di URL (ctId=…).</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="g-purchase">ID aksi konversi “Pembelian”</Label>
          <Input id="g-purchase" inputMode="numeric" value={form.purchase} onChange={(e) => setForm({ ...form, purchase: e.target.value })} placeholder="987654322" />
          <p className="text-xs text-muted-foreground">Aksi impor kedua untuk closing + nilai rupiah.</p>
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="g-client">OAuth Client ID</Label>
          <Input id="g-client" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="1234-abc.apps.googleusercontent.com" />
          <p className="text-xs text-muted-foreground">Google Cloud Console → API &amp; Layanan → Kredensial → OAuth client (jenis Aplikasi web).</p>
        </div>
        <div className="flex justify-end md:col-span-2">
          <Button type="button" onClick={save} disabled={busy !== null}>
            {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Simpan Google Ads
          </Button>
        </div>
        <TokenField
          id="g-dev"
          label="Developer token"
          field="google_developer_token"
          hint={settings?.google_developer_hint}
          help="Google Ads (akun manajer) → Alat → Pusat API → Developer token."
          onSaved={refresh}
        />
        <TokenField
          id="g-secret"
          label="OAuth Client secret"
          field="google_client_secret"
          hint={settings?.google_secret_hint}
          help="Dari OAuth client yang sama dengan Client ID."
          onSaved={refresh}
        />
        <div className="md:col-span-2">
          <TokenField
            id="g-refresh"
            label="Refresh token"
            field="google_refresh_token"
            hint={settings?.google_token_hint}
            help="Buat sekali di OAuth Playground (scope https://www.googleapis.com/auth/adwords) memakai Client ID & secret di atas. Semua disimpan terenkripsi."
            onSaved={refresh}
          />
        </div>
        {(settings?.google_event_error || settings?.google_spend_error) && (
          <p className="rounded-md bg-warning/10 p-2 text-sm text-warning md:col-span-2">{[settings?.google_event_error, settings?.google_spend_error].filter(Boolean).join(" · ")}</p>
        )}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="button" variant="outline" onClick={() => run("test_event")} disabled={busy !== null || !linked}>
            {busy === "test_event" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} Uji koneksi
          </Button>
          <Button type="button" variant="outline" onClick={() => run("sync_spend")} disabled={busy !== null || !linked}>
            {busy === "sync_spend" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Ambil biaya sekarang
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TiktokCard({ orgId, settings }: { orgId: string; settings: Settings }) {
  const { busy, setBusy, run, refresh } = useRun(orgId, "tiktok");
  const [form, setForm] = useState({ pixel: "", advertiser: "", test: "" });
  useEffect(() => {
    setForm((f) => ({ ...f, pixel: settings?.tiktok_pixel_code ?? "", advertiser: settings?.tiktok_advertiser_id ?? "" }));
  }, [settings]);
  const linked = Boolean(settings?.tiktok_pixel_code && settings?.tiktok_token_hint);

  const save = async () => {
    setBusy("save");
    const { error } = await supabase.from("ad_settings").upsert({
      organization_id: orgId,
      tiktok_pixel_code: form.pixel.trim().toUpperCase() || null,
      tiktok_advertiser_id: digits(form.advertiser) || null,
      updated_at: new Date().toISOString(),
    });
    setBusy(null);
    if (error) return toast.error(error.code === "23514" ? "Periksa format: Pixel Code huruf besar & angka, Advertiser ID hanya angka." : errorMessage(error));
    toast.success("Pengaturan TikTok disimpan");
    refresh();
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">TikTok Ads</CardTitle>
          <CardDescription>Lead dan closing dari klik TikTok (ttclid) dikirim lewat Events API; biaya diambil tiap jam.</CardDescription>
        </div>
        {linked ? (
          <Badge className={settings?.tiktok_event_error || settings?.tiktok_spend_error ? "bg-warning/15 text-warning hover:bg-warning/15" : "bg-success/15 text-success hover:bg-success/15"}>
            Terhubung · biaya {when(settings?.tiktok_spend_sync_at)}
          </Badge>
        ) : (
          <Badge variant="outline">Belum terhubung</Badge>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="tt-pixel">Pixel Code</Label>
          <Input id="tt-pixel" value={form.pixel} onChange={(e) => setForm({ ...form, pixel: e.target.value })} placeholder="C4ABCDEF1234567890" />
          <p className="text-xs text-muted-foreground">Events Manager → Web Events → pilih pixel → Pengaturan.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tt-adv">Advertiser ID</Label>
          <Input id="tt-adv" inputMode="numeric" value={form.advertiser} onChange={(e) => setForm({ ...form, advertiser: e.target.value })} placeholder="7000000000000000000" />
          <p className="text-xs text-muted-foreground">Untuk mengambil biaya iklan. Pojok kanan atas Ads Manager.</p>
        </div>
        <div className="flex justify-end md:col-span-2">
          <Button type="button" onClick={save} disabled={busy !== null}>
            {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Simpan TikTok
          </Button>
        </div>
        <div className="md:col-span-2">
          <TokenField
            id="tt-token"
            label="Access token"
            field="tiktok_token"
            hint={settings?.tiktok_token_hint}
            help="Events Manager → pixel → Pengaturan → Buat access token. Untuk biaya iklan, pakai token aplikasi TikTok for Business dengan izin Reporting."
            onSaved={refresh}
          />
        </div>
        {(settings?.tiktok_event_error || settings?.tiktok_spend_error) && (
          <p className="rounded-md bg-warning/10 p-2 text-sm text-warning md:col-span-2">{[settings?.tiktok_event_error, settings?.tiktok_spend_error].filter(Boolean).join(" · ")}</p>
        )}
        <div className="flex flex-wrap items-end gap-2 md:col-span-2">
          <div className="space-y-1">
            <Label htmlFor="tt-test">Kode uji</Label>
            <Input id="tt-test" className="w-40" value={form.test} onChange={(e) => setForm({ ...form, test: e.target.value })} placeholder="TEST12345" />
          </div>
          <Button type="button" variant="outline" onClick={() => run("test_event", { test_event_code: form.test.trim() })} disabled={busy !== null || !linked || !form.test.trim()}>
            {busy === "test_event" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} Kirim event uji
          </Button>
          <Button type="button" variant="outline" onClick={() => run("sync_spend")} disabled={busy !== null || !settings?.tiktok_advertiser_id || !settings?.tiktok_token_hint}>
            {busy === "sync_spend" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Ambil biaya sekarang
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
