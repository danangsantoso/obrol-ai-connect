import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bot, Copy, KeyRound, Loader2, Plus, Send, ShoppingBag, Trash2, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { toast } from "sonner";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const API_URL = `${FUNCTIONS_URL}/api/v1`;
const MCP_URL = `${FUNCTIONS_URL}/mcp`;

const EVENTS: { value: string; label: string }[] = [
  { value: "message.received", label: "Pesan masuk dari pelanggan" },
  { value: "message.sent", label: "Pesan terkirim (agen, AI, API)" },
  { value: "conversation.created", label: "Chat baru" },
  { value: "conversation.assigned", label: "Chat di-assign / dipindah" },
  { value: "order.created", label: "Pesanan dibuat" },
  { value: "order.paid", label: "Pesanan lunas" },
  { value: "order.status_changed", label: "Status pesanan berubah" },
  { value: "conversation.resolved", label: "Chat selesai" },
  { value: "conversation.status_changed", label: "Status chat berubah" },
  { value: "contact.created", label: "Kontak baru" },
];

const when = (iso: string | null) => (iso ? format(new Date(iso), "dd/MM/yy HH:mm") : "–");

function copy(text: string, what = "Disalin") {
  navigator.clipboard.writeText(text).then(() => toast.success(what));
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-3 pr-12 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button type="button" size="icon" variant="ghost" className="absolute right-1 top-1 h-8 w-8" onClick={() => copy(code)} aria-label={`Salin ${label}`}>
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ApiKeys() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("create_api_key", { key_name: name.trim() });
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    setName("");
    setNewKey(data);
    queryClient.invalidateQueries({ queryKey: ["api-keys"] });
  };

  const revoke = async (id: string, keyName: string) => {
    if (!window.confirm(`Cabut API key "${keyName}"? Sistem yang memakainya langsung berhenti terhubung.`)) return;
    const { error } = await supabase.rpc("revoke_api_key", { key_id: id });
    if (error) toast.error(errorMessage(error));
    else toast.success("API key dicabut");
    queryClient.invalidateQueries({ queryKey: ["api-keys"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" /> API key
        </CardTitle>
        <CardDescription>
          Untuk REST API dan MCP. Satu key berlaku untuk seluruh organisasi, jadi simpan hanya di server (jangan di kode
          website yang terlihat pengunjung). Buat key terpisah untuk tiap sistem agar mudah dicabut.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={create} className="flex flex-wrap gap-2">
          <Input
            className="max-w-xs"
            placeholder="Nama, mis. Website toko / n8n / Claude"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            aria-label="Nama API key"
            required
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
            Buat API key
          </Button>
        </form>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada API key.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>Terakhir dipakai</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.key_prefix}…</TableCell>
                  <TableCell>{when(k.created_at)}</TableCell>
                  <TableCell>{when(k.last_used_at)}</TableCell>
                  <TableCell className="text-right">
                    {k.revoked_at ? (
                      <Badge variant="outline">Dicabut</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => revoke(k.id, k.name)}>
                        <Trash2 className="mr-1 h-4 w-4" /> Cabut
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={newKey !== null} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API key baru</DialogTitle>
            <DialogDescription>Salin sekarang. Key ini hanya ditampilkan sekali dan tidak bisa dilihat lagi.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={newKey ?? ""} className="font-mono text-xs" data-testid="new-api-key" />
            <Button type="button" variant="outline" onClick={() => copy(newKey ?? "", "API key disalin")}>
              <Copy className="mr-1 h-4 w-4" /> Salin
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>Sudah saya simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Webhooks({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    queryClient.invalidateQueries({ queryKey: ["webhook-deliveries"] });
  };
  const { data: hooks = [] } = useQuery({
    queryKey: ["webhooks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("webhooks").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
    refetchInterval: 15_000,
  });
  const { data: deliveries = [] } = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_deliveries")
        .select("id, webhook_id, event, status, attempts, response_status, error, created_at")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data;
    },
    refetchInterval: 15_000,
  });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("webhooks").insert({ organization_id: orgId, url: url.trim(), events });
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    setUrl("");
    setEvents([]);
    toast.success("Webhook ditambahkan");
    refresh();
  };
  const toggle = async (id: string, isActive: boolean) => {
    const { error } = await supabase.from("webhooks").update({ is_active: isActive }).eq("id", id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };
  const remove = async (id: string) => {
    if (!window.confirm("Hapus webhook ini?")) return;
    const { error } = await supabase.from("webhooks").delete().eq("id", id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };
  const test = async (id: string) => {
    const { error } = await supabase.rpc("test_webhook", { webhook: id });
    if (error) toast.error(errorMessage(error));
    else toast.success("Event uji (ping) dikirim. Hasilnya muncul di daftar pengiriman.");
    setTimeout(refresh, 2500);
  };
  const hookUrl = new Map(hooks.map((h) => [h.id, h.url]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="h-5 w-5 text-primary" /> Webhook
        </CardTitle>
        <CardDescription>
          Balas.id mengirim POST JSON ke URL Anda setiap ada kejadian (pesan masuk, chat selesai, dan lainnya). Gagal
          terkirim dicoba ulang hingga 5 kali. Setiap kiriman ditandatangani dengan secret (header X-Balas-Signature).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={add} className="space-y-3 rounded-lg border p-3">
          <div className="space-y-1">
            <Label htmlFor="hook-url">URL penerima</Label>
            <Input id="hook-url" type="url" placeholder="https://tokoanda.com/api/balas-webhook" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>Event (kosongkan semua = kirim semua event)</Label>
            <div className="grid gap-1 sm:grid-cols-2">
              {EVENTS.map((ev) => (
                <label key={ev.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={events.includes(ev.value)}
                    onCheckedChange={(v) => setEvents(v === true ? [...events, ev.value] : events.filter((x) => x !== ev.value))}
                  />
                  {ev.label} <span className="font-mono text-xs text-muted-foreground">{ev.value}</span>
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
            Tambah webhook
          </Button>
        </form>

        {hooks.map((h) => (
          <div key={h.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="break-all font-mono text-sm">{h.url}</p>
              <div className="flex items-center gap-2">
                <Switch checked={h.is_active} onCheckedChange={(v) => toggle(h.id, v)} aria-label="Webhook aktif" />
                <Button size="sm" variant="outline" onClick={() => test(h.id)}>
                  <Send className="mr-1 h-4 w-4" /> Kirim uji
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(h.id)} aria-label="Hapus webhook">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Event: {h.events.length ? h.events.join(", ") : "semua"} · Terakhir: {when(h.last_delivery_at)}
              {h.last_status ? ` (HTTP ${h.last_status})` : ""}
              {h.last_error ? <span className="text-danger"> · {h.last_error}</span> : null}
            </p>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Secret:</span>
              <code className="rounded bg-muted px-1.5 py-0.5">{h.secret.slice(0, 12)}…</code>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => copy(h.secret, "Secret disalin")}>
                <Copy className="mr-1 h-3 w-3" /> Salin secret
              </Button>
            </div>
          </div>
        ))}

        {deliveries.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Pengiriman terakhir</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Tujuan</TableHead>
                  <TableHead>Hasil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap">{when(d.created_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{d.event}</TableCell>
                    <TableCell className="max-w-[16rem] truncate text-xs">{hookUrl.get(d.webhook_id)}</TableCell>
                    <TableCell>
                      {d.status === "delivered" ? (
                        <Badge variant="outline" className="border-success/40 text-success">Terkirim{d.response_status ? ` ${d.response_status}` : ""}</Badge>
                      ) : d.status === "failed" ? (
                        <Badge variant="outline" className="border-danger/40 text-danger">Gagal · {d.error}</Badge>
                      ) : (
                        <Badge variant="outline" className="border-warning/50 text-warning">
                          {d.attempts ? `Dicoba ulang (${d.attempts}x) · ${d.error ?? ""}` : "Menunggu"}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Guide() {
  const curlSend = `curl -X POST ${API_URL}/messages \\
  -H "Authorization: Bearer blsk_xxx" -H "Content-Type: application/json" \\
  -d '{"channel_id":"<id kanal WhatsApp>","to":"081234567890","text":"Halo kak, pesanan #123 sudah dikirim 🚚"}'`;
  const curlContact = `curl -X POST ${API_URL}/contacts \\
  -H "Authorization: Bearer blsk_xxx" -H "Content-Type: application/json" \\
  -d '{"phone":"081234567890","name":"Rina","email":"rina@mail.com","notes":"Lead dari form website"}'`;
  const claudeCode = `claude mcp add --transport http balas ${MCP_URL} \\
  --header "Authorization: Bearer blsk_xxx"`;
  const mcpJson = JSON.stringify({ mcpServers: { balas: { type: "http", url: MCP_URL, headers: { Authorization: "Bearer blsk_xxx" } } } }, null, 2);
  const verify = `// Node.js: verifikasi tanda tangan webhook
const crypto = require("crypto");
function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" /> Cara menghubungkan
        </CardTitle>
        <CardDescription>
          Website pelanggan: pasang <b>live chat</b> (Pengaturan → Kanal chat). Sistem Anda (toko online, CRM, ERP, n8n,
          Zapier, Make): pakai <b>REST API</b> dan <b>Webhook</b>. Asisten AI (Claude, ChatGPT, Cursor): pakai <b>MCP</b>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="api">
          <TabsList>
            <TabsTrigger value="api">REST API</TabsTrigger>
            <TabsTrigger value="mcp">MCP</TabsTrigger>
            <TabsTrigger value="webhook">Webhook</TabsTrigger>
          </TabsList>
          <TabsContent value="api" className="space-y-3">
            <p className="text-sm">
              Base URL: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{API_URL}</code>
            </p>
            <p className="text-sm text-muted-foreground">Kirim WhatsApp (mis. notifikasi pesanan) dari sistem Anda:</p>
            <CodeBlock code={curlSend} label="contoh kirim pesan" />
            <p className="text-sm text-muted-foreground">Simpan lead dari form website ke Kontak:</p>
            <CodeBlock code={curlContact} label="contoh simpan kontak" />
            <p className="text-sm text-muted-foreground">
              Endpoint lain: <code>GET /channels</code>, <code>GET /conversations</code>, <code>GET /conversations/:id/messages</code>,{" "}
              <code>PATCH /conversations/:id</code> (status, assignee_email), <code>GET /contacts?search=</code>, <code>GET /stats</code>.
              Kirim file dengan <code>media_url</code>; nomor WhatsApp API resmi di luar 24 jam memakai <code>template</code>.
            </p>
          </TabsContent>
          <TabsContent value="mcp" className="space-y-3">
            <p className="text-sm">
              URL server MCP: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{MCP_URL}</code>
            </p>
            <p className="text-sm text-muted-foreground">Claude Code:</p>
            <CodeBlock code={claudeCode} label="perintah Claude Code" />
            <p className="text-sm text-muted-foreground">Klien lain (Cursor, Claude Desktop lewat konektor, dsb.):</p>
            <CodeBlock code={mcpJson} label="konfigurasi MCP" />
            <p className="text-sm text-muted-foreground">
              Tool: list_channels, list_conversations, get_conversation, get_messages, send_message, update_conversation,
              search_contacts, upsert_contact, get_stats. Pesan yang dikirim AI lewat MCP sampai ke pelanggan sungguhan.
            </p>
          </TabsContent>
          <TabsContent value="webhook" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Contoh isi kiriman <code>message.received</code>: <code>{`{ id, event, organization_id, created_at, data: { message, conversation } }`}</code>.
              Balas dengan HTTP 2xx dalam 10 detik. Verifikasi tanda tangan:
            </p>
            <CodeBlock code={verify} label="contoh verifikasi" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

const MARKETPLACES = [
  { name: "Shopee", detail: "Chat pembeli & status pesanan Shopee" },
  { name: "Tokopedia", detail: "Chat pembeli & status pesanan Tokopedia" },
  { name: "TikTok Shop", detail: "Chat pembeli & pesanan TikTok Shop" },
];

// Marketplace chats in the same inbox: announced, not built yet.
function Marketplaces() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5" /> Marketplace
          <Badge variant="secondary">Segera hadir</Badge>
        </CardTitle>
        <CardDescription>Chat dan pesanan dari marketplace masuk ke Inbox yang sama, dijawab tim dan AI seperti chat WhatsApp.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {MARKETPLACES.map((m) => (
          <div key={m.name} className="flex flex-col gap-2 rounded-lg border border-dashed p-4" aria-disabled="true">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{m.name}</p>
              <Badge variant="outline" className="text-muted-foreground">Segera hadir</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{m.detail}</p>
            <Button size="sm" variant="outline" disabled className="mt-auto">
              Hubungkan
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function Integrations() {
  const { profile } = useAuth();
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Integrasi</h1>
        <p className="text-muted-foreground">Hubungkan Balas.id dengan website, sistem lain, dan asisten AI lewat API, Webhook, atau MCP.</p>
      </div>
      <Marketplaces />
      <Guide />
      <ApiKeys />
      <Webhooks orgId={profile!.organization_id!} />
    </div>
  );
}
