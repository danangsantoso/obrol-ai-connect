import { useState } from "react";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoMark } from "@/components/brand/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { callFunction, errorMessage } from "@/lib/api";
import { toast } from "sonner";

const DEFAULT_PASSWORD = "12345678";

// Shown instead of the app while the member still uses the default password
// (new account or an admin reset). Nothing else opens until it is changed.
export default function ChangePassword() {
  const { profile, signOut, refreshProfile } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const problem =
    password.length > 0 && password.length < 8
      ? "Minimal 8 karakter."
      : password === DEFAULT_PASSWORD
        ? "Tidak boleh sama dengan password bawaan."
        : confirm.length > 0 && confirm !== password
          ? "Konfirmasi password tidak cocok."
          : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || password !== confirm) return;
    setBusy(true);
    try {
      await callFunction("member-password", { action: "change", password });
      await refreshProfile();
      toast.success("Password berhasil diganti");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <LogoMark className="mx-auto h-12 w-12" />
          <CardTitle className="flex items-center justify-center gap-2">
            <KeyRound className="h-5 w-5" /> Ganti password
          </CardTitle>
          <CardDescription>
            Halo{profile?.full_name ? ` ${profile.full_name}` : ""}! Demi keamanan, ganti password bawaan dengan password
            Anda sendiri sebelum mulai bekerja.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="new-password">Password baru</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-password">Ulangi password baru</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            {problem && <p className="text-sm text-destructive">{problem}</p>}
            <Button type="submit" className="w-full" disabled={busy || !!problem || !password || password !== confirm}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan password
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => signOut()}>
              <LogOut className="mr-2 h-4 w-4" /> Keluar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
