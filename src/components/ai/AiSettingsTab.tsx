import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2, PlugZap, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { PROVIDERS, type Provider, useAiSettings } from "./aiSettings";
import { callFunction, errorMessage } from "@/lib/api";
import { toast } from "sonner";

const DEFAULTS = {
  enabled: false,
  provider: "anthropic" as Provider,
  model: "claude-opus-5-5",
  base_url: "",
  bot_name: "Asisten",
  instructions: "",
  handoff_message: "Baik kak, saya sambungkan ke tim CS kami ya. Mohon ditunggu sebentar 🙏",
  reply_delay_seconds: 6,
  max_auto_replies: 10,
};

export function AiSettingsTab({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, isFetched } = useAiSettings(orgId);
  const [form, setForm] = useState(DEFAULTS);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data: channels = [], refetch: refetchChannels } = useQuery({
    queryKey: ["channels", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("channels").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });

  // Load the saved settings once; later refreshes (e.g. after saving the key)
  // must not overwrite what the admin is typing.
  const loaded = useRef(false);
  useEffect(() => {
    if (!isFetched || loaded.current) return;
    loaded.current = true;
    if (!settings) return;
    setForm({
      enabled: settings.enabled,
      provider: settings.provider,
      model: settings.model,
      base_url: settings.base_url ?? "",
      bot_name: settings.bot_name,
      instructions: settings.instructions,
      handoff_message: settings.handoff_message,
      reply_delay_seconds: settings.reply_delay_seconds,
      max_auto_replies: settings.max_auto_replies,
    });
  }, [settings, isFetched]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ai-settings", orgId] });
  const provider = PROVIDERS[form.provider];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.enabled && !settings?.api_key_hint) {
      toast.error("Simpan API key dulu sebelum mengaktifkan AI");
      return;
    }
    if (form.provider === "custom" && !form.base_url.trim()) {
      toast.error("Base URL wajib untuk LLM lain");
      return;
    }
    setBusy("save");
    const { error } = await supabase.from("ai_settings").upsert(
      {
        organization_id: orgId,
        ...form,
        model: form.model.trim(),
        base_url: form.base_url.trim() || null,
        bot_name: form.bot_name.trim() || "Asisten",
      },
      { onConflict: "organization_id" },
    );
    setBusy(null);
    if (error) toast.error(errorMessage(error));
    else toast.success("Pengaturan AI disimpan");
    refresh();
  };

  // Provider, model and base URL are stored together with the key, so a key is
  // never used with another provider's settings.
  const saveModel = async () => {
    if (form.provider === "custom" && !form.base_url.trim()) throw new Error("Base URL wajib untuk LLM lain");
    if (!form.model.trim()) throw new Error("Isi nama model");
    const { error } = await supabase.from("ai_settings").upsert(
      { organization_id: orgId, provider: form.provider, model: form.model.trim(), base_url: form.base_url.trim() || null },
      { onConflict: "organization_id" },
    );
    if (error) throw error;
  };
  const saved = { provider: settings?.provider ?? DEFAULTS.provider, model: settings?.model ?? DEFAULTS.model, base_url: settings?.base_url ?? "" };
  const modelUnsaved =
    isFetched && (saved.provider !== form.provider || saved.model !== form.model.trim() || saved.base_url !== form.base_url.trim());

  const saveKey = async () => {
    setBusy("key");
    try {
      await saveModel();
      await callFunction("ai-admin", { action: "set_key", api_key: apiKey.trim() });
      setApiKey("");
      toast.success(`API key ${provider.label} disimpan (terenkripsi)`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const clearKey = async () => {
    if (!window.confirm("Hapus API key? AI akan dimatikan.")) return;
    setBusy("clear");
    try {
      await callFunction("ai-admin", { action: "clear_key" });
      toast.success("API key dihapus");
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy("check");
    try {
      await saveModel();
      refresh();
      const r = await callFunction<{ model: string; latency_ms: number }>("ai-admin", { action: "check" });
      toast.success(`Terhubung ke ${r.model} (${(r.latency_ms / 1000).toFixed(1)} dtk)`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const toggleChannel = async (id: string, enabled: boolean) => {
    const { error } = await supabase.from("channels").update({ ai_enabled: enabled }).eq("id", id);
    if (error) toast.error(errorMessage(error));
    refetchChannels();
  };

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Model AI</CardTitle>
          <CardDescription>
            Pilih penyedia dan model. Biaya pemakaian ditagih langsung oleh penyedia ke akun API Anda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid max-w-3xl gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Penyedia</Label>
              <Select
                value={form.provider}
                disabled={!isAdmin}
                onValueChange={(v) => {
                  const p = v as Provider;
                  setForm({ ...form, provider: p, model: PROVIDERS[p].models[0] ?? "", base_url: PROVIDERS[p].baseUrl ?? "" });
                }}
              >
                <SelectTrigger aria-label="Penyedia AI">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDERS[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-model">Model</Label>
              <Input
                id="ai-model"
                list="ai-model-options"
                value={form.model}
                disabled={!isAdmin}
                placeholder="nama model"
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                required
              />
              <datalist id="ai-model-options">
                {provider.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="ai-base">
                Base URL {form.provider === "custom" ? "(wajib)" : "(opsional, untuk proxy/gateway)"}
              </Label>
              <Input
                id="ai-base"
                value={form.base_url}
                disabled={!isAdmin}
                placeholder={form.provider === "custom" ? "https://openrouter.ai/api/v1" : "kosongkan untuk alamat resmi"}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              />
            </div>
          </div>

          {isAdmin && modelUnsaved && (
            <p className="max-w-3xl rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              Penyedia/model belum disimpan (tersimpan: {PROVIDERS[saved.provider as Provider]?.label ?? saved.provider} · {saved.model}). Klik <b>Simpan key</b>, <b>Cek koneksi</b>, atau <b>Simpan pengaturan</b>.
            </p>
          )}

          <div className="max-w-3xl space-y-1">
            <Label htmlFor="ai-key">API key</Label>
            <div className="flex flex-wrap items-center gap-2">
              {settings?.api_key_hint ? (
                <Badge variant="outline" className="gap-1 border-success/40 text-success">
                  <CheckCircle2 className="h-3 w-3" /> Tersimpan {settings.api_key_hint}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-warning/50 text-warning">
                  Belum ada
                </Badge>
              )}
            </div>
            {isAdmin && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Input
                  id="ai-key"
                  type="password"
                  autoComplete="off"
                  className="max-w-md"
                  placeholder={provider.keyHint}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={saveKey} disabled={apiKey.trim().length < 8 || busy === "key"}>
                  {busy === "key" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1 h-4 w-4" />}
                  Simpan key
                </Button>
                {settings?.api_key_hint && (
                  <>
                    <Button type="button" variant="outline" onClick={check} disabled={busy === "check"}>
                      {busy === "check" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1 h-4 w-4" />}
                      Cek koneksi
                    </Button>
                    <Button type="button" variant="ghost" onClick={clearKey} disabled={busy === "clear"} aria-label="Hapus API key">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Key disimpan terenkripsi di server dan tidak pernah dikirim balik ke browser. Cek koneksi memakai pengaturan
              yang sudah disimpan.
            </p>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={save} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Perilaku AI</CardTitle>
            <CardDescription>
              AI hanya menjawab chat yang belum diambil agen. Begitu agen mengambil chat, AI berhenti. Jika AI tidak tahu
              jawabannya, chat diserahkan ke agen dengan catatan alasannya.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex max-w-3xl items-center justify-between gap-4 rounded-lg border p-4">
              <span>
                <span className="block font-medium">Balas otomatis</span>
                <span className="text-sm text-muted-foreground">
                  AI menjawab pelanggan sendiri di nomor yang dipilih di bawah.
                </span>
              </span>
              <Switch
                checked={form.enabled}
                disabled={!isAdmin}
                onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                aria-label="Aktifkan balas otomatis"
              />
            </label>

            <div className="grid max-w-3xl gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="ai-name">Nama bot</Label>
                <Input id="ai-name" value={form.bot_name} disabled={!isAdmin} maxLength={60} onChange={(e) => setForm({ ...form, bot_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ai-delay">Jeda sebelum membalas (detik)</Label>
                <Input
                  id="ai-delay"
                  type="number"
                  min={0}
                  max={30}
                  value={form.reply_delay_seconds}
                  disabled={!isAdmin}
                  onChange={(e) => setForm({ ...form, reply_delay_seconds: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ai-max">Maks. balasan AI per chat</Label>
                <Input
                  id="ai-max"
                  type="number"
                  min={1}
                  max={50}
                  value={form.max_auto_replies}
                  disabled={!isAdmin}
                  onChange={(e) => setForm({ ...form, max_auto_replies: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="max-w-3xl space-y-1">
              <Label htmlFor="ai-instructions">Instruksi untuk AI</Label>
              <Textarea
                id="ai-instructions"
                rows={5}
                maxLength={4000}
                disabled={!isAdmin}
                placeholder={"Contoh: Panggil pelanggan \"kak\". Tawarkan bundling jika pelanggan membeli 2 produk. Jam operasional 08.00-17.00 WIB."}
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Gaya bahasa, aturan toko, dan hal yang tidak boleh dijawab. Info produk diisi di tab Produk & Pengetahuan.
              </p>
            </div>
            <div className="max-w-3xl space-y-1">
              <Label htmlFor="ai-handoff">Pesan saat diserahkan ke agen</Label>
              <Textarea
                id="ai-handoff"
                rows={2}
                maxLength={500}
                disabled={!isAdmin}
                value={form.handoff_message}
                onChange={(e) => setForm({ ...form, handoff_message: e.target.value })}
              />
            </div>

            <div className="max-w-3xl space-y-2">
              <Label>Nomor yang dijawab AI</Label>
              {channels.length === 0 && <p className="text-sm text-muted-foreground">Belum ada nomor WhatsApp.</p>}
              {channels.map((ch) => (
                <label key={ch.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={ch.ai_enabled}
                    disabled={!isAdmin}
                    onCheckedChange={(v) => toggleChannel(ch.id, v === true)}
                    aria-label={`AI di ${ch.name}`}
                  />
                  {ch.name} {ch.display_phone ? <span className="text-muted-foreground">({ch.display_phone})</span> : null}
                </label>
              ))}
            </div>

            {isAdmin && (
              <Button type="submit" disabled={busy === "save"}>
                {busy === "save" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Simpan pengaturan
              </Button>
            )}
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
