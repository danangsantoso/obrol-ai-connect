import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export function usePlanUsage(orgId: string) {
  return useQuery({
    queryKey: ["plan-usage", orgId],
    queryFn: async () => (await supabase.rpc("org_plan_usage")).data?.[0] ?? null,
    refetchInterval: 5 * 60_000,
  });
}

const share = (used: number, max: number | null) => (max ? Math.min(100, (used / max) * 100) : 0);

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = share(used, max);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className={cn("tabular-nums", pct >= 90 && "font-medium text-danger")}>
          {used.toLocaleString("id-ID")} / {max === null ? "tanpa batas" : max.toLocaleString("id-ID")}
        </span>
      </div>
      {max !== null && <Progress value={pct} className={cn("h-2", pct >= 90 && "[&>div]:bg-danger")} />}
    </div>
  );
}

// The tenant's plan and this month's usage (Settings).
export function PlanUsageCard({ orgId }: { orgId: string }) {
  const { data: u } = usePlanUsage(orgId);
  if (!u?.plan_name) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Paket & pemakaian</CardTitle>
        <CardDescription>
          Paket <span className="font-medium text-foreground">{u.plan_name}</span>
          {u.expires_at && (
            <span className={cn(u.expired && "font-medium text-danger")}>
              {" "}· {u.expired ? "berakhir" : "berlaku sampai"} {new Date(u.expires_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
            </span>
          )}
          . Untuk menaikkan paket atau memperpanjang, hubungi pengelola platform.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-3xl gap-4 md:grid-cols-2">
        <Meter label="Pengguna" used={Number(u.users)} max={u.max_users} />
        <Meter label="Kanal" used={Number(u.channels)} max={u.max_channels} />
        <Meter label="Balasan AI bulan ini" used={u.ai_replies} max={u.ai_replies_per_month} />
        <Meter label="Pesan broadcast bulan ini" used={u.broadcast_messages} max={u.broadcast_per_month} />
      </CardContent>
    </Card>
  );
}

// A strip above every page for admins when the plan ends soon or a quota is nearly used.
export function PlanBanner() {
  const { profile } = useAuth();
  const { data: u } = usePlanUsage(profile?.organization_id ?? "");
  if (!u?.plan_name || profile?.role !== "admin") return null;
  const daysLeft = u.expires_at ? Math.ceil((new Date(u.expires_at).getTime() - Date.now()) / 86_400_000) : null;
  const aiFull = u.ai_replies_per_month !== null && u.ai_replies >= u.ai_replies_per_month;
  const aiNear = share(u.ai_replies, u.ai_replies_per_month) >= 90;
  let text: string | null = null;
  if (u.expired) text = `Paket ${u.plan_name} sudah berakhir: AI dan broadcast berhenti. Hubungi pengelola platform untuk memperpanjang.`;
  else if (aiFull) text = "Kuota balasan AI bulan ini habis: chat baru diserahkan ke tim. Naikkan paket untuk menambah kuota.";
  else if (daysLeft !== null && daysLeft <= 7) text = `Paket ${u.plan_name} berakhir dalam ${daysLeft} hari.`;
  else if (aiNear) text = `Kuota balasan AI bulan ini hampir habis (${u.ai_replies}/${u.ai_replies_per_month}).`;
  if (!text) return null;
  return (
    <div className={cn("flex items-center gap-2 px-4 py-2 text-sm", u.expired || aiFull ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning")} role="status">
      <AlertTriangle className="h-4 w-4 shrink-0" /> {text}
    </div>
  );
}
