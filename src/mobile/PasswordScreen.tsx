import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { callFunction, errorMessage } from "@/lib/api";
import { Screen } from "./ui";

export default function PasswordScreen() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Kata sandi minimal 8 karakter");
    if (password !== confirm) return toast.error("Kedua kata sandi tidak sama");
    setBusy(true);
    try {
      await callFunction("member-password", { action: "change", password });
      toast.success("Kata sandi diganti");
      navigate("/m/akun");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back="/m/akun" title="Ganti kata sandi">
      <form onSubmit={submit} className="space-y-4 px-5 py-6">
        <div className="space-y-2">
          <label htmlFor="m-new-pw" className="text-sm font-semibold">
            Kata sandi baru
          </label>
          <input
            id="m-new-pw"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-[52px] w-full rounded-2xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-primary"
          />
          <p className="text-xs text-slate-600">Minimal 8 karakter.</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="m-new-pw2" className="text-sm font-semibold">
            Ulangi kata sandi baru
          </label>
          <input
            id="m-new-pw2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-[52px] w-full rounded-2xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-primary"
          />
        </div>
        <button type="submit" disabled={busy} className="flex h-[54px] w-full items-center justify-center rounded-2xl bg-primary text-base font-bold text-white">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Simpan kata sandi"}
        </button>
      </form>
    </Screen>
  );
}
