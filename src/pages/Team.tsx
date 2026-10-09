import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, callFunction, errorMessage } from "@/lib/api";
import { useMembers, useTeams } from "@/components/inbox/useInboxData";
import { memberName } from "@/components/inbox/types";
import { RotationSettings } from "@/components/team/RotationSettings";
import { MobileAppCard } from "@/components/team/MobileAppCard";
import { toast } from "sonner";

const DEFAULT_PASSWORD = "12345678";

function useMemberships(orgId: string) {
  return useQuery({
    queryKey: ["team-members", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("team_members").select("team_id, profile_id");
      if (error) throw error;
      return data;
    },
  });
}

function InviteDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { profile } = useAuth();
  const { data: teams = [] } = useTeams(profile!.organization_id!);
  const [form, setForm] = useState({ email: "", full_name: "", role: "agent" as AppRole, team: "", password: "" });
  const [byEmail, setByEmail] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await callFunction<{ invited: boolean }>("invite-member", {
        email: form.email,
        full_name: form.full_name,
        role: form.role,
        team_ids: form.team ? [form.team] : [],
        password: byEmail ? undefined : form.password.trim() || undefined,
        invite_by_email: byEmail,
      });
      toast.success(
        result.invited
          ? `Undangan dikirim ke ${form.email}`
          : `Akun ${form.email} dibuat dengan password ${form.password.trim() || DEFAULT_PASSWORD}. Wajib diganti saat login pertama.`,
      );
      setForm({ email: "", full_name: "", role: "agent", team: "", password: "" });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Tambah anggota tim</DialogTitle>
            <DialogDescription>Agen akan masuk dengan email ini dan langsung melihat inbox.</DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-name">Nama</Label>
              <Input id="invite-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Peran</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tim / divisi</Label>
                <Select value={form.team || "none"} onValueChange={(v) => setForm({ ...form, team: v === "none" ? "" : v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tanpa tim</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!byEmail && (
              <div className="space-y-2">
                <Label htmlFor="invite-password">Password awal</Label>
                <Input
                  id="invite-password"
                  type="text"
                  minLength={8}
                  placeholder={`${DEFAULT_PASSWORD} (bawaan)`}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Kosongkan untuk memakai password bawaan <b>{DEFAULT_PASSWORD}</b>. Anggota wajib menggantinya saat login
                  pertama.
                </p>
              </div>
            )}
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">Kirim undangan lewat email</p>
                <p className="text-xs text-muted-foreground">Anggota membuat password sendiri dari link di email (butuh SMTP).</p>
              </div>
              <Switch checked={byEmail} onCheckedChange={setByEmail} aria-label="Kirim undangan lewat email" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Tambah
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Team() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const isAdmin = profile!.role === "admin";
  const queryClient = useQueryClient();
  const { data: members = [] } = useMembers(orgId);
  const { data: teams = [] } = useTeams(orgId);
  const { data: memberships = [] } = useMemberships(orgId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [newTeam, setNewTeam] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["members", orgId] });
    queryClient.invalidateQueries({ queryKey: ["teams", orgId] });
    queryClient.invalidateQueries({ queryKey: ["team-members", orgId] });
  };

  const updateMember = async (id: string, values: { role?: AppRole; is_active?: boolean }) => {
    const { error } = await supabase.from("profiles").update(values).eq("id", id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };

  const resetPassword = async (id: string, name: string) => {
    if (!window.confirm(`Reset password ${name} ke ${DEFAULT_PASSWORD}? Ia wajib menggantinya saat login berikutnya, dan verifikasi 2 langkahnya dimatikan (mis. HP hilang).`)) return;
    try {
      await callFunction("member-password", { action: "reset", user_id: id });
      toast.success(`Password ${name} direset ke ${DEFAULT_PASSWORD}`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const toggleMembership = async (teamId: string, profileId: string, member: boolean) => {
    const { error } = member
      ? await supabase.from("team_members").insert({ team_id: teamId, profile_id: profileId })
      : await supabase.from("team_members").delete().eq("team_id", teamId).eq("profile_id", profileId);
    if (error) toast.error(errorMessage(error));
    refresh();
  };

  const createTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("teams").insert({ organization_id: orgId, name: newTeam.trim() });
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    setNewTeam("");
    refresh();
  };

  const deleteTeam = async (id: string) => {
    if (!window.confirm("Hapus tim ini? Chat milik tim ini akan kembali tanpa tim.")) return;
    const { error } = await supabase.from("teams").delete().eq("id", id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tim & Agen</h1>
          <p className="text-muted-foreground">Kelola siapa saja yang bisa membalas chat dari nomor WhatsApp Anda.</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Tambah anggota
          </Button>
        )}
      </div>

      <RotationSettings orgId={orgId} canEdit={isAdmin} />
      <MobileAppCard />

      <Card>
        <CardHeader>
          <CardTitle>Anggota</CardTitle>
          <CardDescription>Agen hanya melihat chat miliknya dan antrean timnya. Supervisor melihat chat timnya.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Peran</TableHead>
                {teams.map((t) => (
                  <TableHead key={t.id} className="text-center">
                    {t.name}
                  </TableHead>
                ))}
                {isAdmin && <TableHead>Password</TableHead>}
                <TableHead className="text-right">Aktif</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const self = m.id === profile!.id;
                return (
                  <TableRow key={m.id} className={m.is_active ? undefined : "opacity-60"}>
                    <TableCell>
                      <p className="font-medium">{memberName(m)}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </TableCell>
                    <TableCell>
                      {isAdmin && !self ? (
                        <Select value={m.role} onValueChange={(v) => updateMember(m.id, { role: v as AppRole })}>
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                              <SelectItem key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        ROLE_LABELS[m.role]
                      )}
                    </TableCell>
                    {teams.map((t) => {
                      const inTeam = memberships.some((x) => x.team_id === t.id && x.profile_id === m.id);
                      return (
                        <TableCell key={t.id} className="text-center">
                          <Checkbox
                            checked={inTeam}
                            disabled={!isAdmin}
                            onCheckedChange={(v) => toggleMembership(t.id, m.id, v === true)}
                            aria-label={`${memberName(m)} di ${t.name}`}
                          />
                        </TableCell>
                      );
                    })}
                    {isAdmin && (
                      <TableCell>
                        {self ? null : (
                          <div className="flex items-center gap-2">
                            {m.must_change_password && (
                              <span className="whitespace-nowrap text-xs text-warning">Belum diganti</span>
                            )}
                            <Button size="sm" variant="outline" onClick={() => resetPassword(m.id, memberName(m))}>
                              <KeyRound className="mr-1 h-3 w-3" />
                              Reset
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <Switch
                        checked={m.is_active}
                        disabled={!isAdmin || self}
                        onCheckedChange={(v) => updateMember(m.id, { is_active: v })}
                        aria-label="Aktif"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tim / divisi</CardTitle>
          <CardDescription>Kelompokkan agen per divisi, mis. Penjualan, Teknis, Keuangan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {teams.length === 0 && <p className="text-sm text-muted-foreground">Belum ada tim.</p>}
          {teams.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">
                  {memberships.filter((x) => x.team_id === t.id).length} anggota
                </p>
              </div>
              {isAdmin && (
                <Button variant="ghost" size="icon" onClick={() => deleteTeam(t.id)} aria-label={`Hapus ${t.name}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {isAdmin && (
            <form onSubmit={createTeam} className="flex gap-2">
              <Input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Nama tim baru" required />
              <Button type="submit" variant="outline">
                <Plus className="mr-1 h-4 w-4" />
                Tambah tim
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onDone={refresh} />
    </div>
  );
}
