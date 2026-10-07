import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { MessageSquare, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { displayName, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { STATUS_INFO, formatWhen, useSequences } from "./followup";

const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 12, tickLine: false, axisLine: false } as const;
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "-");

interface StatRow {
  sequence_id: string;
  agent_id: string | null;
  enrolled: number;
  active: number;
  replied: number;
  completed: number;
  stopped: number;
  failed: number;
  messages_sent: number;
  replied_by_step: Record<string, number>;
}

interface EnrollmentRow {
  id: string;
  sequence_id: string;
  conversation_id: string;
  agent_id: string | null;
  status: string;
  steps_total: number;
  current_step: number;
  next_send_at: string | null;
  replied_after_step: number | null;
  stop_reason: string | null;
  started_at: string;
  conversations: { contacts: { name: string | null; profile_name: string | null; wa_id: string } } | null;
}

function Progress({ current, total, status }: { current: number; total: number; status: string }) {
  return (
    <div className="flex items-center gap-1" aria-label={`Lapis ${current} dari ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-2 w-2 rounded-full",
            i < current ? (status === "replied" && i === current - 1 ? "bg-success" : "bg-primary") : "bg-muted-foreground/25",
          )}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">
        {current}/{total}
      </span>
    </div>
  );
}

export function FollowupTracking({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState("30");
  const [status, setStatus] = useState("all");
  const [sequenceFilter, setSequenceFilter] = useState("all");
  const { data: sequences = [] } = useSequences(orgId);
  const seqName = useMemo(() => new Map(sequences.map((s) => [s.id, s.name])), [sequences]);

  const { data: members = [] } = useQuery({
    queryKey: ["followup-members", orgId],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });
  const memberName = (id: string | null) => {
    if (!id) return "AI / belum ada agen";
    const m = members.find((x) => x.id === id);
    return m?.full_name || m?.email || "Agen";
  };

  const { data: stats = [] } = useQuery({
    queryKey: ["followup-stats", orgId, days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("followup_stats", { p_days: Number(days) });
      if (error) throw error;
      return (data ?? []) as unknown as StatRow[];
    },
    refetchInterval: 60_000,
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["followup-enrollments", orgId, days, status, sequenceFilter],
    queryFn: async () => {
      let q = supabase
        .from("followup_enrollments")
        .select(
          "id, sequence_id, conversation_id, agent_id, status, steps_total, current_step, next_send_at, replied_after_step, stop_reason, started_at, conversations(contacts(name, profile_name, wa_id))",
        )
        .gte("started_at", new Date(Date.now() - Number(days) * 86_400_000).toISOString())
        .order("started_at", { ascending: false })
        .limit(200);
      if (status !== "all") q = q.eq("status", status);
      if (sequenceFilter !== "all") q = q.eq("sequence_id", sequenceFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as EnrollmentRow[];
    },
    refetchInterval: 30_000,
  });

  const visible = sequenceFilter === "all" ? stats : stats.filter((s) => s.sequence_id === sequenceFilter);
  const total = visible.reduce(
    (acc, s) => ({
      enrolled: acc.enrolled + s.enrolled,
      active: acc.active + s.active,
      replied: acc.replied + s.replied,
      completed: acc.completed + s.completed,
      ended: acc.ended + s.stopped + s.failed,
      sent: acc.sent + s.messages_sent,
    }),
    { enrolled: 0, active: 0, replied: 0, completed: 0, ended: 0, sent: 0 },
  );

  const maxSteps = Math.max(1, ...sequences.map((s) => s.followup_steps.length));
  const byStep = Array.from({ length: maxSteps + 1 }, (_, step) => ({
    label: step === 0 ? "Sebelum" : `Lapis ${step}`,
    value: visible.reduce((n, s) => n + (s.replied_by_step?.[String(step)] ?? 0), 0),
  }));
  const chartConfig = { value: { label: "Membalas", color: "var(--viz-2)" } } satisfies ChartConfig;

  // One row per sequence and agent.
  const perAgent = [...visible].sort((a, b) => b.enrolled - a.enrolled);

  const stop = async (id: string) => {
    const { error } = await supabase.rpc("followup_stop", { p_enrollment_id: id });
    if (error) return toast.error(errorMessage(error));
    toast.success("Follow-up dihentikan");
    queryClient.invalidateQueries({ queryKey: ["followup-enrollments", orgId] });
    queryClient.invalidateQueries({ queryKey: ["followup-stats", orgId] });
  };

  const cards = [
    { label: "Sedang di-follow-up", value: total.active, hint: `${total.enrolled} chat masuk urutan` },
    { label: "Membalas", value: total.replied, hint: `${pct(total.replied, total.enrolled)} dari chat yang di-follow-up` },
    { label: "Selesai tanpa balasan", value: total.completed, hint: "semua lapis terkirim" },
    { label: "Pesan follow-up terkirim", value: total.sent, hint: `${total.ended} dihentikan/gagal` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40" aria-label="Periode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 hari terakhir</SelectItem>
            <SelectItem value="30">30 hari terakhir</SelectItem>
            <SelectItem value="90">90 hari terakhir</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sequenceFilter} onValueChange={setSequenceFilter}>
          <SelectTrigger className="w-56" aria-label="Urutan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua urutan</SelectItem>
            {sequences.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{c.label}</p>
              <p className="text-2xl font-bold" data-testid={`fu-card-${c.label}`}>
                {c.value}
              </p>
              <p className="text-xs text-muted-foreground">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pelanggan membalas setelah lapis ke-</CardTitle>
            <CardDescription>Lapis mana yang paling sering membuat pelanggan membalas ("Sebelum" = membalas sebelum lapis 1 terkirim).</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-56 w-full">
              <BarChart data={byStep} margin={{ left: 0, right: 8, top: 16 }}>
                <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
                <XAxis dataKey="label" {...AXIS} interval={0} fontSize={11} />
                <YAxis {...AXIS} width={28} allowDecimals={false} />
                <ChartTooltip cursor={{ fill: "hsl(var(--muted))" }} content={<ChartTooltipContent hideIndicator />} />
                <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  <LabelList dataKey="value" position="top" className="fill-foreground" fontSize={12} fontWeight={600} />
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Per urutan & agen</CardTitle>
            <CardDescription>Berapa chat yang di-follow-up tiap agen dan berapa yang membalas.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Urutan</TableHead>
                  <TableHead>Agen</TableHead>
                  <TableHead className="text-right">Masuk</TableHead>
                  <TableHead className="text-right">Berjalan</TableHead>
                  <TableHead className="text-right">Membalas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perAgent.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      Belum ada follow-up di periode ini.
                    </TableCell>
                  </TableRow>
                )}
                {perAgent.map((s) => (
                  <TableRow key={`${s.sequence_id}-${s.agent_id}`}>
                    <TableCell>{seqName.get(s.sequence_id) ?? "-"}</TableCell>
                    <TableCell>{memberName(s.agent_id)}</TableCell>
                    <TableCell className="text-right">{s.enrolled}</TableCell>
                    <TableCell className="text-right">{s.active}</TableCell>
                    <TableCell className="text-right">
                      {s.replied} <span className="text-xs text-muted-foreground">({pct(s.replied, s.enrolled)})</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle>Daftar follow-up</CardTitle>
            <CardDescription>Posisi setiap pelanggan dalam urutannya.</CardDescription>
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              {Object.entries(STATUS_INFO).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pelanggan</TableHead>
                <TableHead>Urutan</TableHead>
                <TableHead>Lapis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Berikutnya</TableHead>
                <TableHead>Agen</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Tidak ada data.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => {
                const info = STATUS_INFO[r.status] ?? STATUS_INFO.active;
                return (
                  <TableRow key={r.id} data-testid="followup-row">
                    <TableCell className="font-medium">{r.conversations ? displayName(r.conversations.contacts) : "-"}</TableCell>
                    <TableCell>{seqName.get(r.sequence_id) ?? "-"}</TableCell>
                    <TableCell>
                      <Progress current={r.current_step} total={r.steps_total} status={r.status} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("border-0", info.className)} title={r.stop_reason ?? undefined}>
                        {r.status === "replied" ? `Membalas setelah lapis ${r.replied_after_step ?? 0}` : info.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{r.status === "active" ? formatWhen(r.next_send_at) : "-"}</TableCell>
                    <TableCell className="text-sm">{memberName(r.agent_id)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button asChild variant="ghost" size="icon" aria-label="Buka chat">
                        <Link to={`/inbox/${r.conversation_id}`}>
                          <MessageSquare className="h-4 w-4" />
                        </Link>
                      </Button>
                      {r.status === "active" && (
                        <Button variant="ghost" size="icon" onClick={() => stop(r.id)} aria-label="Hentikan follow-up">
                          <Square className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
