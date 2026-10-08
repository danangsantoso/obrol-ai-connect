import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { toast } from "sonner";

const DAYS = [
  ["1", "Senin"],
  ["2", "Selasa"],
  ["3", "Rabu"],
  ["4", "Kamis"],
  ["5", "Jumat"],
  ["6", "Sabtu"],
  ["7", "Minggu"],
] as const;

type Day = { open: boolean; from: string; to: string };
const DEFAULT_DAYS: Record<string, Day> = Object.fromEntries(
  DAYS.map(([k]) => [k, { open: Number(k) <= 5 || k === "6", from: "08:00", to: k === "6" ? "14:00" : "17:00" }]),
);

// Business hours (away message, AI answers right away, no rotation when closed)
// and the satisfaction survey sent when a chat is resolved.
export function ServiceSettingsCard({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data: org, isFetched } = useQuery({
    queryKey: ["org-service", orgId],
    queryFn: async () =>
      (await supabase.from("organizations").select("timezone, business_hours, outside_hours_message, csat_enabled, csat_message, csat_thanks").eq("id", orgId).single()).data,
  });
  const [hoursOn, setHoursOn] = useState(false);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [away, setAway] = useState("");
  const [csat, setCsat] = useState({ enabled: false, message: "", thanks: "" });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isFetched || !org || loaded) return;
    setLoaded(true);
    const bh = (org.business_hours ?? {}) as { enabled?: boolean; days?: Record<string, [string, string] | null> };
    setHoursOn(!!bh.enabled);
    if (bh.days) {
      setDays(Object.fromEntries(DAYS.map(([k]) => {
        const d = bh.days?.[k];
        return [k, d ? { open: true, from: d[0], to: d[1] } : { ...DEFAULT_DAYS[k], open: false }];
      })));
    }
    setAway(org.outside_hours_message);
    setCsat({ enabled: org.csat_enabled, message: org.csat_message, thanks: org.csat_thanks });
  }, [org, isFetched, loaded]);

  const save = async () => {
    if (Object.values(days).some((d) => d.open && d.from >= d.to)) return toast.error("Jam buka harus sebelum jam tutup");
    setSaving(true);
    const { error } = await supabase
      .from("organizations")
      .update({
        business_hours: { enabled: hoursOn, days: Object.fromEntries(DAYS.map(([k]) => [k, days[k].open ? [days[k].from, days[k].to] : null])) },
        outside_hours_message: away.trim(),
        csat_enabled: csat.enabled,
        csat_message: csat.message.trim() || "Bagaimana pelayanan kami? Balas angka 1-5 ⭐",
        csat_thanks: csat.thanks.trim(),
      })
      .eq("id", orgId);
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Pengaturan layanan disimpan");
    queryClient.invalidateQueries({ queryKey: ["org-service", orgId] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jam operasional & survei kepuasan</CardTitle>
        <CardDescription>Zona waktu: {org?.timezone ?? "Asia/Jakarta"}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset disabled={!isAdmin} className="space-y-6">
          <section className="max-w-3xl space-y-3">
            <label className="flex items-start gap-3 text-sm">
              <Switch checked={hoursOn} onCheckedChange={setHoursOn} aria-label="Pakai jam operasional" />
              <span>
                <span className="font-medium">Pakai jam operasional</span>
                <span className="block text-muted-foreground">
                  Di luar jam ini: AI langsung menjawab tanpa menunggu agen, chat tidak dirotasi ke agen, dan nomor tanpa AI mengirim
                  pesan "sedang tutup" (maksimal sekali per 12 jam per chat).
                </span>
              </span>
            </label>
            {hoursOn && (
              <div className="space-y-2">
                {DAYS.map(([k, label]) => (
                  <div key={k} className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex w-28 items-center gap-2">
                      <Switch checked={days[k].open} onCheckedChange={(v) => setDays({ ...days, [k]: { ...days[k], open: v } })} aria-label={`Buka ${label}`} />
                      {label}
                    </label>
                    {days[k].open ? (
                      <>
                        <Input type="time" className="h-8 w-28" value={days[k].from} onChange={(e) => setDays({ ...days, [k]: { ...days[k], from: e.target.value } })} aria-label={`Jam buka ${label}`} />
                        <span>–</span>
                        <Input type="time" className="h-8 w-28" value={days[k].to} onChange={(e) => setDays({ ...days, [k]: { ...days[k], to: e.target.value } })} aria-label={`Jam tutup ${label}`} />
                      </>
                    ) : (
                      <span className="text-muted-foreground">Tutup</span>
                    )}
                  </div>
                ))}
                <div className="space-y-1 pt-2">
                  <Label htmlFor="away-msg">Pesan di luar jam operasional</Label>
                  <Textarea id="away-msg" rows={2} maxLength={1000} value={away} onChange={(e) => setAway(e.target.value)} />
                </div>
              </div>
            )}
          </section>

          <section className="max-w-3xl space-y-3">
            <label className="flex items-start gap-3 text-sm">
              <Switch checked={csat.enabled} onCheckedChange={(v) => setCsat({ ...csat, enabled: v })} aria-label="Survei kepuasan" />
              <span>
                <span className="font-medium">Kirim survei kepuasan saat chat diselesaikan</span>
                <span className="block text-muted-foreground">
                  Pelanggan diminta memberi nilai 1–5. Jawabannya tercatat per agen (lihat Laporan) dan tidak membuka chat lagi.
                </span>
              </span>
            </label>
            {csat.enabled && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="csat-msg">Pertanyaan survei</Label>
                  <Textarea id="csat-msg" rows={3} maxLength={1000} value={csat.message} onChange={(e) => setCsat({ ...csat, message: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="csat-thanks">Ucapan setelah dinilai (kosongkan bila tidak perlu)</Label>
                  <Textarea id="csat-thanks" rows={3} maxLength={500} value={csat.thanks} onChange={(e) => setCsat({ ...csat, thanks: e.target.value })} />
                </div>
              </div>
            )}
          </section>
        </fieldset>
        {isAdmin && (
          <Button onClick={save} disabled={saving}>
            Simpan pengaturan layanan
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
