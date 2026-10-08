import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { callFunction, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Plan = Tables<"plans">;
const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const limit = (n: number | null) => (n === null ? "∞" : n.toLocaleString("id-ID"));

export function usePlans() {
  return useQuery({
    queryKey: ["plans"],
    queryFn: async () => (await supabase.from("plans").select("*").order("price_monthly")).data ?? [],
  });
}

const EMPTY = { name: "", description: "", price: "", users: "", channels: "", ai: "", broadcast: "", is_default: false, trial: "0" };
const numOrNull = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.floor(Number(s.replace(/\D/g, "")) || 0)));

function PlanDialog({ plan, open, onOpenChange }: { plan: Plan | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [last, setLast] = useState<Plan | null | undefined>(undefined);
  if (open && last !== plan) {
    setLast(plan);
    setForm(
      plan
        ? {
            name: plan.name,
            description: plan.description,
            price: String(Number(plan.price_monthly)),
            users: plan.max_users?.toString() ?? "",
            channels: plan.max_channels?.toString() ?? "",
            ai: plan.ai_replies_per_month?.toString() ?? "",
            broadcast: plan.broadcast_per_month?.toString() ?? "",
            is_default: plan.is_default,
            trial: String(plan.trial_days),
          }
        : EMPTY,
    );
  }
  const save = async () => {
    const row = {
      name: form.name.trim(),
      description: form.description.trim(),
      price_monthly: numOrNull(form.price) ?? 0,
      max_users: numOrNull(form.users) || null,
      max_channels: numOrNull(form.channels) || null,
      ai_replies_per_month: numOrNull(form.ai),
      broadcast_per_month: numOrNull(form.broadcast),
      is_default: form.is_default,
      trial_days: Math.min(365, numOrNull(form.trial) ?? 0),
    };
    if (!row.name) return toast.error("Isi nama paket");
    // Only one default plan.
    if (row.is_default) await supabase.from("plans").update({ is_default: false }).eq("is_default", true).neq("id", plan?.id ?? "00000000-0000-0000-0000-000000000000");
    const { error } = plan ? await supabase.from("plans").update(row).eq("id", plan.id) : await supabase.from("plans").insert(row);
    if (error) return toast.error(error.code === "23505" ? "Nama paket sudah ada" : errorMessage(error));
    toast.success("Paket disimpan");
    setLast(undefined);
    queryClient.invalidateQueries({ queryKey: ["plans"] });
    queryClient.invalidateQueries({ queryKey: ["master-tenants"] });
    onOpenChange(false);
  };
  const field = (id: keyof typeof EMPTY, label: string, hint?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`plan-${id}`}>{label}</Label>
      <Input id={`plan-${id}`} inputMode="numeric" value={form[id] as string} onChange={(e) => setForm({ ...form, [id]: e.target.value })} placeholder={hint} />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setLast(undefined); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plan ? "Ubah paket" : "Paket baru"}</DialogTitle>
          <DialogDescription>Kosongkan batas untuk tanpa batas.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="plan-name">Nama paket</Label>
            <Input id="plan-name" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="plan-desc">Keterangan</Label>
            <Input id="plan-desc" value={form.description} maxLength={300} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {field("price", "Harga per bulan (Rp)")}
          {field("users", "Maks. pengguna", "tanpa batas")}
          {field("channels", "Maks. kanal", "tanpa batas")}
          {field("ai", "Balasan AI per bulan", "tanpa batas")}
          {field("broadcast", "Pesan broadcast per bulan", "tanpa batas")}
          {field("trial", "Masa trial (hari)")}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Switch checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} aria-label="Paket bawaan" />
            Paket bawaan untuk tenant baru (mulai dengan masa trial)
          </label>
        </div>
        <DialogFooter>
          <Button onClick={save}>Simpan paket</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlansCard() {
  const queryClient = useQueryClient();
  const { data: plans = [] } = usePlans();
  const [editing, setEditing] = useState<{ open: boolean; plan: Plan | null }>({ open: false, plan: null });
  const remove = async (p: Plan) => {
    if (!window.confirm(`Hapus paket ${p.name}? Tenant yang memakainya menjadi tanpa batas.`)) return;
    const { error } = await supabase.from("plans").delete().eq("id", p.id);
    if (error) return toast.error(errorMessage(error));
    queryClient.invalidateQueries({ queryKey: ["plans"] });
    queryClient.invalidateQueries({ queryKey: ["master-tenants"] });
  };
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Paket langganan</CardTitle>
          <CardDescription>Batas pengguna, kanal, balasan AI, dan broadcast per bulan untuk tiap tenant.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing({ open: true, plan: null })}>
          <Plus className="mr-1 h-4 w-4" /> Paket baru
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paket</TableHead>
              <TableHead className="text-right">Harga/bulan</TableHead>
              <TableHead className="text-right">Pengguna</TableHead>
              <TableHead className="text-right">Kanal</TableHead>
              <TableHead className="text-right">AI/bulan</TableHead>
              <TableHead className="text-right">Broadcast/bulan</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Belum ada paket. Tenant tanpa paket tidak dibatasi.
                </TableCell>
              </TableRow>
            )}
            {plans.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <span className="font-medium">{p.name}</span>
                  {p.is_default && <Badge className="ml-2" variant="secondary">Bawaan · trial {p.trial_days} hari</Badge>}
                  {p.description && <span className="block text-xs text-muted-foreground">{p.description}</span>}
                </TableCell>
                <TableCell className="text-right">{rupiah(Number(p.price_monthly))}</TableCell>
                <TableCell className="text-right">{limit(p.max_users)}</TableCell>
                <TableCell className="text-right">{limit(p.max_channels)}</TableCell>
                <TableCell className="text-right">{limit(p.ai_replies_per_month)}</TableCell>
                <TableCell className="text-right">{limit(p.broadcast_per_month)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ open: true, plan: p })} aria-label={`Ubah ${p.name}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(p)} aria-label={`Hapus ${p.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <PlanDialog plan={editing.plan} open={editing.open} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} />
    </Card>
  );
}

