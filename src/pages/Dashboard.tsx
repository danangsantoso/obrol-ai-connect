import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import { CheckCircle2, Clock, Inbox as InboxIcon, MessageSquare } from "lucide-react";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS } from "@/lib/api";
import { useMembers } from "@/components/inbox/useInboxData";
import { memberName } from "@/components/inbox/types";

function formatMinutes(ms: number | null) {
  if (ms === null) return "–";
  const minutes = ms / 60_000;
  if (minutes < 1) return "< 1 menit";
  if (minutes < 60) return `${Math.round(minutes)} menit`;
  return `${(minutes / 60).toFixed(1)} jam`;
}

const STATUS_DOT = { online: "bg-success", away: "bg-warning", offline: "bg-muted-foreground" } as const;

export default function Dashboard() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const { data: members = [] } = useMembers(orgId);

  // Conversations visible to the user (RLS): admins see everything, agents their own + the queue.
  const { data: conversations = [] } = useQuery({
    queryKey: ["dashboard-conversations", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, status, assignee_id, opened_at, first_response_at, resolved_at, unread_count");
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });

  const stats = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    const active = conversations.filter((c) => c.status !== "resolved");
    const responded = conversations.filter(
      (c) => c.first_response_at && new Date(c.opened_at).getTime() >= today,
    );
    const frt = responded.length
      ? responded.reduce(
          (sum, c) => sum + (new Date(c.first_response_at!).getTime() - new Date(c.opened_at).getTime()),
          0,
        ) / responded.length
      : null;
    const perAgent = new Map<string, number>();
    for (const c of active) {
      if (c.assignee_id) perAgent.set(c.assignee_id, (perAgent.get(c.assignee_id) ?? 0) + 1);
    }
    return {
      queue: active.filter((c) => !c.assignee_id).length,
      open: active.length,
      resolvedToday: conversations.filter((c) => c.resolved_at && new Date(c.resolved_at).getTime() >= today).length,
      frt,
      perAgent,
    };
  }, [conversations]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Halo, {profile?.full_name || "tim CS"}</h1>
        <p className="text-muted-foreground">Ringkasan layanan WhatsApp hari ini.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Link to="/inbox">
          <StatsCard title="Antrean belum di-assign" value={stats.queue} icon={InboxIcon} />
        </Link>
        <StatsCard title="Chat terbuka" value={stats.open} icon={MessageSquare} />
        <StatsCard title="Selesai hari ini" value={stats.resolvedToday} icon={CheckCircle2} />
        <StatsCard title="Rata-rata respons pertama (hari ini)" value={formatMinutes(stats.frt)} icon={Clock} />
      </div>

      {profile?.role !== "agent" && (
        <Card>
          <CardHeader>
            <CardTitle>Beban kerja agen</CardTitle>
            <CardDescription>Jumlah chat terbuka yang sedang ditangani setiap agen.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agen</TableHead>
                  <TableHead>Peran</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Chat terbuka</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members
                  .filter((m) => m.is_active)
                  .map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{memberName(m)}</TableCell>
                      <TableCell>{ROLE_LABELS[m.role]}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2 capitalize">
                          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[m.status]}`} />
                          {m.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{stats.perAgent.get(m.id) ?? 0}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
