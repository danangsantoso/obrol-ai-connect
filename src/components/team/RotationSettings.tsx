import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { toast } from "sonner";
import { useOrgRouting } from "./orgRouting";

// Automatic rotation of new chats and the supervisor's follow-up alert.
// Admins change it; supervisors see the current rules.
export function RotationSettings({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data, isFetched } = useOrgRouting(orgId);
  const [form, setForm] = useState({ minutes: "3", days: "7" });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  if (isFetched && data && !loaded) {
    setLoaded(true);
    setForm({ minutes: String(data.rotate_timeout_minutes), days: String(data.followup_alert_days) });
  }

  const save = async (values: { auto_rotate?: boolean; rotate_timeout_minutes?: number; followup_alert_days?: number }) => {
    setSaving(true);
    const { error } = await supabase.from("organizations").update(values).eq("id", orgId);
    setSaving(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success("Pengaturan pembagian chat disimpan");
    queryClient.invalidateQueries({ queryKey: ["org-routing", orgId] });
  };

  const saveNumbers = (e: React.FormEvent) => {
    e.preventDefault();
    const minutes = Math.min(120, Math.max(1, Number(form.minutes) || 3));
    const days = Math.min(90, Math.max(1, Number(form.days) || 7));
    setForm({ minutes: String(minutes), days: String(days) });
    save({ rotate_timeout_minutes: minutes, followup_alert_days: days });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-primary" /> Pembagian chat otomatis
        </CardTitle>
        <CardDescription>
          Saat aktif, chat baru dibagi bergiliran ke agen (yang online lebih dulu). Jika agen belum membalas dalam batas
          waktu, chat muncul di antrean agen lain dan bisa diambil alih. Chat yang sudah diambil hanya terlihat oleh agen
          yang memegangnya.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch
            checked={!!data?.auto_rotate}
            disabled={!canEdit || saving || !data}
            onCheckedChange={(v) => save({ auto_rotate: v })}
            aria-label="Rotasi chat otomatis"
          />
          Rotasi chat otomatis {data?.auto_rotate ? "aktif" : "nonaktif"}
        </label>
        <form onSubmit={saveNumbers} className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="rotate-minutes">Boleh diambil agen lain setelah (menit)</Label>
            <Input
              id="rotate-minutes"
              type="number"
              min={1}
              max={120}
              className="w-40"
              value={form.minutes}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, minutes: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="followup-days" className="flex items-center gap-1">
              <BellRing className="h-3.5 w-3.5" /> Ingatkan supervisor jika chat tidak di-follow up (hari)
            </Label>
            <Input
              id="followup-days"
              type="number"
              min={1}
              max={90}
              className="w-40"
              value={form.days}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, days: e.target.value })}
            />
          </div>
          {canEdit && (
            <Button type="submit" variant="outline" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
