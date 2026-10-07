import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BadgeCheck, Copy, Facebook, Loader2, QrCode, RefreshCw, Trash2, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { QrConnectDialog } from "@/components/settings/QrConnectDialog";
import { SocialConnect } from "@/components/settings/SocialConnect";
import { ChannelIcon } from "@/components/inbox/ChannelIcon";
import { callFunction, errorMessage } from "@/lib/api";
import { toast } from "sonner";
import { LabelChip } from "@/components/inbox/LabelChip";
import { LABEL_COLORS } from "@/components/inbox/types";
import { useLabels } from "@/components/inbox/useInboxData";
import { cn } from "@/lib/utils";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const META_WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-webhook`;
const KIND_LABELS: Record<string, string> = { qr: "Scan QR", cloud_api: "API resmi", messenger: "Messenger", instagram: "Instagram" };
const isSocial = (provider: string) => provider === "messenger" || provider === "instagram";

function CopyField({ label, value, hint }: { label: string; value: string; hint: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex max-w-2xl gap-2">
        <Input readOnly value={value} />
        <Button
          variant="outline"
          size="icon"
          onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("URL disalin"))}
          aria-label={`Salin ${label}`}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function OrganizationCard({ isAdmin }: { isAdmin: boolean }) {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const { data: org, refetch } = useQuery({
    queryKey: ["organization", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").eq("id", orgId).single();
      if (error) throw error;
      return data;
    },
  });
  const [name, setName] = useState("");
  useEffect(() => setName(org?.name ?? ""), [org?.name]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("organizations").update({ name: name.trim() }).eq("id", orgId);
    if (error) toast.error(errorMessage(error));
    else toast.success("Organisasi disimpan");
    refetch();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organisasi</CardTitle>
        <CardDescription>
          Kebijakan retensi riwayat chat: {org?.retention_days ?? 180} hari.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex max-w-lg gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} minLength={2} required />
          {isAdmin && <Button type="submit">Simpan</Button>}
        </form>
      </CardContent>
    </Card>
  );
}

type Channel = Tables<"channels">;

const CONNECTION_LABELS: Record<string, { label: string; className: string }> = {
  connected: { label: "Terhubung", className: "border-success/40 text-success" },
  connecting: { label: "Menunggu scan", className: "border-warning/50 text-warning" },
  disconnected: { label: "Terputus", className: "border-destructive/40 text-destructive" },
};

function ChannelsCard({ isAdmin }: { isAdmin: boolean }) {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<"cloud_api" | "qr">("qr");
  const [form, setForm] = useState({ name: "", display_phone: "", phone_number_id: "", waba_id: "" });
  const [syncing, setSyncing] = useState<string | null>(null);
  const [qrChannel, setQrChannel] = useState<{ id: string; name: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const { data: channels = [] } = useQuery({
    queryKey: ["channels", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("channels").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["templates-all", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("templates").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["channels", orgId] });
    queryClient.invalidateQueries({ queryKey: ["templates-all", orgId] });
    queryClient.invalidateQueries({ queryKey: ["templates", orgId] });
  }, [queryClient, orgId]);

  // Connection state of QR numbers changes on the server (scan, logout on the phone).
  useEffect(() => {
    const sub = supabase
      .channel(`channels:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "channels" }, () =>
        queryClient.invalidateQueries({ queryKey: ["channels", orgId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [orgId, queryClient]);

  const hasQr = channels.some((ch) => ch.provider === "qr");
  useEffect(() => {
    // Refresh the stored state once when the page opens (e.g. after a gateway restart).
    for (const ch of channels) {
      if (ch.provider === "qr" && ch.is_active) {
        callFunction("wa-qr", { action: "status", channel_id: ch.id }).catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasQr]);

  const addChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const { data, error } = await supabase
      .from("channels")
      .insert(
        provider === "qr"
          ? { organization_id: orgId, name, provider }
          : {
              organization_id: orgId,
              name,
              provider,
              display_phone: form.display_phone.trim() || null,
              phone_number_id: form.phone_number_id.trim(),
              waba_id: form.waba_id.trim() || null,
            },
      )
      .select("id, name")
      .single();
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success("Nomor WhatsApp ditambahkan");
    setForm({ name: "", display_phone: "", phone_number_id: "", waba_id: "" });
    refresh();
    if (provider === "qr") setQrChannel(data);
  };

  const toggle = async (id: string, isActive: boolean) => {
    const { error } = await supabase.from("channels").update({ is_active: isActive }).eq("id", id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };

  const sync = async (channelId: string) => {
    setSyncing(channelId);
    try {
      const { synced } = await callFunction<{ synced: number }>("sync-templates", { channel_id: channelId });
      toast.success(`${synced} template disinkronkan`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSyncing(null);
    }
  };

  const disconnect = async (ch: Channel) => {
    const social = isSocial(ch.provider);
    const question = social
      ? `Putuskan ${ch.name}? Pesan baru tidak akan masuk lagi sampai dihubungkan ulang lewat Facebook.`
      : `Putuskan ${ch.name} dari WhatsApp? Untuk memakai lagi, scan QR ulang.`;
    if (!window.confirm(question)) return;
    setDisconnecting(ch.id);
    try {
      if (social) await callFunction("social-oauth", { action: "disconnect", channel_id: ch.id });
      else await callFunction("wa-qr", { action: "logout", channel_id: ch.id });
      toast.success("Nomor diputuskan");
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDisconnecting(null);
    }
  };

  const relogin = async () => {
    try {
      const { url } = await callFunction<{ url: string }>("social-oauth", { action: "start" });
      window.location.assign(url);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const closeQr = useCallback((open: boolean) => {
    if (!open) setQrChannel(null);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kanal chat</CardTitle>
        <CardDescription>
          WhatsApp lewat <b>Scan QR</b> (nomor biasa, seperti WhatsApp Web) atau <b>WhatsApp API resmi</b>, serta{" "}
          <b>Facebook Messenger</b> dan <b>Instagram</b> lewat login Facebook. Semua masuk ke Inbox yang sama.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Nomor</TableHead>
              <TableHead>Status / ID</TableHead>
              <TableHead>Aksi</TableHead>
              <TableHead className="text-right">Aktif</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Belum ada nomor terhubung.
                </TableCell>
              </TableRow>
            )}
            {channels.map((ch) => {
              const connection = CONNECTION_LABELS[ch.connection_status] ?? CONNECTION_LABELS.disconnected;
              return (
                <TableRow key={ch.id}>
                  <TableCell className="font-medium">{ch.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="gap-1 whitespace-nowrap">
                      {ch.provider === "cloud_api" ? <BadgeCheck className="h-3 w-3" /> : <ChannelIcon provider={ch.provider} className="h-3 w-3" />}
                      {KIND_LABELS[ch.provider] ?? ch.provider}
                    </Badge>
                  </TableCell>
                  <TableCell>{ch.display_phone ?? (ch.provider === "instagram" && ch.external_username ? `@${ch.external_username}` : ch.provider === "messenger" ? ch.external_username : null) ?? "–"}</TableCell>
                  <TableCell>
                    {ch.provider === "qr" || isSocial(ch.provider) ? (
                      <Badge variant="outline" className={connection.className}>
                        {connection.label}
                      </Badge>
                    ) : (
                      <span className="font-mono text-xs">
                        {ch.phone_number_id}
                        {ch.waba_id ? ` · WABA ${ch.waba_id}` : ""}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isSocial(ch.provider) ? (
                      isAdmin && (
                        <div className="flex flex-wrap gap-2">
                          {ch.is_active && ch.connection_status === "connected" ? (
                            <Button size="sm" variant="outline" onClick={() => disconnect(ch)} disabled={disconnecting === ch.id}>
                              {disconnecting === ch.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Unplug className="mr-1 h-3 w-3" />}
                              Putuskan
                            </Button>
                          ) : (
                            <Button size="sm" onClick={relogin}>
                              <Facebook className="mr-1 h-3 w-3" />
                              Hubungkan ulang
                            </Button>
                          )}
                        </div>
                      )
                    ) : ch.provider === "qr" ? (
                      isAdmin && (
                        <div className="flex flex-wrap gap-2">
                          {ch.connection_status !== "connected" && (
                            <Button size="sm" onClick={() => setQrChannel({ id: ch.id, name: ch.name })} disabled={!ch.is_active}>
                              <QrCode className="mr-1 h-3 w-3" />
                              Hubungkan
                            </Button>
                          )}
                          {ch.connection_status !== "disconnected" && (
                            <Button size="sm" variant="outline" onClick={() => disconnect(ch)} disabled={disconnecting === ch.id}>
                              {disconnecting === ch.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Unplug className="mr-1 h-3 w-3" />}
                              Putuskan
                            </Button>
                          )}
                        </div>
                      )
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => sync(ch.id)} disabled={syncing === ch.id || !ch.waba_id}>
                        {syncing === ch.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                        Sinkron template ({templates.filter((t) => t.channel_id === ch.id).length})
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch checked={ch.is_active} disabled={!isAdmin} onCheckedChange={(v) => toggle(ch.id, v)} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {isAdmin && (
          <form onSubmit={addChannel} className="max-w-3xl space-y-3 rounded-lg border p-4">
            <p className="font-medium">Tambah nomor WhatsApp</p>
            <RadioGroup
              value={provider}
              onValueChange={(v) => setProvider(v as "cloud_api" | "qr")}
              className="grid gap-2 md:grid-cols-2"
            >
              <Label htmlFor="prov-qr" className="flex cursor-pointer gap-3 rounded-md border p-3 font-normal [&:has(:checked)]:border-primary">
                <RadioGroupItem id="prov-qr" value="qr" className="mt-0.5" />
                <span>
                  <span className="block font-medium">Scan QR</span>
                  <span className="text-xs text-muted-foreground">
                    Pakai nomor WhatsApp yang sudah ada, tanpa daftar ke Meta. Tidak resmi: ada risiko nomor diblokir
                    WhatsApp, hindari kirim massal.
                  </span>
                </span>
              </Label>
              <Label htmlFor="prov-cloud" className="flex cursor-pointer gap-3 rounded-md border p-3 font-normal [&:has(:checked)]:border-primary">
                <RadioGroupItem id="prov-cloud" value="cloud_api" className="mt-0.5" />
                <span>
                  <span className="block font-medium">WhatsApp API resmi</span>
                  <span className="text-xs text-muted-foreground">
                    Meta Cloud API: stabil dan aman dari blokir. Perlu akun Meta Business; berlaku aturan 24 jam dan
                    template.
                  </span>
                </span>
              </Label>
            </RadioGroup>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ch-name">Nama</Label>
                <Input id="ch-name" placeholder="CS Utama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              {provider === "cloud_api" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="ch-phone">Nomor tampil</Label>
                    <Input id="ch-phone" placeholder="+62 812 0000 0000" value={form.display_phone} onChange={(e) => setForm({ ...form, display_phone: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ch-pnid">Phone number ID</Label>
                    <Input id="ch-pnid" value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ch-waba">WhatsApp Business Account ID</Label>
                    <Input id="ch-waba" value={form.waba_id} onChange={(e) => setForm({ ...form, waba_id: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            <Button type="submit">{provider === "qr" ? "Tambah & tampilkan QR" : "Tambah nomor"}</Button>
          </form>
        )}

        {isAdmin && <SocialConnect onConnected={refresh} />}

        {channels.some((ch) => ch.provider === "cloud_api") && (
          <CopyField
            label="URL webhook API resmi (isi di Meta → WhatsApp → Configuration)"
            value={WEBHOOK_URL}
            hint={<>Verify token = nilai WHATSAPP_VERIFY_TOKEN di server. Langganan field: <code>messages</code>.</>}
          />
        )}
        {isAdmin && (
          <CopyField
            label="URL webhook Messenger & Instagram (Meta App → Webhooks: Page dan Instagram)"
            value={META_WEBHOOK_URL}
            hint={
              <>
                Verify token sama dengan WhatsApp. Field Page: <code>messages</code>, <code>message_echoes</code>,{" "}
                <code>message_deliveries</code>, <code>message_reads</code>, <code>messaging_postbacks</code>; Instagram:{" "}
                <code>messages</code>.
              </>
            }
          />
        )}

        {templates.length > 0 && (
          <div className="space-y-2">
            <Label>Template tersinkron</Label>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <Badge key={t.id} variant={t.status === "APPROVED" ? "default" : "outline"}>
                  {t.name} · {t.language} · {t.status}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <QrConnectDialog channel={qrChannel} onOpenChange={closeQr} onConnected={refresh} />
    </Card>
  );
}

function LabelsCard() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const queryClient = useQueryClient();
  const { data: labels = [] } = useLabels(orgId);
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["labels", orgId] });
    queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = name;
    const position = labels.reduce((max, l) => Math.max(max, l.position), 0) + 1;
    const { error } = await supabase
      .from("labels")
      .insert({ organization_id: orgId, name: submitted.trim(), color, position });
    if (error) {
      toast.error(error.code === "23505" ? "Label dengan nama itu sudah ada" : errorMessage(error));
      return;
    }
    // Keep a name typed while this one was saving.
    setName((current) => (current === submitted ? "" : current));
    refresh();
  };

  // Swap with the neighbour; positions are renumbered so ties from old data resolve.
  const reorder = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= labels.length) return;
    const ordered = labels.slice();
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const results = await Promise.all(
      ordered.map((l, i) =>
        l.position === i + 1 ? null : supabase.from("labels").update({ position: i + 1 }).eq("id", l.id),
      ),
    );
    const failed = results.find((r) => r?.error);
    if (failed?.error) toast.error(errorMessage(failed.error));
    refresh();
  };

  const setInPipeline = async (id: string, inPipeline: boolean) => {
    const { error } = await supabase.from("labels").update({ in_pipeline: inPipeline }).eq("id", id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };

  const remove = async (id: string, labelName: string) => {
    if (!window.confirm(`Hapus label "${labelName}" dari semua chat?`)) return;
    const { error } = await supabase.from("labels").delete().eq("id", id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Label</CardTitle>
        <CardDescription>
          Kategori chat, mis. Prospek, Negosiasi, Order, Komplain. Urutan di sini menjadi urutan kolom di Pipeline;
          matikan "Tahap pipeline" untuk label penanda saja (mis. VIP).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {labels.length === 0 && <p className="text-sm text-muted-foreground">Belum ada label.</p>}
        {labels.length > 0 && (
          <div className="max-w-xl divide-y divide-border rounded-lg border border-border">
            {labels.map((l, i) => (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex flex-col">
                  <button
                    onClick={() => reorder(i, -1)}
                    disabled={i === 0}
                    aria-label={`Naikkan ${l.name}`}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => reorder(i, 1)}
                    disabled={i === labels.length - 1}
                    aria-label={`Turunkan ${l.name}`}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <LabelChip label={l} className="text-xs" />
                <div className="ml-auto flex items-center gap-2">
                  <Switch
                    id={`pipeline-${l.id}`}
                    checked={l.in_pipeline}
                    onCheckedChange={(v) => setInPipeline(l.id, v)}
                  />
                  <Label htmlFor={`pipeline-${l.id}`} className="text-xs text-muted-foreground">
                    Tahap pipeline
                  </Label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => remove(l.id, l.name)}
                    aria-label={`Hapus ${l.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={add} className="flex max-w-xl flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama label"
            className="w-48"
            maxLength={40}
            required
          />
          <div className="flex gap-1">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Warna ${c}`}
                className={cn("h-6 w-6 rounded-full border-2", color === c ? "border-foreground" : "border-transparent")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <Button type="submit" variant="outline">
            Tambah label
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { profile } = useAuth();
  const isAdmin = profile!.role === "admin";
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Pengaturan</h1>
        <p className="text-muted-foreground">Organisasi, kanal chat (WhatsApp, Messenger, Instagram), dan label.</p>
      </div>
      <OrganizationCard isAdmin={isAdmin} />
      <ChannelsCard isAdmin={isAdmin} />
      <LabelsCard />
    </div>
  );
}
