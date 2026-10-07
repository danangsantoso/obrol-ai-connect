import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Megaphone, Plus, Send, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ChatText } from "@/components/chat/ChatText";
import { EmojiPicker } from "@/components/chat/EmojiPicker";
import { renderFollowup } from "@/components/followup/followup";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { callFunction, displayName, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SUPPORTED: Record<string, string> = { cloud_api: "WhatsApp API resmi", qr: "WhatsApp (scan QR)", telegram: "Telegram" };
const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draf", className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Terjadwal", className: "bg-primary/10 text-primary" },
  sending: { label: "Mengirim", className: "bg-warning/15 text-warning" },
  completed: { label: "Selesai", className: "bg-success/15 text-success" },
  cancelled: { label: "Dibatalkan", className: "bg-destructive/10 text-destructive" },
};
const OPT_OUT = "\n\nBalas STOP jika tidak ingin menerima info seperti ini lagi.";

interface Stats {
  broadcast_id: string;
  pending: number;
  sent: number;
  failed: number;
  delivered: number;
  read: number;
  replied: number;
}

const EMPTY = {
  name: "",
  channel_id: "",
  body: "",
  template: "",
  template_params: [] as string[],
  add_opt_out: true,
  label_ids: [] as string[],
  active_within_days: "",
  only_opt_in: false,
  per_minute: 20,
  when: "now" as "now" | "later",
  scheduled_at: "",
};

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

