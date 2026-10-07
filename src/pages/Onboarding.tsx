import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoMark } from '@/components/brand/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage } from '@/lib/api';
import { toast } from 'sonner';

export default function Onboarding() {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (profile?.organization_id) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.rpc('create_organization', { org_name: name });
    setSaving(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    await refreshProfile();
    navigate('/settings', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-light via-background to-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <LogoMark className="mx-auto h-12 w-12" />
          <CardTitle>Selamat datang di Balas.id</CardTitle>
          <CardDescription>
            Buat organisasi untuk tim CS Anda. Anda akan menjadi Admin dan bisa mengundang agen setelahnya.
            Jika Anda agen, minta admin mengundang email <strong>{user.email}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Nama perusahaan / organisasi</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="PT Contoh Sejahtera"
                minLength={2}
                maxLength={120}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Buat organisasi
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => signOut()}>
              Keluar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
