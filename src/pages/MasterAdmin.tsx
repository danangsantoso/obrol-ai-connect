import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Building2, KeyRound, Loader2, LogOut, Plus, Power, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Logo } from "@/components/brand/Logo";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { callFunction, errorMessage } from "@/lib/api";
import { toast } from "sonner";

const DEFAULT_PASSWORD = "12345678";

interface Superadmin {
  id: string;
  name: string | null;
  email: string;
  must_change_password: boolean;
}

// New tenant with its Superadmin, or another Superadmin for an existing tenant.
function TenantDialog({
  tenant,
  open,
  onOpenChange,
  onDone,
}: {
  tenant: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ name: "", admin_name: "", admin_email: "", password: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const password = form.password.trim() || DEFAULT_PASSWORD;
      if (tenant) {
        await callFunction("master-admin", { action: "add_superadmin", organization_id: tenant.id, ...form, password });
      } else {
        await callFunction("master-admin", { action: "create_tenant", ...form, password });
      }
      toast.success(
        `${tenant ? `Superadmin ${tenant.name}` : `Tenant ${form.name}`} dibuat. Login: ${form.admin_email.trim()} / ${password} (wajib diganti saat login pertama).`,
        { duration: 15_000 },
      );
      setForm({ name: "", admin_name: "", admin_email: "", password: "" });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{tenant ? `Tambah Superadmin: ${tenant.name}` : "Tenant baru"}</DialogTitle>
            <DialogDescription>
              Superadmin memegang penuh tenant ini: kanal chat, tim, AI, dan integrasi. Data tenant tidak terlihat oleh
              tenant lain.
            </DialogDescription>
          </DialogHeader>
          {!tenant && (
            <div className="space-y-1">
              <Label htmlFor="tenant-name">Nama tenant / perusahaan</Label>
              <Input id="tenant-name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="sa-name">Nama Superadmin</Label>
            <Input id="sa-name" value={form.admin_name} maxLength={80} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sa-email">Email Superadmin (untuk login)</Label>
            <Input id="sa-email" type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sa-password">Password awal</Label>
            <Input
              id="sa-password"
              value={form.password}
              placeholder={`${DEFAULT_PASSWORD} (bawaan)`}
              autoComplete="off"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Superadmin wajib menggantinya saat login pertama.</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {tenant ? "Tambah Superadmin" : "Buat tenant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function MasterAdmin() {
  const { profile, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; tenant: { id: string; name: string } | null }>({ open: false, tenant: null });
  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["master-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("master_tenant_overview");
      if (error) throw error;
      return data;
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["master-tenants"] });

  const setActive = async (id: string, name: string, active: boolean) => {
    const question = active
      ? `Aktifkan kembali ${name}? Semua anggotanya bisa login lagi.`
      : `Nonaktifkan ${name}? Semua anggotanya langsung tidak bisa login dan tidak bisa mengakses data. Data tetap tersimpan.`;
    if (!window.confirm(question)) return;
    try {
      await callFunction("master-admin", { action: "set_tenant_active", organization_id: id, active });
      toast.success(active ? `${name} aktif kembali` : `${name} dinonaktifkan`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const resetPassword = async (sa: Superadmin) => {
    if (!window.confirm(`Reset password ${sa.email} ke ${DEFAULT_PASSWORD}?`)) return;
    try {
      await callFunction("master-admin", { action: "reset_password", user_id: sa.id });
      toast.success(`Password ${sa.email} direset ke ${DEFAULT_PASSWORD}`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const active = tenants.filter((t) => t.is_active).length;
  const members = tenants.reduce((sum, t) => sum + Number(t.members), 0);

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="flex h-14 items-center justify-between border-b bg-card px-6">
        <div className="flex items-center gap-3">
          <Logo />
          <Badge className="gap-1">
            <ShieldCheck className="h-3 w-3" /> Master Admin
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">{profile?.email}</span>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            <LogOut className="mr-1 h-4 w-4" /> Keluar
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Tenant</h1>
            <p className="text-muted-foreground">
              Setiap tenant terpisah penuh: anggota, kanal, chat, kontak, dan pengaturannya tidak terlihat oleh tenant lain.
              Master Admin hanya melihat ringkasan, bukan isi chat.
            </p>
          </div>
          <Button onClick={() => setDialog({ open: true, tenant: null })}>
            <Plus className="mr-1 h-4 w-4" /> Tenant baru
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <StatsCard title="Tenant" value={tenants.length} icon={Building2} accent={1} />
          <StatsCard title="Tenant aktif" value={`${active} / ${tenants.length}`} icon={Power} accent={3} />
          <StatsCard title="Total anggota" value={members} icon={Users} accent={2} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Daftar tenant</CardTitle>
            <CardDescription>Superadmin adalah admin tertinggi di dalam tenant dan bisa menambah Admin, Supervisor, dan Agen.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <Loader2 className="m-6 h-5 w-5 animate-spin text-muted-foreground" />
            ) : tenants.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Belum ada tenant. Klik “Tenant baru”.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Superadmin</TableHead>
                    <TableHead className="text-right">Anggota</TableHead>
                    <TableHead className="text-right">Kanal</TableHead>
                    <TableHead className="text-right">Chat</TableHead>
                    <TableHead>Dibuat</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((t) => {
                    const admins = (t.superadmins ?? []) as unknown as Superadmin[];
                    return (
                      <TableRow key={t.id}>
                        <TableCell>
                          <p className="font-medium">{t.name}</p>
                          {t.is_active ? (
                            <Badge variant="outline" className="border-success/40 text-success">Aktif</Badge>
                          ) : (
                            <Badge variant="outline" className="border-danger/40 text-danger">Nonaktif</Badge>
                          )}
                        </TableCell>
                        <TableCell className="space-y-1">
                          {admins.length === 0 && <span className="text-sm text-muted-foreground">–</span>}
                          {admins.map((sa) => (
                            <div key={sa.id} className="flex flex-wrap items-center gap-2 text-sm">
                              <span>{sa.name || sa.email}</span>
                              <span className="text-xs text-muted-foreground">{sa.email}</span>
                              {sa.must_change_password && <span className="text-xs text-warning">belum ganti password</span>}
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => resetPassword(sa)} aria-label={`Reset password ${sa.email}`}>
                                <KeyRound className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{Number(t.members)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(t.channels)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(t.conversations)}</TableCell>
                        <TableCell className="whitespace-nowrap">{format(new Date(t.created_at), "dd/MM/yy")}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, tenant: { id: t.id, name: t.name } })}>
                              <UserPlus className="mr-1 h-4 w-4" /> Superadmin
                            </Button>
                            <Button
                              size="sm"
                              variant={t.is_active ? "ghost" : "default"}
                              className={t.is_active ? "text-danger" : ""}
                              onClick={() => setActive(t.id, t.name, !t.is_active)}
                            >
                              <Power className="mr-1 h-4 w-4" /> {t.is_active ? "Nonaktifkan" : "Aktifkan"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      <TenantDialog
        tenant={dialog.tenant}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onDone={refresh}
      />
    </div>
  );
}