// Plan of one tenant in the tenant list: pick a plan, extend the paid period.
export function TenantPlan({
  tenant,
  plans,
  onChanged,
}: {
  tenant: { id: string; name: string; plan_id: string | null; plan_expires_at: string | null; ai_replies_month: number; broadcast_month: number };
  plans: Plan[];
  onChanged: () => void;
}) {
  const plan = plans.find((p) => p.id === tenant.plan_id);
  const expired = tenant.plan_expires_at ? new Date(tenant.plan_expires_at) < new Date() : false;
  const call = async (body: Record<string, unknown>, done: string) => {
    try {
      await callFunction("master-admin", { action: "set_tenant_plan", organization_id: tenant.id, ...body });
      toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="min-w-[200px] space-y-1">
      <Select value={tenant.plan_id ?? "none"} onValueChange={(v) => call({ plan_id: v === "none" ? null : v }, "Paket diperbarui")}>
        <SelectTrigger className="h-8" aria-label={`Paket ${tenant.name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Tanpa batas</SelectItem>
          {plans.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {tenant.plan_id && (
        <div className="flex items-center gap-1 text-xs">
          <span className={cn(expired ? "text-danger" : "text-muted-foreground")}>
            {tenant.plan_expires_at ? `${expired ? "Berakhir" : "s.d."} ${new Date(tenant.plan_expires_at).toLocaleDateString("id-ID")}` : "Tanpa batas waktu"}
          </span>
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => call({ extend_days: 30 }, `${tenant.name} diperpanjang 30 hari`)} aria-label={`Perpanjang ${tenant.name}`}>
            <CalendarPlus className="mr-1 h-3.5 w-3.5" /> +30 hari
          </Button>
        </div>
      )}
      {plan && (
        <p className="text-xs text-muted-foreground">
          AI {tenant.ai_replies_month}/{limit(plan.ai_replies_per_month)} · Broadcast {tenant.broadcast_month}/{limit(plan.broadcast_per_month)}
        </p>
      )}
    </div>
  );
}
