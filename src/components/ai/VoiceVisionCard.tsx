import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { callFunction, errorMessage } from "@/lib/api";
import { toast } from "sonner";
import { useAiSettings } from "./aiSettings";

const STT: Record<string, { label: string; model: string; hint: string }> = {
  openai: { label: "OpenAI (Whisper)", model: "whisper-1", hint: "platform.openai.com → API keys. Kalau AI chat juga OpenAI, key yang sama dipakai otomatis." },
  groq: { label: "Groq (Whisper, cepat & murah)", model: "whisper-large-v3-turbo", hint: "console.groq.com → API Keys." },
  custom: { label: "Lainnya (kompatibel OpenAI)", model: "whisper-1", hint: "Layanan dengan endpoint /audio/transcriptions." },
};

// Voice notes (speech to text) and pictures (vision) for the AI.
export function VoiceVisionCard({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data: settings, isFetched } = useAiSettings(orgId);
  const [form, setForm] = useState({ vision: true, provider: "off", model: "whisper-1", base_url: "" });
  const [key, setKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isFetched || loaded) return;
    setLoaded(true);
    if (!settings) return;
    setForm({
      vision: settings.vision_enabled,
      provider: settings.stt_provider ?? "off",
      model: settings.stt_model,
      base_url: settings.stt_base_url ?? "",
    });
  }, [settings, isFetched, loaded]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ai-settings", orgId] });
  const save = async () => {
    if (form.provider === "custom" && !/^https?:\/\//.test(form.base_url)) return toast.error("Isi Base URL layanan transkripsi");
    setBusy(true);
    const { error } = await supabase.from("ai_settings").upsert(
      {
        organization_id: orgId,
        vision_enabled: form.vision,
        stt_provider: form.provider === "off" ? null : form.provider,
        stt_model: form.model.trim() || STT[form.provider]?.model || "whisper-1",
        stt_base_url: form.provider === "custom" ? form.base_url.trim() : null,
      },
      { onConflict: "organization_id" },
    );
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Pengaturan suara & gambar disimpan");
    refresh();
  };
  const keyAction = async (clear: boolean) => {
    setBusy(true);
    try {
      await callFunction("ai-admin", clear ? { action: "clear_key", kind: "stt" } : { action: "set_key", kind: "stt", api_key: key.trim() });
      toast.success(clear ? "Key transkripsi dihapus" : "Key transkripsi disimpan");
      setKey("");
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const deepseek = settings?.provider === "deepseek";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pesan suara & gambar</CardTitle>
        <CardDescription>AI ikut memahami voice note (diubah jadi teks) dan foto yang dikirim pelanggan.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset disabled={!isAdmin} className="space-y-5">
          <label className="flex max-w-3xl items-start gap-3 text-sm">
            <Switch checked={form.vision} onCheckedChange={(v) => setForm({ ...form, vision: v })} aria-label="AI membaca gambar" />
            <span>
              <span className="font-medium">AI membaca gambar dari pelanggan</span>
              <span className="block text-muted-foreground">
                Foto produk, tangkapan layar, atau bukti transfer (bukti transfer selalu diserahkan ke tim untuk dicek). Didukung Claude,
                ChatGPT, dan Gemini.
                {deepseek && " Model DeepSeek tidak bisa melihat gambar, jadi gambar tetap dibaca sebagai [gambar]."}
              </span>
            </span>
          </label>

          <div className="max-w-3xl space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Transkripsi pesan suara</Label>
                <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v, model: STT[v]?.model ?? form.model })}>
                  <SelectTrigger aria-label="Layanan transkripsi">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Mati</SelectItem>
                    {Object.entries(STT).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.provider !== "off" && (
                <div className="space-y-1">
                  <Label htmlFor="stt-model">Model</Label>
                  <Input id="stt-model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                </div>
              )}
              {form.provider === "custom" && (
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="stt-base">Base URL</Label>
                  <Input id="stt-base" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.contoh.com/v1" />
                </div>
              )}
            </div>
            {form.provider !== "off" && (
              <div className="space-y-1">
                <Label htmlFor="stt-key" className="flex items-center gap-2">
                  API key transkripsi
                  {settings?.stt_key_hint && (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Tersimpan {settings.stt_key_hint}
                    </Badge>
                  )}
                </Label>
                <div className="flex gap-2">
                  <Input id="stt-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={settings?.stt_key_hint ? "Isi untuk mengganti" : ""} />
                  <Button type="button" variant="outline" onClick={() => keyAction(false)} disabled={busy || key.trim().length < 8}>
                    <KeyRound className="mr-1 h-4 w-4" /> Simpan key
                  </Button>
                  {settings?.stt_key_hint && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => keyAction(true)} disabled={busy} aria-label="Hapus key transkripsi">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{STT[form.provider]?.hint}</p>
              </div>
            )}
          </div>
        </fieldset>
        {isAdmin && (
          <Button onClick={save} disabled={busy}>
            Simpan
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
