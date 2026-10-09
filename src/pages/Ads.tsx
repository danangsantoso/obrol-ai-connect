import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { AlertTriangle, CheckCircle2, Download, Link2, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { PERIODS, percent, periodRange, ratio, rpShort, useAdSettings } from "@/components/ads/shared";

type Level = "campaign" | "adset" | "ad";
const LEVELS: { value: Level; label: string; noun: string }[] = [
  { value: "campaign", label: "Kampanye", noun: "kampanye" },
  { value: "adset", label: "Set iklan", noun: "set iklan" },
  { value: "ad", label: "Iklan", noun: "iklan" },
];

interface Summary {
  spend: number;
  ad_clicks: number;
  leads: number;
  leads_ctwa: number;
  leads_link: number;
  replied: number;
  orders: number;
  closings: number;
  revenue: number;
  organic: number;
  link_clicks: number;
  events_sent: number;
  events_failed: number;
  daily: { date: string; spend: number; revenue: number; leads: number }[];
}

interface ReportRow {
  key: string;
  name: string;
  parent: string | null;
  path: string | null;
  spend: number;
  leads: number;
  closings: number;
  revenue: number;
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "blue" | "green" }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-4",
        tone === "blue" ? "border-primary/30 bg-primary/5" : tone === "green" ? "border-success/30 bg-success/5" : "bg-card",
      )}
    >
      <span className={cn("text-sm", tone ? "font-semibold" : "text-muted-foreground")}>{label}</span>
      <span className="text-2xl font-extrabold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

