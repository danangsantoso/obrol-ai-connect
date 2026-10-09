import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Crown, Loader2, Medal, Settings2, Trophy } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { rpShort } from "@/components/ads/shared";

interface Row {
  profile_id: string | null;
  name: string;
  avatar_url: string | null;
  role: string | null;
  chats: number;
  closings: number;
  revenue: number;
  revenue_target: number;
  closing_target: number;
  commission: number | null;
}

const NONE = "00000000-0000-0000-0000-000000000000";
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
// The first day of this month and the five before it.
function months() {
  const [y, m] = today().split("-").map(Number);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return { value: d.toISOString().slice(0, 10), label: format(d, "MMMM yyyy", { locale: localeId }) };
  });
}
const money = (v: string) => Number(v.replace(/\D/g, "")) || 0;
const fmt = (n: number) => (n ? n.toLocaleString("id-ID") : "");
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

function Progress({ value, target, tone = "primary" }: { value: number; target: number; tone?: "primary" | "success" }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : tone === "success" ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SetupDialog({ open, onOpenChange, orgId, month, monthLabel, rows, isAdmin }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  month: string;
  monthLabel: string;
  rows: Row[];
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const people = rows.filter((r) => r.profile_id);
  const [targets, setTargets] = useState<Record<string, { revenue: string; closings: string }>>({});
  const [rules, setRules] = useState<Record<string, { percent: string; per_closing: string }>>({});
  const [busy, setBusy] = useState(false);

  const { data: saved } = useQuery({
    queryKey: ["sales-setup", orgId, month],
    enabled: open,
    queryFn: async () => {
      const [t, r] = await Promise.all([
        supabase.from("sales_targets").select("profile_id, revenue_target, closing_target").eq("month", month),
        isAdmin ? supabase.from("commission_rules").select("profile_id, percent, per_closing") : Promise.resolve({ data: [] }),
      ]);
      return { targets: t.data ?? [], rules: r.data ?? [] };
    },
  });
  useEffect(() => {
    if (!saved) return;
    setTargets(
      Object.fromEntries(saved.targets.map((t) => [t.profile_id ?? NONE, { revenue: fmt(Number(t.revenue_target)), closings: t.closing_target ? String(t.closing_target) : "" }])),
    );
    setRules(Object.fromEntries(saved.rules.map((r) => [r.profile_id ?? NONE, { percent: Number(r.percent) ? String(Number(r.percent)) : "", per_closing: fmt(Number(r.per_closing)) }])));
  }, [saved]);

  const save = async () => {
    setBusy(true);
    try {
      const keys = [NONE, ...people.map((p) => p.profile_id!)];
      // Rows are replaced as a whole: unique on (organization, month, person) with null for the team.
      const { error: delT } = await supabase.from("sales_targets").delete().eq("month", month);
      if (delT) throw delT;
      const tRows = keys
        .map((k) => ({ k, v: targets[k] }))
        .filter(({ v }) => v && (money(v.revenue) || Number(v.closings)))
        .map(({ k, v }) => ({
          organization_id: orgId,
          month,
          profile_id: k === NONE ? null : k,
          revenue_target: money(v.revenue),
          closing_target: Math.max(0, Math.round(Number(v.closings) || 0)),
        }));
      if (tRows.length) {
        const { error } = await supabase.from("sales_targets").insert(tRows);
        if (error) throw error;
      }
      if (isAdmin) {
        const { error: delR } = await supabase.from("commission_rules").delete().eq("organization_id", orgId);
        if (delR) throw delR;
        const rRows = keys
          .map((k) => ({ k, v: rules[k] }))
          .filter(({ v }) => v && (Number(v.percent.replace(",", ".")) || money(v.per_closing)))
          .map(({ k, v }) => ({
            organization_id: orgId,
            profile_id: k === NONE ? null : k,
            percent: Math.min(100, Math.max(0, Number(v.percent.replace(",", ".")) || 0)),
            per_closing: money(v.per_closing),
          }));
        if (rRows.length) {
          const { error } = await supabase.from("commission_rules").insert(rRows);
          if (error) throw error;
        }
      }
      toast.success("Target dan komisi disimpan");
      qc.invalidateQueries({ queryKey: ["sales-leaderboard"] });
      qc.invalidateQueries({ queryKey: ["sales-team-target"] });
      qc.invalidateQueries({ queryKey: ["sales-setup"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const line = (key: string, label: string, sub?: string) => (
    <TableRow key={key}>
      <TableCell>
        <p className="font-medium">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </TableCell>
      <TableCell>
        <Input
          aria-label={`Target omzet ${label}`}
          inputMode="numeric"
          className="w-36"
          placeholder="0"
          value={targets[key]?.revenue ?? ""}
          onChange={(e) => setTargets({ ...targets, [key]: { closings: targets[key]?.closings ?? "", revenue: fmt(money(e.target.value)) } })}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label={`Target closing ${label}`}
          inputMode="numeric"
          className="w-20"
          placeholder="0"
          value={targets[key]?.closings ?? ""}
          onChange={(e) => setTargets({ ...targets, [key]: { revenue: targets[key]?.revenue ?? "", closings: e.target.value.replace(/\D/g, "") } })}
        />
      </TableCell>
      {isAdmin && (
        <>
          <TableCell>
            <Input
              aria-label={`Komisi persen ${label}`}
              inputMode="decimal"
              className="w-20"
              placeholder={key === NONE ? "0" : "ikut umum"}
              value={rules[key]?.percent ?? ""}
              onChange={(e) => setRules({ ...rules, [key]: { per_closing: rules[key]?.per_closing ?? "", percent: e.target.value.replace(/[^\d,.]/g, "") } })}
            />
          </TableCell>
          <TableCell>
            <Input
              aria-label={`Komisi per closing ${label}`}
              inputMode="numeric"
              className="w-28"
              placeholder={key === NONE ? "0" : "ikut umum"}
              value={rules[key]?.per_closing ?? ""}
              onChange={(e) => setRules({ ...rules, [key]: { percent: rules[key]?.percent ?? "", per_closing: fmt(money(e.target.value)) } })}
            />
          </TableCell>
        </>
      )}
    </TableRow>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Target & komisi · {monthLabel}</DialogTitle>
          <DialogDescription>
            Target berlaku untuk bulan ini. {isAdmin ? "Komisi = % dari omzet closing + nominal per closing; baris “Semua (umum)” berlaku bagi yang tidak punya aturan sendiri." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead>Target omzet (Rp)</TableHead>
                <TableHead>Target closing</TableHead>
                {isAdmin && (
                  <>
                    <TableHead>Komisi %</TableHead>
                    <TableHead>Rp per closing</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {line(NONE, isAdmin ? "Tim / Semua (umum)" : "Tim", "target tim; komisi umum")}
              {people.map((p) => line(p.profile_id!, p.name, p.role === "agent" ? "Agen" : p.role === "supervisor" ? "Supervisor" : "Admin"))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Sales() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const isAdmin = profile!.role === "admin";
  const canManage = profile!.role === "admin" || profile!.role === "supervisor";
  const options = useMemo(months, []);
  const [month, setMonth] = useState(options[0].value);
  const [setup, setSetup] = useState(false);
  const monthLabel = options.find((m) => m.value === month)?.label ?? month;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["sales-leaderboard", orgId, month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sales_leaderboard", { p_month: month });
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, chats: Number(r.chats), closings: Number(r.closings), revenue: Number(r.revenue), revenue_target: Number(r.revenue_target), commission: r.commission === null ? null : Number(r.commission) })) as Row[];
    },
  });
  const { data: team } = useQuery({
    queryKey: ["sales-team-target", orgId, month],
    queryFn: async () => (await supabase.from("sales_targets").select("revenue_target, closing_target").eq("month", month).is("profile_id", null).maybeSingle()).data,
  });

  const total = rows.reduce((n, r) => n + r.revenue, 0);
  const closings = rows.reduce((n, r) => n + r.closings, 0);
  const people = rows.filter((r) => r.profile_id);
  const me = rows.find((r) => r.profile_id === profile!.id);
  const ranked = [...people].sort((a, b) => b.revenue - a.revenue || b.closings - a.closings);
  const rankOf = (id: string | null) => ranked.findIndex((r) => r.profile_id === id) + 1;
  const commissionTotal = rows.reduce((n, r) => n + (r.commission ?? 0), 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Trophy className="h-6 w-6 text-warning" /> Target & Komisi
          </h1>
          <p className="text-muted-foreground">Closing dari pesanan lunas dan “Tandai closing” dihitung ke CS yang menangani chat.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-44" aria-label="Bulan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && (
            <Button variant="outline" onClick={() => setSetup(true)}>
              <Settings2 className="mr-1 h-4 w-4" /> Atur target{isAdmin ? " & komisi" : ""}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm font-semibold">Omzet tim</p>
              <p className="text-2xl font-extrabold tabular-nums">{rpShort(total)}</p>
              {team?.revenue_target ? (
                <>
                  <Progress value={total} target={Number(team.revenue_target)} />
                  <p className="text-xs text-muted-foreground">
                    {Math.round((total / Number(team.revenue_target)) * 100)}% dari target {rpShort(team.revenue_target)}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Belum ada target tim</p>
              )}
            </div>
            <div className="space-y-2 rounded-xl border p-4">
              <p className="text-sm text-muted-foreground">Closing tim</p>
              <p className="text-2xl font-extrabold tabular-nums">{closings}</p>
              {team?.closing_target ? (
                <>
                  <Progress value={closings} target={team.closing_target} tone="success" />
                  <p className="text-xs text-muted-foreground">target {team.closing_target} closing</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">rata-rata {closings ? rpShort(total / closings) : "–"} per closing</p>
              )}
            </div>
            {me && (
              <div className="space-y-2 rounded-xl border border-success/30 bg-success/5 p-4">
                <p className="text-sm font-semibold">Kamu · peringkat {rankOf(me.profile_id) || "–"}</p>
                <p className="text-2xl font-extrabold tabular-nums">{rpShort(me.revenue)}</p>
                {me.revenue_target > 0 && <Progress value={me.revenue} target={me.revenue_target} tone="success" />}
                <p className="text-xs text-muted-foreground">
                  {me.closings} closing{me.revenue_target ? ` · target ${rpShort(me.revenue_target)}` : ""}
                  {me.commission !== null ? ` · komisi ${rpShort(me.commission)}` : ""}
                </p>
              </div>
            )}
            {canManage && (
              <div className="space-y-2 rounded-xl border p-4">
                <p className="text-sm text-muted-foreground">Total komisi</p>
                <p className="text-2xl font-extrabold tabular-nums">{rpShort(commissionTotal)}</p>
                <p className="text-xs text-muted-foreground">{monthLabel}</p>
              </div>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Papan peringkat · {monthLabel}</CardTitle>
              <CardDescription>Chat = jumlah chat yang dibalas tiap orang bulan ini.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">Belum ada data.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Nama</TableHead>
                        <TableHead className="text-right">Chat</TableHead>
                        <TableHead className="text-right">Closing</TableHead>
                        <TableHead className="text-right">Konversi</TableHead>
                        <TableHead className="text-right">Omzet</TableHead>
                        <TableHead className="min-w-40">Target</TableHead>
                        <TableHead className="text-right">Komisi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...ranked, ...rows.filter((r) => !r.profile_id)].map((r) => {
                        const rank = r.profile_id ? rankOf(r.profile_id) : 0;
                        return (
                          <TableRow key={r.profile_id ?? "none"} className={cn(r.profile_id === profile!.id && "bg-primary/5")}>
                            <TableCell>
                              {rank === 1 && r.revenue > 0 ? (
                                <Crown className="h-5 w-5 text-warning" aria-label="Peringkat 1" />
                              ) : rank > 1 && rank <= 3 && r.revenue > 0 ? (
                                <Medal className={cn("h-5 w-5", rank === 2 ? "text-slate-400" : "text-orange-500")} aria-label={`Peringkat ${rank}`} />
                              ) : (
                                <span className="pl-1 text-muted-foreground">{rank || "–"}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="flex items-center gap-2">
                                <Avatar className="h-8 w-8">
                                  {r.avatar_url && <AvatarImage src={r.avatar_url} alt="" />}
                                  <AvatarFallback className="text-xs">{r.profile_id ? initials(r.name) : "AI"}</AvatarFallback>
                                </Avatar>
                                <span className="font-medium">
                                  {r.name}
                                  {r.profile_id === profile!.id && <span className="ml-1 text-xs text-primary">(kamu)</span>}
                                </span>
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{r.profile_id ? r.chats : "–"}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.closings}
                              {r.closing_target > 0 && <span className="text-muted-foreground">/{r.closing_target}</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{r.chats ? `${Math.round((r.closings / r.chats) * 100)}%` : "–"}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{rpShort(r.revenue)}</TableCell>
                            <TableCell>
                              {r.revenue_target > 0 ? (
                                <div className="space-y-1">
                                  <Progress value={r.revenue} target={r.revenue_target} />
                                  <p className="text-xs text-muted-foreground">
                                    {Math.round((r.revenue / r.revenue_target) * 100)}% dari {rpShort(r.revenue_target)}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">–</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{!r.profile_id ? "–" : r.commission === null ? <span className="text-muted-foreground" title="Hanya terlihat oleh orangnya, admin dan supervisor">•••</span> : rpShort(r.commission)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {canManage && <SetupDialog open={setup} onOpenChange={setSetup} orgId={orgId} month={month} monthLabel={monthLabel} rows={rows} isAdmin={isAdmin} />}
    </div>
  );
}
