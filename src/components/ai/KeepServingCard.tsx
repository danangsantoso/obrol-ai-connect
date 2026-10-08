import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { toast } from "sonner";
import { useAiSettings } from "./aiSettings";

// Whether the AI keeps a chat until a person takes it, and its own follow-ups.
export function KeepServingCard({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data: settings, isFetched } = useAiSettings(orgId);
  const [form, setForm] = useState({ keep: true, followup: true, after: 3, max: 3 });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isFetched || loaded) return;
    setLoaded(true);
    if (!settings) return;
    setForm({
      keep: settings.keep_serving,
      followup: settings.ai_followup,
      after: settings.ai_followup_after_hours,
      max: settings.ai_followup_max,
    });
  }, [settings, isFetched, loaded]);

  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("ai_settings").upsert(
      {
        organization_id: orgId,
        keep_serving: form.keep,
        ai_followup: form.followup,
        ai_followup_after_hours: form.after,
        ai_followup_max: form.max,
      },
      { onConflict: "organization_id" },
    );
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Pengaturan layanan AI disimpan");
    queryClient.invalidateQueries({ queryKey: ["ai-settings", orgId] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI tetap melayani & follow-up</CardTitle>
        <CardDescription>AI terus berdialog dengan pelanggan sampai ada agen yang mengambil alih atau memindahkan chat.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset disabled={!isAdmin} className="max-w-3xl space-y-5">
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={form.keep} onCheckedChange={(v) => setForm({ ...form, keep: v })} aria-label="AI tetap melayani" />
            <span>
              <span className="font-medium">AI tetap melayani sampai chat diambil agen</span>
              <span className="block text-muted-foreground">
                AI tidak menyerahkan chat sendiri. Jika ada yang perlu dicek tim (komplain, bukti transfer, info yang belum ada), AI
                memberi tahu pelanggan bahwa tim akan mengecek, meninggalkan catatan internal untuk tim, lalu tetap melanjutkan
                percakapan. Chat tetap diserahkan bila pelanggan menulis kalimat serah ke tim, kuota AI habis, atau AI error. Matikan
                untuk cara lama (AI menyerahkan chat saat perlu).
              </span>
            </span>
          </label>
          <div className="space-y-3">
            <label className="flex items-start gap-3 text-sm">
              <Switch checked={form.followup} onCheckedChange={(v) => setForm({ ...form, followup: v })} aria-label="AI follow-up" />
              <span>
                <span className="font-medium">AI mem-follow-up pelanggan yang diam</span>
                <span className="block text-muted-foreground">
                  Kalau AI yang terakhir membalas dan pelanggan tidak membalas lagi, AI mengirim pesan follow-up yang disesuaikan dengan
                  isi chat. Dikirim jam 08.00–20.00, paling sering sekali sehari, dan berhenti begitu pelanggan membalas atau agen
                  mengambil chat. Nomor WhatsApp API, Messenger, dan Instagram hanya di dalam 24 jam sejak pesan terakhir pelanggan.
                </span>
              </span>
            </label>
            {form.followup && (
              <div className="grid gap-3 pl-12 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="fu-after-ai">Follow-up pertama setelah diam (jam)</Label>
                  <Input id="fu-after-ai" type="number" min={1} max={72} value={form.after} onChange={(e) => setForm({ ...form, after: Math.min(72, Math.max(1, Number(e.target.value) || 1)) })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fu-max-ai">Maksimal follow-up</Label>
                  <Input id="fu-max-ai" type="number" min={1} max={10} value={form.max} onChange={(e) => setForm({ ...form, max: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} />
                </div>
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