export default function Ads() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const isAdmin = profile!.role === "admin";
  const [period, setPeriod] = useState("7");
  const [level, setLevel] = useState<Level>("campaign");
  const range = useMemo(() => periodRange(period), [period]);
  const { data: settings } = useAdSettings(orgId);

  const summary = useQuery({
    queryKey: ["ads-summary", orgId, range],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ads_summary", range);
      if (error) throw error;
      return data as unknown as Summary;
    },
  });
  const report = useQuery({
    queryKey: ["ads-report", orgId, range, level],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ads_report", { ...range, p_level: level });
      if (error) throw error;
      return (data ?? []) as unknown as ReportRow[];
    },
  });

  const s = summary.data;
  const spend = Number(s?.spend ?? 0);
  const revenue = Number(s?.revenue ?? 0);
  const leads = s?.leads ?? 0;
  const closings = s?.closings ?? 0;
  const connected = Boolean(settings?.pixel_id && settings?.capi_token_hint);
  const noun = LEVELS.find((l) => l.value === level)!.noun;
  const rows = report.data ?? [];

  const funnel = s
    ? [
        { label: "Klik iklan (dari Meta)", value: s.ad_clicks + s.link_clicks > 0 ? s.ad_clicks || s.link_clicks : null },
        { label: "Chat masuk dari iklan", value: leads },
        { label: "Dibalas tim / AI", value: s.replied },
        { label: "Pesanan dibuat", value: s.orders },
        { label: "Closing", value: closings },
      ]
    : [];
  const funnelTop = Math.max(...funnel.map((f) => f.value ?? 0), 1);
  const totalChats = leads + (s?.organic ?? 0);
  const dailyMax = Math.max(...(s?.daily ?? []).map((d) => Math.max(Number(d.spend), Number(d.revenue))), 1);

  const exportCsv = () =>
    downloadCsv(`iklan-${noun.replace(" ", "-")}-${range.p_from}-${range.p_to}.csv`, [
      ["Nama", "Induk", "Jalur", "Biaya", "Lead", "CPL", "Closing", "Konversi", "Omzet", "ROAS"],
      ...rows.map((r) => [
        r.name,
        r.parent ?? "",
        r.path === "link" ? "Landing page" : r.path === "ctwa" ? "WhatsApp" : "",
        Math.round(Number(r.spend)),
        Number(r.leads),
        Number(r.leads) ? Math.round(Number(r.spend) / Number(r.leads)) : "",
        Number(r.closings),
        percent(Number(r.closings), Number(r.leads)),
        Math.round(Number(r.revenue)),
        ratio(Number(r.revenue), Number(r.spend)),
      ]),
    ]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Iklan</h1>
          <p className="text-muted-foreground">Biaya iklan Meta, chat yang masuk dari iklan, dan closing-nya. CPL dan ROAS dihitung otomatis.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-44" aria-label="Periode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" asChild>
            <Link to="/ads/links">
              <Link2 className="mr-1 h-4 w-4" /> Link landing page
            </Link>
          </Button>
          {isAdmin && (
            <Button variant="outline" asChild>
              <Link to="/ads/settings">
                <Settings2 className="mr-1 h-4 w-4" /> Pengaturan Meta
              </Link>
            </Button>
          )}
        </div>
      </div>

      {settings !== undefined &&
        (connected ? (
          <div className={cn("flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm", settings?.last_event_error ? "border-warning/40 bg-warning/10" : "border-success/30 bg-success/10")}>
            {settings?.last_event_error ? <AlertTriangle className="h-4 w-4 text-warning" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
            <span className="flex-1">
              <b>Terhubung ke Meta.</b> {s?.events_sent ?? 0} event terkirim periode ini
              {s?.events_failed ? `, ${s.events_failed} gagal` : ""}.
              {settings?.last_event_error && <> Error terakhir: {settings.last_event_error}</>}
              {settings?.last_spend_error && <> · Biaya iklan: {settings.last_spend_error}</>}
            </span>
            {isAdmin && (
              <Link to="/ads/settings" className="font-semibold underline underline-offset-2">
                Pengaturan Meta
              </Link>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <span className="flex-1">
              <b>Belum terhubung ke Meta.</b> Chat dari iklan tetap tercatat di sini. Hubungkan Pixel agar Lead dan Purchase terkirim ke Ads
              Manager, dan akun iklan agar biaya iklan terisi otomatis.
            </span>
            {isAdmin && (
              <Button size="sm" asChild>
                <Link to="/ads/settings">Hubungkan</Link>
              </Button>
            )}
          </div>
        ))}

      {summary.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
          <Tile label="Biaya iklan" value={rpShort(spend)} hint={settings?.ad_account_id ? "dari Meta Ads" : "diisi manual"} />
          <Tile label="Lead (chat dari iklan)" value={leads.toLocaleString("id-ID")} hint={`${s?.leads_ctwa ?? 0} langsung WA · ${s?.leads_link ?? 0} landing page`} />
          <Tile label="CPL" value={leads && spend ? rpShort(spend / leads) : "–"} hint="biaya ÷ lead" tone="blue" />
          <Tile label="Closing" value={closings.toLocaleString("id-ID")} hint={`${percent(closings, leads)} dari lead${closings && spend ? ` · ${rpShort(spend / closings)} per closing` : ""}`} />
          <Tile label="Omzet dari iklan" value={rpShort(revenue)} hint="pesanan lunas + closing manual" />
          <Tile label="ROAS" value={spend ? `${ratio(revenue, spend)}×` : "–"} hint="omzet ÷ biaya" tone="green" />
        </div>
      )}

      {s && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Dari klik sampai closing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {funnel.map((f, i) => (
                <div key={f.label} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{f.label}</span>
                    <span>
                      <b className="tabular-nums">{f.value === null ? "–" : f.value.toLocaleString("id-ID")}</b>
                      {i > 1 && f.value !== null && <span className="ml-1 text-muted-foreground">{percent(f.value, leads)}</span>}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", i === 4 ? "bg-success" : "bg-primary")} style={{ width: `${Math.max(((f.value ?? 0) / funnelTop) * 100, f.value ? 2 : 0)}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Asal chat baru</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex h-3.5 overflow-hidden rounded-full bg-muted">
                <div className="bg-primary" style={{ width: `${totalChats ? (s.leads_ctwa / totalChats) * 100 : 0}%` }} />
                <div className="bg-orange-500" style={{ width: `${totalChats ? (s.leads_link / totalChats) * 100 : 0}%` }} />
              </div>
              {[
                ["bg-primary", "Iklan langsung ke WhatsApp / Messenger", s.leads_ctwa],
                ["bg-orange-500", "Iklan → landing page → WhatsApp", s.leads_link],
                ["bg-muted-foreground/40", "Organik / tidak diketahui (tidak dihitung di CPL)", s.organic],
              ].map(([color, label, n]) => (
                <div key={label as string} className="flex items-center gap-2 text-sm">
                  <span className={cn("h-3 w-3 rounded-sm", color as string)} />
                  <span className="flex-1">{label}</span>
                  <b className="tabular-nums">{Number(n).toLocaleString("id-ID")}</b>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Biaya vs omzet per hari</CardTitle>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />
                  Biaya
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-success" />
                  Omzet
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex h-40 items-end gap-1 border-b" role="img" aria-label="Grafik biaya dan omzet per hari">
                {s.daily.map((d) => (
                  <div key={d.date} className="flex h-full flex-1 items-end justify-center gap-0.5" title={`${format(new Date(d.date), "d MMM", { locale: localeId })}: biaya ${rpShort(d.spend)}, omzet ${rpShort(d.revenue)}`}>
                    <div className="w-full max-w-3 rounded-t bg-slate-400" style={{ height: `${(Number(d.spend) / dailyMax) * 100}%` }} />
                    <div className="w-full max-w-3 rounded-t bg-success" style={{ height: `${(Number(d.revenue) / dailyMax) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>{format(new Date(range.p_from), "d MMM", { locale: localeId })}</span>
                <span>{format(new Date(range.p_to), "d MMM", { locale: localeId })}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Performa per {noun}</CardTitle>
            <CardDescription>Closing dihitung ke iklan yang pertama kali membawa pelanggan (jendela {settings?.attribution_days ?? 28} hari).</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div role="tablist" aria-label="Tingkat" className="flex gap-1 rounded-lg bg-muted p-1">
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  role="tab"
                  aria-selected={level === l.value}
                  onClick={() => setLevel(l.value)}
                  className={cn("min-h-9 rounded-md px-3 text-sm font-semibold", level === l.value ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {report.isLoading ? (
            <Loader2 className="m-6 h-5 w-5 animate-spin text-muted-foreground" />
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Belum ada data iklan di periode ini. Chat dari iklan klik-ke-WhatsApp tercatat otomatis; untuk landing page buat{" "}
              <Link to="/ads/links" className="font-medium text-primary underline">
                link WhatsApp
              </Link>
              .
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead>Jalur</TableHead>
                    <TableHead className="text-right">Biaya</TableHead>
                    <TableHead className="text-right">Lead</TableHead>
                    <TableHead className="text-right">CPL</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Konversi</TableHead>
                    <TableHead className="text-right">Omzet</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const sp = Number(r.spend);
                    const ld = Number(r.leads);
                    const rv = Number(r.revenue);
                    const roas = sp ? rv / sp : null;
                    return (
                      <TableRow key={r.key}>
                        <TableCell>
                          <p className="font-medium">{r.name}</p>
                          {r.parent && <p className="text-xs text-muted-foreground">{r.parent}</p>}
                        </TableCell>
                        <TableCell>
                          {r.path && (
                            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", r.path === "link" ? "bg-orange-100 text-orange-900" : "bg-primary/10 text-primary")}>
                              {r.path === "link" ? "Landing page" : "WhatsApp"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{sp ? rpShort(sp) : "–"}</TableCell>
                        <TableCell className="text-right tabular-nums">{ld}</TableCell>
                        <TableCell className="text-right tabular-nums">{ld && sp ? rpShort(sp / ld) : "–"}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.closings)}</TableCell>
                        <TableCell className="text-right tabular-nums">{percent(Number(r.closings), ld)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rv ? rpShort(rv) : "–"}</TableCell>
                        <TableCell className="text-right">
                          {roas === null ? (
                            "–"
                          ) : (
                            <span className={cn("rounded-md px-2 py-0.5 font-bold tabular-nums", roas >= 3 ? "bg-success/15 text-success" : roas >= 1 ? "bg-warning/15 text-warning" : "bg-destructive/10 text-destructive")}>
                              {ratio(rv, sp)}×
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
