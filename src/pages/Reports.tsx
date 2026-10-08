import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/csv";
import { rupiah } from "@/components/orders/orders";
import { cn } from "@/lib/utils";

interface Row {
  actor: "agent" | "ai" | "phone";
  agent_id: string | null;
  replies: number;
  chats: number;
  median_response_seconds: number | null;
  avg_response_seconds: number | null;
  within_sla: number;
  resolved: number;
  median_resolution_minutes: number | null;
  csat_answered: number;
  csat_average: number | null;
  orders_paid: number;
  revenue: number;
}

interface Day {
  day: string;
  new_chats: number;
  replies: number;
  median_response_seconds: number | null;
  within_sla: number;
  resolved: number;
}

const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 12, tickLine: false, axisLine: false } as const;

function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "-";
  const s = Number(seconds);
  if (s < 60) return `${Math.round(s)} dtk`;
  if (s < 3600) return `${Math.round(s / 60)} mnt`;
  if (s < 86400) return `${(s / 3600).toFixed(1).replace(".", ",")} jam`;
  return `${(s / 86400).toFixed(1).replace(".", ",")} hari`;
}
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "-");

export default function Reports() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const [days, setDays] = useState("30");
  const [sla, setSla] = useState(5);
  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(days) * 86_400_000);
    return { p_from: from.toISOString(), p_to: new Date(to.getTime() + 60_000).toISOString(), p_sla_minutes: sla };
  }, [days, sla]);

  const { data: members = [] } = useQuery({
    queryKey: ["report-members", orgId],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });
  const { data: ai } = useQuery({
    queryKey: ["report-bot", orgId],
    queryFn: async () => (await supabase.from("ai_settings").select("bot_name").maybeSingle()).data,
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["performance", orgId, range],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("performance_report", range);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });
  const { data: daily = [] } = useQuery({
    queryKey: ["performance-daily", orgId, range],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("performance_daily", range);
      if (error) throw error;
      return (data ?? []) as unknown as Day[];
    },
  });

  const name = (r: Row) =>
    r.actor === "ai"
      ? `🤖 ${ai?.bot_name ?? "AI"}`
      : r.actor === "phone"
        ? "Dari HP (nomor QR)"
        : (() => {
            const m = members.find((x) => x.id === r.agent_id);
            return m?.full_name || m?.email || "Agen";
          })();

  const sorted = [...rows].sort((a, b) => Number(b.replies) - Number(a.replies));
  const sum = (k: keyof Row) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const allReplies = sum("replies");
  const human = rows.filter((r) => r.actor !== "ai");
  const aiRow = rows.find((r) => r.actor === "ai");
  const weightedMedian = (() => {
    // Days' medians weighted by replies, a close stand-in for the team median.
    const d = daily.filter((x) => x.median_response_seconds !== null && Number(x.replies) > 0);
    const w = d.reduce((n, x) => n + Number(x.replies), 0);
    return w ? d.reduce((n, x) => n + Number(x.median_response_seconds) * Number(x.replies), 0) / w : null;
  })();
  const csatN = sum("csat_answered");
  const csatAvg = csatN ? rows.reduce((n, r) => n + Number(r.csat_average ?? 0) * Number(r.csat_answered), 0) / csatN : null;

  const cards = [
    { label: "Waktu respons (median)", value: duration(weightedMedian), hint: `${pct(sum("within_sla"), allReplies)} dibalas ≤ ${sla} menit` },
    { label: "Balasan ke pelanggan", value: allReplies.toLocaleString("id-ID"), hint: `${pct(Number(aiRow?.replies ?? 0), allReplies)} oleh AI` },
    { label: "Chat diselesaikan", value: sum("resolved").toLocaleString("id-ID"), hint: `${human.reduce((n, r) => n + Number(r.resolved), 0)} oleh agen` },
    { label: "Kepuasan (CSAT)", value: csatAvg ? `${csatAvg.toFixed(2).replace(".", ",")} / 5` : "-", hint: `${csatN} penilaian` },
    { label: "Omzet dari chat", value: rupiah(sum("revenue")), hint: `${sum("orders_paid")} pesanan lunas` },
  ];

  const chartData = daily.map((d) => ({
    label: new Date(`${d.day}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
    chats: Number(d.new_chats),
    minutes: d.median_response_seconds === null ? null : Math.round((Number(d.median_response_seconds) / 60) * 10) / 10,
  }));
  const chartConfig = {
    chats: { label: "Chat baru", color: "var(--viz-1)" },
    minutes: { label: "Median respons (menit)", color: "var(--viz-3)" },
  } satisfies ChartConfig;

  const exportCsv = () => {
    downloadCsv(`laporan-performa-${days}hari-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Agen", "Balasan", "Chat dibalas", "Median respons (detik)", "Rata-rata respons (detik)", `Dibalas <= ${sla} menit`, "% SLA", "Diselesaikan", "Median penyelesaian (menit)", "Penilaian CSAT", "Rata-rata CSAT", "Pesanan lunas", "Omzet"],
      ...sorted.map((r) => [
        name(r).replace("🤖 ", ""), r.replies, r.chats, r.median_response_seconds, r.avg_response_seconds, r.within_sla,
        pct(Number(r.within_sla), Number(r.replies)), r.resolved, r.median_resolution_minutes, r.csat_answered, r.csat_average, r.orders_paid, r.revenue,
      ]),
      [],
      ["Tanggal", "Chat baru", "Balasan", "Median respons (detik)", `Dibalas <= ${sla} menit`, "Diselesaikan"],
      ...daily.map((d) => [d.day, d.new_chats, d.replies, d.median_response_seconds, d.within_sla, d.resolved]),
    ]);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Laporan performa</h1>
          <p className="text-muted-foreground">Kecepatan membalas, penyelesaian chat, kepuasan pelanggan, dan penjualan per agen dan AI.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Periode</Label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-40" aria-label="Periode laporan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">24 jam terakhir</SelectItem>
                <SelectItem value="7">7 hari terakhir</SelectItem>
                <SelectItem value="30">30 hari terakhir</SelectItem>
                <SelectItem value="90">90 hari terakhir</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sla">Target respons (menit)</Label>
            <Input id="sla" type="number" min={1} max={1440} className="w-28" value={sla} onChange={(e) => setSla(Math.min(1440, Math.max(1, Number(e.target.value) || 5)))} />
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download className="mr-1 h-4 w-4" /> Ekspor Excel (CSV)
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{c.label}</p>
              <p className="text-2xl font-bold" data-testid={`rp-${c.label}`}>
                {c.value}
              </p>
              <p className="text-xs text-muted-foreground">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tren harian</CardTitle>
          <CardDescription>Chat baru per hari dan median waktu respons (menit).</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <ComposedChart data={chartData} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
              <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
              <YAxis yAxisId="chats" {...AXIS} width={32} allowDecimals={false} />
              <YAxis yAxisId="minutes" orientation="right" {...AXIS} width={36} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar yAxisId="chats" dataKey="chats" fill="var(--color-chats)" radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Line yAxisId="minutes" dataKey="minutes" type="linear" stroke="var(--color-minutes)" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per agen</CardTitle>
          <CardDescription>
            Waktu respons dihitung dari pesan pelanggan pertama yang belum dibalas sampai balasan. Pesan otomatis (follow-up, broadcast,
            survei, info pesanan) tidak dihitung.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agen</TableHead>
                <TableHead className="text-right">Balasan</TableHead>
                <TableHead className="text-right">Median respons</TableHead>
                <TableHead className="text-right">≤ {sla} mnt</TableHead>
                <TableHead className="text-right">Diselesaikan</TableHead>
                <TableHead className="text-right">Lama selesai</TableHead>
                <TableHead className="text-right">CSAT</TableHead>
                <TableHead className="text-right">Pesanan lunas</TableHead>
                <TableHead className="text-right">Omzet</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    Belum ada data di periode ini.
                  </TableCell>
                </TableRow>
              )}
              {sorted.map((r) => {
                const slaShare = Number(r.replies) ? Number(r.within_sla) / Number(r.replies) : null;
                return (
                  <TableRow key={`${r.actor}-${r.agent_id}`} data-testid="rp-row">
                    <TableCell className="font-medium">{name(r)}</TableCell>
                    <TableCell className="text-right">{Number(r.replies).toLocaleString("id-ID")}</TableCell>
                    <TableCell className="text-right">{duration(r.median_response_seconds)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        slaShare === null ? "" : slaShare >= 0.8 ? "text-success" : slaShare >= 0.5 ? "text-warning" : "text-destructive",
                      )}
                    >
                      {pct(Number(r.within_sla), Number(r.replies))}
                    </TableCell>
                    <TableCell className="text-right">{Number(r.resolved)}</TableCell>
                    <TableCell className="text-right">{r.median_resolution_minutes === null ? "-" : duration(Number(r.median_resolution_minutes) * 60)}</TableCell>
                    <TableCell className="text-right">
                      {r.csat_average === null ? "-" : `${Number(r.csat_average).toFixed(1).replace(".", ",")} (${r.csat_answered})`}
                    </TableCell>
                    <TableCell className="text-right">{Number(r.orders_paid)}</TableCell>
                    <TableCell className="text-right">{rupiah(r.revenue)}</TableCell>
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