function NewBroadcast({ orgId, orgName, onDone }: { orgId: string; orgName: string; onDone: (id: string) => void }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const { data: channels = [] } = useQuery({
    queryKey: ["broadcast-channels", orgId],
    queryFn: async () => (await supabase.from("channels").select("id, name, provider, is_active").order("created_at")).data?.filter((c) => c.provider in SUPPORTED && c.is_active) ?? [],
  });
  const { data: labels = [] } = useQuery({
    queryKey: ["labels", orgId],
    queryFn: async () => (await supabase.from("labels").select("id, name, color").order("name")).data ?? [],
  });
  const channel = channels.find((c) => c.id === form.channel_id);
  const { data: templates = [] } = useQuery({
    queryKey: ["broadcast-templates", form.channel_id],
    enabled: channel?.provider === "cloud_api",
    queryFn: async () =>
      (await supabase.from("templates").select("name, language, status, components").eq("channel_id", form.channel_id).order("name")).data?.filter(
        (t) => !t.status || t.status === "APPROVED",
      ) ?? [],
  });
  const template = templates.find((t) => `${t.name}|${t.language}` === form.template);
  const templateBody = useMemo(() => {
    const body = (template?.components as { type?: string; text?: string }[] | undefined)?.find((c) => c.type?.toUpperCase() === "BODY");
    return body?.text ?? "";
  }, [template]);
  const paramCount = new Set(templateBody.match(/\{\{\d+\}\}/g) ?? []).size;

  useEffect(() => {
    if (!form.channel_id && channels.length) setForm((f) => ({ ...f, channel_id: channels[0].id }));
  }, [channels, form.channel_id]);
  useEffect(() => {
    // A slower, safer pace for numbers linked by QR.
    if (channel) setForm((f) => ({ ...f, per_minute: channel.provider === "qr" ? 8 : 30, only_opt_in: channel.provider === "cloud_api" ? f.only_opt_in : false }));
  }, [channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setForm((f) => ({ ...f, template_params: Array.from({ length: paramCount }, (_, i) => f.template_params[i] ?? (i === 0 ? "{sapaan}" : "")) }));
  }, [paramCount]);

  const { data: audience } = useQuery({
    queryKey: ["broadcast-audience", form.channel_id, form.label_ids, form.active_within_days, form.only_opt_in],
    enabled: !!form.channel_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("broadcast_audience_count", {
        p_channel: form.channel_id,
        p_label_ids: form.label_ids,
        p_active_days: form.active_within_days ? Number(form.active_within_days) : null,
        p_only_opt_in: form.only_opt_in,
      });
      if (error) throw error;
      return data as number;
    },
  });

  const sample = { name: "Budi Santoso", salutation: "auto", agent: null, bot: "Admin", shop: orgName };
  const preview =
    channel?.provider === "cloud_api"
      ? form.template_params.reduce((t, p, i) => t.split(`{{${i + 1}}}`).join(renderFollowup(p, sample) || `{{${i + 1}}}`), templateBody)
      : renderFollowup(form.body, sample) + (form.add_opt_out ? OPT_OUT : "");
  const minutes = audience ? Math.ceil(audience / Math.max(1, form.per_minute)) : 0;

  const submit = async (send: boolean) => {
    if (!form.name.trim()) return toast.error("Beri nama broadcast");
    if (!channel) return toast.error("Pilih kanal");
    const isTemplate = channel.provider === "cloud_api";
    if (isTemplate && !template) return toast.error("Pilih template WhatsApp yang sudah disetujui");
    if (!isTemplate && !form.body.trim()) return toast.error("Tulis pesan broadcast");
    if (send && form.when === "later" && !form.scheduled_at) return toast.error("Pilih waktu kirim");
    if (send && !window.confirm(`Kirim "${form.name}" ke ${audience ?? 0} kontak${form.when === "later" ? " sesuai jadwal" : " sekarang"}?`)) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("broadcasts")
        .insert({
          organization_id: orgId,
          name: form.name.trim(),
          channel_id: channel.id,
          kind: isTemplate ? "template" : "text",
          body: isTemplate ? "" : form.body.trim(),
          template_name: isTemplate ? template!.name : null,
          template_language: isTemplate ? template!.language : null,
          template_params: isTemplate ? form.template_params : [],
          add_opt_out: form.add_opt_out,
          label_ids: form.label_ids,
          active_within_days: form.active_within_days ? Number(form.active_within_days) : null,
          only_opt_in: form.only_opt_in,
          per_minute: form.per_minute,
        })
        .select()
        .single();
      if (error) throw error;
      if (send) {
        await callFunction("broadcast", {
          action: "start",
          broadcast_id: data.id,
          scheduled_at: form.when === "later" ? new Date(form.scheduled_at).toISOString() : null,
        });
      }
      toast.success(send ? (form.when === "later" ? "Broadcast dijadwalkan" : "Broadcast mulai dikirim") : "Draf disimpan");
      setForm(EMPTY);
      onDone(data.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!channels.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Broadcast butuh nomor WhatsApp (API resmi atau scan QR) atau bot Telegram yang aktif. Hubungkan di Pengaturan.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Broadcast baru</CardTitle>
        <CardDescription>Satu pesan ke banyak kontak. Balasan pelanggan masuk ke Inbox seperti chat biasa.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="bc-name">Nama broadcast</Label>
            <Input id="bc-name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Promo Gajian Oktober" />
          </div>
          <div className="space-y-1">
            <Label>Kirim dari</Label>
            <Select value={form.channel_id} onValueChange={(v) => setForm({ ...form, channel_id: v, template: "" })}>
              <SelectTrigger aria-label="Kanal broadcast">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {SUPPORTED[c.provider]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {channel?.provider === "qr" && (
          <p className="flex gap-2 rounded-md bg-warning/10 p-3 text-xs text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Nomor scan QR bisa diblokir WhatsApp bila mengirim promosi ke banyak orang yang tidak menyimpan nomor Anda. Kirim hanya ke
            pelanggan yang pernah chat, dengan kecepatan rendah (bawaan 8 pesan per menit).
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            {channel?.provider === "cloud_api" ? (
              <>
                <div className="space-y-1">
                  <Label>Template WhatsApp (wajib untuk API resmi)</Label>
                  <Select value={form.template} onValueChange={(v) => setForm({ ...form, template: v })}>
                    <SelectTrigger aria-label="Template broadcast">
                      <SelectValue placeholder={templates.length ? "Pilih template" : "Belum ada template disetujui"} />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                          {t.name} ({t.language})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.template_params.map((p, i) => (
                  <div key={i} className="space-y-1">
                    <Label htmlFor={`bc-p${i}`}>Isi {`{{${i + 1}}}`}</Label>
                    <Input
                      id={`bc-p${i}`}
                      value={p}
                      onChange={(e) => setForm({ ...form, template_params: form.template_params.map((x, j) => (j === i ? e.target.value : x)) })}
                    />
                  </div>
                ))}
              </>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="bc-body">Pesan</Label>
                  <EmojiPicker onPick={(e) => setForm({ ...form, body: form.body + e })} />
                </div>
                <Textarea id="bc-body" rows={6} maxLength={3800} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Halo *{sapaan}* 👋 Ada promo spesial di {toko} minggu ini..." />
                <p className="text-xs text-muted-foreground">Variabel: {"{sapaan}"} {"{nama}"} {"{toko}"} · *tebal*</p>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={form.add_opt_out} onCheckedChange={(v) => setForm({ ...form, add_opt_out: v })} aria-label="Tambahkan cara berhenti" />
                  Tambahkan "Balas STOP untuk berhenti"
                </label>
              </div>
            )}
          </div>
          <div className="rounded-lg bg-muted/60 p-3 text-sm">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Pratinjau (untuk Budi)</p>
            <p className="whitespace-pre-wrap">
              <ChatText text={preview || "…"} />
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Penerima</Label>
          <div className="flex flex-wrap gap-2">
            {labels.map((l) => {
              const on = form.label_ids.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setForm({ ...form, label_ids: on ? form.label_ids.filter((x) => x !== l.id) : [...form.label_ids, l.id] })}
                  className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-transparent text-white" : "text-muted-foreground")}
                  style={on ? { backgroundColor: l.color } : undefined}
                  aria-pressed={on}
                >
                  {l.name}
                </button>
              );
            })}
            {!labels.length && <span className="text-xs text-muted-foreground">Belum ada label: semua kontak jadi penerima.</span>}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-2">
              Aktif chat dalam
              <Input className="h-8 w-20" inputMode="numeric" value={form.active_within_days} onChange={(e) => setForm({ ...form, active_within_days: e.target.value.replace(/\D/g, "") })} placeholder="semua" aria-label="Aktif dalam hari" />
              hari terakhir
            </span>
            {channel?.provider === "cloud_api" && (
              <label className="flex items-center gap-2">
                <Switch checked={form.only_opt_in} onCheckedChange={(v) => setForm({ ...form, only_opt_in: v })} aria-label="Hanya yang setuju" />
                Hanya kontak yang setuju menerima promosi (opt-in)
              </label>
            )}
          </div>
          <p className="flex items-center gap-2 text-sm font-medium" data-testid="bc-audience">
            <Users className="h-4 w-4" /> {audience ?? "…"} kontak
            {audience ? <span className="font-normal text-muted-foreground">· sekitar {minutes} menit dengan {form.per_minute} pesan/menit</span> : null}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="bc-pace">Pesan per menit</Label>
            <Input id="bc-pace" type="number" min={1} max={120} className="w-28" value={form.per_minute} onChange={(e) => setForm({ ...form, per_minute: Math.min(120, Math.max(1, Number(e.target.value) || 1)) })} />
          </div>
          <div className="space-y-1">
            <Label>Waktu kirim</Label>
            <Select value={form.when} onValueChange={(v) => setForm({ ...form, when: v as "now" | "later" })}>
              <SelectTrigger className="w-40" aria-label="Waktu kirim">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="now">Sekarang</SelectItem>
                <SelectItem value="later">Jadwalkan</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.when === "later" && (
            <Input type="datetime-local" className="w-56" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} aria-label="Jadwal kirim" />
          )}
        </div>

        <div className="flex gap-2">
          <Button onClick={() => submit(true)} disabled={busy || !audience}>
            <Send className="mr-1 h-4 w-4" /> {form.when === "later" ? "Jadwalkan" : "Kirim sekarang"}
          </Button>
          <Button variant="outline" onClick={() => submit(false)} disabled={busy}>
            Simpan draf
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BroadcastDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["broadcast-detail", id],
    refetchInterval: 10_000,
    queryFn: async () => {
      const [{ data: b }, { data: rec }, { data: st }] = await Promise.all([
        supabase.from("broadcasts").select("*, channels(name)").eq("id", id).single(),
        supabase.from("broadcast_recipients").select("id, status, error, sent_at, replied_at, contacts(name, profile_name, wa_id), messages(status)").eq("broadcast_id", id).order("sent_at", { ascending: false, nullsFirst: false }).limit(300),
        supabase.rpc("broadcast_stats", { p_ids: [id] }),
      ]);
      return { b, rec: rec ?? [], st: (st?.[0] ?? null) as Stats | null };
    },
  });
  if (!data?.b) return null;
  const { b, rec, st } = data;
  const sent = Number(st?.sent ?? 0);
  const total = b.total || rec.length;
  const action = async (name: "start" | "cancel") => {
    try {
      await callFunction("broadcast", { action: name, broadcast_id: id });
      toast.success(name === "start" ? "Broadcast mulai dikirim" : "Broadcast dibatalkan");
      queryClient.invalidateQueries({ queryKey: ["broadcast-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const tiles = [
    { label: "Terkirim", value: sent, of: total },
    { label: "Diterima", value: Number(st?.delivered ?? 0), of: sent },
    { label: "Dibaca", value: Number(st?.read ?? 0), of: sent },
    { label: "Membalas", value: Number(st?.replied ?? 0), of: sent },
    { label: "Gagal", value: Number(st?.failed ?? 0), of: total },
  ];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            {b.name}
            <Badge variant="outline" className={cn("border-0", STATUS[b.status]?.className)}>{STATUS[b.status]?.label}</Badge>
          </CardTitle>
          <CardDescription>
            {(b.channels as { name: string } | null)?.name} · {b.per_minute} pesan/menit
            {b.scheduled_at && b.status === "scheduled" && ` · dijadwalkan ${new Date(b.scheduled_at).toLocaleString("id-ID")}`}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          {b.status === "draft" && <Button size="sm" onClick={() => action("start")}>Kirim sekarang</Button>}
          {["draft", "scheduled", "sending"].includes(b.status) && (
            <Button size="sm" variant="outline" onClick={() => window.confirm("Batalkan broadcast ini?") && action("cancel")}>Batalkan</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>Tutup</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {total > 0 && <Progress value={pct(sent + Number(st?.failed ?? 0), total)} />}
        <div className="grid gap-3 sm:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="text-xl font-bold" data-testid={`bc-${t.label}`}>{t.value}</p>
              <p className="text-xs text-muted-foreground">{pct(t.value, t.of)}%</p>
            </div>
          ))}
        </div>
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kontak</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dikirim</TableHead>
                <TableHead>Membalas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rec.map((r) => {
                const m = (r.messages as { status: string } | null)?.status;
                const label = r.status === "sent" ? (m === "read" ? "Dibaca" : m === "delivered" ? "Diterima" : "Terkirim") : r.status === "failed" ? "Gagal" : "Menunggu";
                return (
                  <TableRow key={r.id}>
                    <TableCell>{displayName(r.contacts as { name: string | null; profile_name: string | null; wa_id: string })}</TableCell>
                    <TableCell title={r.error ?? undefined}>
                      {label}
                      {r.status === "failed" && r.error && <span className="block text-xs text-destructive">{r.error}</span>}
                    </TableCell>
                    <TableCell className="text-sm">{r.sent_at ? new Date(r.sent_at).toLocaleString("id-ID") : "-"}</TableCell>
                    <TableCell className="text-sm">{r.replied_at ? new Date(r.replied_at).toLocaleString("id-ID") : "-"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Broadcast() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: org } = useQuery({
    queryKey: ["org-name", orgId],
    queryFn: async () => (await supabase.from("organizations").select("name").eq("id", orgId).single()).data,
  });
  const { data: list = [] } = useQuery({
    queryKey: ["broadcasts", orgId],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data } = await supabase.from("broadcasts").select("id, name, status, total, scheduled_at, created_at, channels(name)").order("created_at", { ascending: false }).limit(100);
      const ids = (data ?? []).map((b) => b.id);
      const { data: st } = ids.length ? await supabase.rpc("broadcast_stats", { p_ids: ids }) : { data: [] };
      const byId = new Map(((st ?? []) as Stats[]).map((s) => [s.broadcast_id, s]));
      return (data ?? []).map((b) => ({ ...b, stats: byId.get(b.id) }));
    },
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Megaphone className="h-6 w-6" /> Broadcast</h1>
          <p className="text-muted-foreground">Kirim promo atau info ke banyak pelanggan sekaligus, lalu pantau yang menerima, membaca, dan membalas.</p>
        </div>
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Broadcast baru
          </Button>
        )}
      </div>

      {creating && <NewBroadcast orgId={orgId} orgName={org?.name ?? "Toko"} onDone={(id) => { setCreating(false); setOpenId(id); }} />}
      {openId && <BroadcastDetail id={openId} onClose={() => setOpenId(null)} />}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Kanal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Penerima</TableHead>
                <TableHead className="text-right">Dibaca</TableHead>
                <TableHead className="text-right">Membalas</TableHead>
                <TableHead>Dibuat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Belum ada broadcast.</TableCell>
                </TableRow>
              )}
              {list.map((b) => {
                const sent = Number(b.stats?.sent ?? 0);
                return (
                  <TableRow key={b.id} className="cursor-pointer" onClick={() => setOpenId(b.id)} data-testid="bc-row">
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>{(b.channels as { name: string } | null)?.name}</TableCell>
                    <TableCell><Badge variant="outline" className={cn("border-0", STATUS[b.status]?.className)}>{STATUS[b.status]?.label}</Badge></TableCell>
                    <TableCell className="text-right">{sent}/{b.total}</TableCell>
                    <TableCell className="text-right">{pct(Number(b.stats?.read ?? 0), sent)}%</TableCell>
                    <TableCell className="text-right">{Number(b.stats?.replied ?? 0)} ({pct(Number(b.stats?.replied ?? 0), sent)}%)</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{new Date(b.created_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
