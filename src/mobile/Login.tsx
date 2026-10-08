import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  if (!loading && user) return <Navigate to="/m/inbox" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) setError(/invalid/i.test(error.message) ? "Email atau kata sandi salah." : error.message);
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#f4f6fb] text-slate-900">
      <div className="space-y-5 rounded-b-[32px] bg-primary px-7 pb-14 pt-[max(env(safe-area-inset-top),56px)]">
        <img src="/brand/balas-icon-192.png" alt="" className="h-14 w-14 rounded-2xl bg-white" />
        <div className="space-y-1.5">
          <h1 className="text-[28px] font-extrabold leading-tight text-white">Balas.id Agen</h1>
          <p className="text-[15px] leading-relaxed text-blue-100">
            Balas chat pelanggan dari mana saja. Masuk dengan akun yang diberikan admin toko Anda.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-4 p-7">
        <div className="space-y-2">
          <label htmlFor="m-email" className="text-sm font-semibold">
            Email
          </label>
          <input
            id="m-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-[52px] w-full rounded-2xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="m-password" className="text-sm font-semibold">
            Kata sandi
          </label>
          <div className="relative">
            <input
              id="m-password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-[52px] w-full rounded-2xl border border-slate-300 bg-white pl-4 pr-14 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
              className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center text-slate-600"
            >
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="flex h-[54px] items-center justify-center rounded-2xl bg-primary text-base font-bold text-white disabled:opacity-70">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Masuk"}
        </button>
        <button type="button" onClick={() => setForgot(!forgot)} className="min-h-[44px] self-center text-sm font-bold text-primary">
          Lupa kata sandi?
        </button>
        {forgot && (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-600">
            Minta admin toko Anda mereset kata sandi dari menu <b>Tim &amp; Agen</b> di Balas.id. Setelah itu masuk dengan kata sandi baru dan
            Anda akan diminta membuat kata sandi sendiri.
          </p>
        )}
      </form>
    </div>
  );
}
