import { useState } from "react";
import { Copy, Globe, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { callFunction, errorMessage } from "@/lib/api";
import { toast } from "sonner";

// Telegram: the business makes a bot in @BotFather and pastes its token here.
export function TelegramConnect({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { username } = await callFunction<{ username: string }>("telegram-connect", { action: "connect", bot_token: token.trim() });
      toast.success(`Bot @${username} terhubung`);
      setToken("");
      onConnected();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={connect} className="max-w-3xl space-y-2 rounded-lg border p-4">
      <p className="flex items-center gap-2 font-medium">
        <Send className="h-4 w-4 text-[#229ED9]" /> Telegram
      </p>
      <p className="text-sm text-muted-foreground">
        Di Telegram, chat <b>@BotFather</b> → kirim <code>/newbot</code> → beri nama bot → salin token yang diberikan, lalu
        tempel di sini. Pelanggan cukup membuka <code>t.me/namabot</code> untuk chat.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          id="tg-token"
          className="max-w-md"
          placeholder="123456789:AAH…"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy || token.trim().length < 20} className="bg-[#229ED9] hover:bg-[#229ED9]/90">
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
          Hubungkan bot
        </Button>
      </div>
    </form>
  );
}

// Website live chat: create a widget, then copy its embed code.
export function WebchatCreate({ orgId, onCreated }: { orgId: string; onCreated: (channel: Tables<"channels">) => void }) {
  const [name, setName] = useState("Live chat website");
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase
      .from("channels")
      .insert({
        organization_id: orgId,
        name: name.trim(),
        provider: "webchat",
        connection_status: "connected",
        config: { title: name.trim(), greeting: "Halo! Ada yang bisa kami bantu?", color: "#2563eb", ask_name: true },
      })
      .select("*")
      .single();
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success("Widget dibuat. Salin kode pasangnya ke website Anda.");
    onCreated(data);
  };

  return (
    <form onSubmit={create} className="max-w-3xl space-y-2 rounded-lg border p-4">
      <p className="flex items-center gap-2 font-medium">
        <Globe className="h-4 w-4 text-primary" /> Live chat website
      </p>
      <p className="text-sm text-muted-foreground">
        Gelembung chat di pojok website Anda. Pesan pengunjung masuk ke Inbox ini dan bisa dijawab agen atau AI.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-md" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Nama widget" required />
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Globe className="mr-1 h-4 w-4" />}
          Buat widget
        </Button>
      </div>
    </form>
  );
}

interface WidgetConfig {
  title?: string;
  greeting?: string;
  color?: string;
  ask_name?: boolean;
  allowed_origins?: string[];
  position?: "right" | "left";
  button_label?: string;
}

function embedCode(widgetKey: string) {
  const app = window.location.origin;
  const api = import.meta.env.VITE_SUPABASE_URL;
  return `<script src="${app}/widget.js" data-key="${widgetKey}" data-api="${api}" async></script>`;
}

// Appearance of a widget and the code to paste before </body> on the website.
export function WebchatDialog({
  channel,
  onOpenChange,
  onSaved,
}: {
  channel: Tables<"channels"> | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<WidgetConfig & { origins: string }>({ origins: "" });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (channel && loadedFor !== channel.id) {
    const config = (channel.config ?? {}) as WidgetConfig;
    setLoadedFor(channel.id);
    setForm({ ...config, ask_name: config.ask_name !== false, origins: (config.allowed_origins ?? []).join("\n") });
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channel) return;
    setSaving(true);
    const config: WidgetConfig = {
      title: form.title?.trim() || channel.name,
      greeting: form.greeting?.trim() || "Halo! Ada yang bisa kami bantu?",
      color: /^#[0-9a-fA-F]{6}$/.test(form.color ?? "") ? form.color : "#2563eb",
      ask_name: form.ask_name !== false,
      position: form.position === "left" ? "left" : "right",
      button_label: (form.button_label ?? "Chat dengan kami").trim().slice(0, 40),
      allowed_origins: form.origins
        .split(/[\s,]+/)
        .map((o) => o.trim().replace(/\/$/, ""))
        .filter(Boolean),
    };
    const { error } = await supabase.from("channels").update({ config: config as unknown as Json }).eq("id", channel.id);
    setSaving(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success("Widget disimpan");
    onSaved();
  };

  const code = channel?.external_id ? embedCode(channel.external_id) : "";

  return (
    <Dialog open={channel !== null} onOpenChange={(o) => { if (!o) setLoadedFor(null); onOpenChange(o); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Live chat: {channel?.name}</DialogTitle>
          <DialogDescription>Tempel kode ini sebelum tag &lt;/body&gt; di setiap halaman website Anda.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Kode pasang</Label>
          <div className="flex gap-2">
            <Textarea readOnly rows={3} className="font-mono text-xs" value={code} data-testid="embed-code" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => navigator.clipboard.writeText(code).then(() => toast.success("Kode disalin"))}
              aria-label="Salin kode pasang"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="wc-title">Judul</Label>
              <Input id="wc-title" value={form.title ?? ""} maxLength={60} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wc-color">Warna</Label>
              <Input id="wc-color" type="color" className="h-10 w-16 p-1" value={form.color ?? "#2563eb"} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="wc-button">Teks tombol melayang</Label>
              <Input
                id="wc-button"
                value={form.button_label ?? "Chat dengan kami"}
                maxLength={40}
                placeholder="Kosongkan untuk ikon saja"
                onChange={(e) => setForm({ ...form, button_label: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Posisi tombol</Label>
              <Select value={form.position ?? "right"} onValueChange={(v) => setForm({ ...form, position: v as "right" | "left" })}>
                <SelectTrigger className="w-40" aria-label="Posisi tombol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="right">Kanan bawah</SelectItem>
                  <SelectItem value="left">Kiri bawah</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wc-greeting">Sapaan pembuka</Label>
            <Textarea id="wc-greeting" rows={2} maxLength={300} value={form.greeting ?? ""} onChange={(e) => setForm({ ...form, greeting: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.ask_name !== false} onCheckedChange={(v) => setForm({ ...form, ask_name: v })} />
            Tanya nama (dan No. WhatsApp/email opsional) sebelum chat
          </label>
          <div className="space-y-1">
            <Label htmlFor="wc-origins">Hanya izinkan di website (opsional)</Label>
            <Textarea
              id="wc-origins"
              rows={2}
              placeholder={"https://tokoanda.com\nhttps://www.tokoanda.com"}
              value={form.origins}
              onChange={(e) => setForm({ ...form, origins: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Kosongkan agar widget bisa dipasang di website mana pun.</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
