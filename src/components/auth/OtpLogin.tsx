import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage } from '@/lib/api';
import { toast } from 'sonner';

const OTP_LENGTH = 6;

// Passwordless sign-in: a 6-digit code is emailed to an existing account.
export function OtpLogin() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) {
      toast.error(
        error.message.toLowerCase().includes('signups not allowed')
          ? 'Email ini belum terdaftar. Minta admin menambahkan Anda.'
          : errorMessage(error),
      );
      return;
    }
    setSent(true);
    toast.success(`Kode dikirim ke ${email}`);
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    setBusy(false);
    if (error) toast.error('Kode salah atau sudah kedaluwarsa');
  };

  return (
    <>
      <CardHeader>
        <CardTitle>Masuk dengan kode</CardTitle>
        <CardDescription>Tanpa password: kami kirim kode 6 digit ke email Anda.</CardDescription>
      </CardHeader>
      <CardContent>
        {!sent ? (
          <form onSubmit={sendCode} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp-email">Email</Label>
              <Input
                id="otp-email"
                type="email"
                placeholder="nama@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Kirim kode
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Masukkan kode yang dikirim ke <strong>{email}</strong>.
            </p>
            <div className="flex justify-center">
              <InputOTP maxLength={OTP_LENGTH} value={code} onChange={setCode} autoFocus>
                <InputOTPGroup>
                  {Array.from({ length: OTP_LENGTH }, (_, i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button type="submit" className="w-full" disabled={busy || code.length < OTP_LENGTH}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Masuk
            </Button>
            <div className="flex justify-between text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => sendCode()}>
                Kirim ulang kode
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => {
                  setSent(false);
                  setCode('');
                }}
              >
                Ganti email
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </>
  );
}
