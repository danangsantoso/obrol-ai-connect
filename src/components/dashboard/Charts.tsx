import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

// Fixed categorical order (see --viz-* tokens in index.css). Identity colors
// follow the entity, never its rank.
const VIZ = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)"];
const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 12, tickLine: false, axisLine: false } as const;

export interface DailyPoint {
  day: string;
  inbound: number;
  outbound: number;
}

const dailyConfig = {
  inbound: { label: "Pesan masuk", color: VIZ[0] },
  outbound: { label: "Pesan dibalas", color: VIZ[1] },
} satisfies ChartConfig;

export function DailyMessagesChart({ data }: { data: DailyPoint[] }) {
  const rows = data.map((d) => ({ ...d, label: format(new Date(`${d.day}T00:00:00`), "d MMM", { locale: localeId }) }));
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>Aktivitas chat 14 hari terakhir</CardTitle>
        <CardDescription>Pesan dari pelanggan dibanding balasan tim (agen dan AI) per hari.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={dailyConfig} className="h-64 w-full">
          <AreaChart data={rows} margin={{ left: 0, right: 12, top: 8 }}>
            <defs>
              {(["inbound", "outbound"] as const).map((k) => (
                <linearGradient key={k} id={`fill-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={`var(--color-${k})`} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={`var(--color-${k})`} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...AXIS} width={32} allowDecimals={false} />
            <ChartTooltip cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Area dataKey="inbound" type="monotone" stroke="var(--color-inbound)" strokeWidth={2} fill="url(#fill-inbound)" activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }} />
            <Area dataKey="outbound" type="monotone" stroke="var(--color-outbound)" strokeWidth={2} fill="url(#fill-outbound)" activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export interface Slice {
  key: string;
  label: string;
  value: number;
}

// Part-to-whole for a handful of categories, with the values in the legend.
export function DonutChart({ title, description, data }: { title: string; description: string; data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const config = Object.fromEntries(data.map((d, i) => [d.key, { label: d.label, color: VIZ[i % VIZ.length] }])) satisfies ChartConfig;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 sm:flex-row">
        <ChartContainer config={config} className="aspect-square h-44 shrink-0">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
            <Pie data={total ? data : [{ key: "empty", label: "", value: 1 }]} dataKey="value" nameKey="key" innerRadius="62%" outerRadius="95%" paddingAngle={total ? 2 : 0} stroke="hsl(var(--card))" strokeWidth={2}>
              {(total ? data : [{ key: "empty" }]).map((d, i) => (
                <Cell key={d.key} fill={total ? VIZ[i % VIZ.length] : "var(--viz-grid)"} />
              ))}
            </Pie>
            <text x="50%" y="47%" textAnchor="middle" className="fill-foreground text-2xl font-bold">{total}</text>
            <text x="50%" y="60%" textAnchor="middle" className="fill-muted-foreground text-xs">chat</text>
          </PieChart>
        </ChartContainer>
        <ul className="w-full space-y-2 text-sm">
          {data.map((d, i) => (
            <li key={d.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: VIZ[i % VIZ.length] }} />
                {d.label}
              </span>
              <span className="font-semibold tabular-nums">
                {d.value}
                <span className="ml-1 font-normal text-muted-foreground">{total ? `(${Math.round((d.value / total) * 100)}%)` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  colorIndex?: number;
}

// Horizontal bars with the value written at the end of each bar.
export function HorizontalBars({ title, description, data, unit }: { title: string; description: string; data: BarDatum[]; unit: string }) {
  const config = { value: { label: unit, color: VIZ[0] } } satisfies ChartConfig;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Belum ada data.</p>
        ) : (
          <ChartContainer config={config} className="w-full" style={{ height: Math.max(120, data.length * 40 + 16) }}>
            <BarChart data={data} layout="vertical" margin={{ left: 0, right: 36 }} barCategoryGap={8}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="label" {...AXIS} width={110} />
              <ChartTooltip cursor={{ fill: "hsl(var(--muted))" }} content={<ChartTooltipContent hideIndicator />} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
                {data.map((d, i) => (
                  <Cell key={d.key} fill={VIZ[(d.colorIndex ?? i) % VIZ.length]} />
                ))}
                <LabelList dataKey="value" position="right" className="fill-foreground" fontSize={12} fontWeight={600} />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
