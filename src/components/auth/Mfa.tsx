import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { toast } from "sonner";

// Two-step verification with an authenticator app (Google Authenticator,
// Microsoft Authenticator, Authy): a 6-digit code after the password.

const cleanCode = (v: string) => v.replace(/\D/g, "").slice(0, 6);

async function verifiedFactor() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp.find((f) => f.status === "verified") ?? null;
}

function CodeInput({ value, onChange, autoFocus = true }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Input
      id="mfa-code"
      autoFocus={autoFocus}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      value={value}
      onChange={(e) => onChange(cleanCode(e.target.value))}
      className="h-12 text-center font-mono text-2xl tracking-[0.4em]"
    />
  );
}

// After the password: asks for the code before anything else is shown.
export function MfaChallenge() {
  const { signOut } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const factor = await verifiedFactor();
      if (!factor) throw new Error("Verifikasi 2 langkah tidak ditemukan. Keluar lalu masuk lagi.");
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (error) throw new Error(/invalid|expired/i.test(error.message) ? "Kode salah atau sudah kedaluwarsa. Coba kode terbaru." : error.message);
    } catch (err) {
      toast.error(errorMessage(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/40 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
          <h1 className="text-xl font-bold">Verifikasi 2 langkah</h1>
          <p className="text-sm text-muted-foreground">Buka aplikasi Authenticator di HP Anda, lalu masukkan 6 angka untuk Balas.id.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mfa-code">Kode verifikasi</Label>
          <CodeInput value={code} onChange={setCode} />
        </div>
        <Button type="submit" className="h-11 w-full" disabled={busy || code.length !== 6}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Masuk
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          HP hilang? Minta admin mereset password Anda; verifikasi 2 langkah ikut dimatikan.
        </p>
        <button type="button" className="mx-auto block text-sm font-medium text-primary" onClick={() => signOut()}>
          Keluar
        </button>
      </form>
    </div>
  );
}

// Status + turning 2FA on (scan QR, confirm a code) or off.
export function MfaSettings({ required = false, onDone }: { required?: boolean; onDone?: () => void }) {
  const { refreshProfile } = useAuth();
  const [state, setState] = useState<"loading" | "off" | "on">("loading");
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setState((await verifiedFactor()) ? "on" : "off");
    } catch (err) {
      toast.error(errorMessage(err));
      setState("off");
    }
  };
  useEffect(() => {
    load();
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      // A setup that was never finished blocks a new one with the same name.
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Balas.id",
        friendlyName: `HP ${new Date().toISOString().slice(0, 16)}`,
      });
      if (error) throw error;
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enroll) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code });
      if (error) throw new Error(/invalid|expired/i.test(error.message) ? "Kode salah. Pastikan jam HP sesuai, lalu coba kode terbaru." : error.message);
      setEnroll(null);
      setState("on");
      toast.success("Verifikasi 2 langkah aktif");
      await refreshProfile();
      onDone?.();
    } catch (err) {
      toast.error(errorMessage(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!window.confirm("Matikan verifikasi 2 langkah? Akun hanya dilindungi password.")) return;
    setBusy(true);
    try {
      const factor = await verifiedFactor();
      if (factor) {
        const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (error) throw error;
      }
      // The session drops back to one step; refresh it so the app keeps working.
      await supabase.auth.refreshSession();
      setState("off");
      toast.success("Verifikasi 2 langkah dimatikan");
      await refreshProfile();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  if (enroll) {
    return (
      <form onSubmit={confirm} className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Pasang <b>Google Authenticator</b> (atau Microsoft Authenticator / Authy) di HP.</li>
          <li>Di aplikasi itu ketuk <b>+</b> lalu <b>Pindai kode QR</b>, arahkan ke kode di bawah.</li>
          <li>Masukkan 6 angka yang muncul untuk Balas.id.</li>
        </ol>
        <div className="flex flex-col items-center gap-2">
          <img src={enroll.qr} alt="Kode QR verifikasi 2 langkah" className="h-48 w-48 rounded-lg border bg-white p-2" />
          <p className="text-center text-xs text-muted-foreground">
            Tidak bisa memindai? Masukkan kode ini manual:
            <br />
            <code className="select-all break-all font-mono text-foreground">{enroll.secret}</code>
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mfa-code">Kode dari aplikasi</Label>
          <CodeInput value={code} onChange={setCode} autoFocus={false} />
        </div>
        <div className="flex gap-2">
          {!required && (
            <Button type="button" variant="outline" className="flex-1" onClick={() => setEnroll(null)}>
              Batal
            </Button>
          )}
          <Button type="submit" className="flex-1" disabled={busy || code.length !== 6}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Aktifkan
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <Smartphone className={state === "on" ? "mt-0.5 h-5 w-5 text-success" : "mt-0.5 h-5 w-5 text-muted-foreground"} />
        <p className="text-sm">
          {state === "on" ? (
            <>
              <b>Aktif.</b> Setiap masuk, selain password diminta kode dari aplikasi Authenticator di HP Anda.
            </>
          ) : (
            <>
              <b>Belum aktif.</b> Tambahkan kode dari HP saat masuk, supaya password yang bocor saja tidak cukup untuk membuka akun.
            </>
          )}
        </p>
      </div>
      {state === "on" ? (
        !required && (
          <Button variant="outline" onClick={turnOff} disabled={busy}>
            Matikan
          </Button>
        )
      ) : (
        <Button onClick={start} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Aktifkan verifikasi 2 langkah
        </Button>
      )}
    </div>
  );
}

// The organization requires 2FA for this role and it is not set up yet.
export function MfaRequired() {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-bold">Aktifkan verifikasi 2 langkah</h1>
          <p className="text-sm text-muted-foreground">Admin organisasi Anda mewajibkannya untuk Admin dan Supervisor. Cukup sekali, sekitar 1 menit.</p>
        </div>
        <MfaSettings required />
        <button type="button" className="text-sm font-medium text-primary" onClick={() => signOut()}>
          Keluar
        </button>
      </div>
    </div>
  );
}
