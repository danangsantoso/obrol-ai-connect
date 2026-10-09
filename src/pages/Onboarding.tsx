import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LogoMark } from '@/components/brand/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage } from '@/lib/api';
import { toast } from 'sonner';

// Signed in but not in a tenant yet. Single-company install: create the
// organization. Multi-tenant platform: ask for a tenant and wait for the
// Master Admin's approval.
export default function Onboarding() {
  const { user, profile, loading, isMaster, mfaPending, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ company: '', phone: '', note: '' });
  const [saving, setSaving] = useState(false);

  const { data: mode } = useQuery({
    queryKey: ['registration-mode'],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('registration_mode');
      if (error) throw error;
      return data as 'approval' | 'self';
    },
  });
  const { data: request, isFetched: requestLoaded } = useQuery({
    queryKey: ['my-tenant-request', user?.id],
    enabled: !!user && mode === 'approval',
    queryFn: async () => {
      const { data, error } = await supabase.from('tenant_requests').select('*').eq('user_id', user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    // Picks up the Master Admin's decision without a reload.
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 15_000 : false),
  });

  // Approved while this page was open: load the new tenant.
  const approved = request?.status === 'approved';
  useEffect(() => {
    if (approved) refreshProfile();
  }, [approved, refreshProfile]);

  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (mfaPending) return <Navigate to="/" replace />;
  if (isMaster) return <Navigate to="/master" replace />;
  if (profile?.organization_id) return <Navigate to="/" replace />;

  const createOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.rpc('create_organization', { org_name: form.company });
    setSaving(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    await refreshProfile();
    navigate('/settings', { replace: true });
  };

  const requestTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.rpc('request_tenant', { p_company: form.company, p_phone: form.phone, p_note: form.note });
    setSaving(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success('Pendaftaran terkirim. Tunggu persetujuan pengelola Balas.id.');
    queryClient.invalidateQueries({ queryKey: ['my-tenant-request', user.id] });
  };

  const waiting = mode === 'approval' && request?.status === 'pending';
  const rejected = mode === 'approval' && request?.status === 'rejected';
  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-light via-background to-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <LogoMark className="mx-auto h-12 w-12" />
          <CardTitle>{waiting ? 'Menunggu persetujuan' : `Selamat datang, ${name}`}</CardTitle>
          <CardDescription>
            {mode === 'self' && (
              <>
                Buat organisasi untuk tim CS Anda. Anda akan menjadi Admin dan bisa mengundang agen setelahnya. Jika Anda
                agen, minta admin mengundang email <strong>{user.email}</strong>.
              </>
            )}
            {mode === 'approval' && !waiting && (
              <>
                Daftarkan usaha Anda. Setelah disetujui pengelola Balas.id, Anda menjadi Superadmin dan bisa langsung
                masuk. Jika Anda agen, minta admin perusahaan Anda mengundang <strong>{user.email}</strong>.
              </>
            )}
            {waiting && (
              <>
                Pendaftaran <strong>{request.company_name}</strong> untuk <strong>{user.email}</strong> sudah kami terima.
                Halaman ini terbuka otomatis begitu disetujui.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!mode || (mode === 'approval' && !requestLoaded) ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          ) : waiting ? (
            <div className="flex items-center justify-center gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning">
              <Clock className="h-4 w-4" /> Menunggu persetujuan Master Admin
            </div>
          ) : (
            <form onSubmit={mode === 'self' ? createOrganization : requestTenant} className="space-y-4">
              {rejected && (
                <div className="flex gap-2 rounded-md bg-danger/10 p-3 text-sm text-danger">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span>
                    Pendaftaran sebelumnya ditolak{request?.reject_reason ? `: ${request.reject_reason}` : '.'} Anda bisa
                    mengajukan lagi.
                  </span>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="org-name">Nama perusahaan / usaha</Label>
                <Input
                  id="org-name"
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  placeholder="PT Contoh Sejahtera"
                  minLength={2}
                  maxLength={120}
                  required
                />
              </div>
              {mode === 'approval' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="org-phone">No. WhatsApp yang bisa dihubungi</Label>
                    <Input id="org-phone" value={form.phone} maxLength={40} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0812…" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-note">Keterangan (opsional)</Label>
                    <Textarea id="org-note" rows={2} maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Jenis usaha, jumlah agen, dll." />
                  </div>
                </>
              )}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'self' ? 'Buat organisasi' : 'Kirim pendaftaran'}
              </Button>
            </form>
          )}
          <Button type="button" variant="ghost" className="w-full" onClick={() => signOut()}>
            Keluar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
