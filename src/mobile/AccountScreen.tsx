import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Camera, ChevronRight, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, callFunction, errorMessage } from "@/lib/api";
import { pushSupported, subscribeWebPush, webPushSubscribed } from "@/lib/webpush";
import { cn } from "@/lib/utils";
import { askNotificationPermission, isNativeApp, notificationPermission, registerNativePush, unregisterNativePush, type PermissionState } from "./native";
import { Avatar, BottomNav, Screen, Section } from "./ui";

const STATUSES = [
  { value: "online", label: "Online", dot: "bg-green-600", help: "Anda menerima chat baru dari rotasi dan bisa mengambil chat di Antrean." },
  { value: "away", label: "Istirahat", dot: "bg-amber-500", help: "Tidak menerima chat baru dari rotasi. Chat Anda tetap aman dan notifikasi tetap masuk." },
  { value: "offline", label: "Offline", dot: "bg-slate-400", help: "Tidak menerima chat baru. Chat yang belum Anda balas boleh diambil agen lain." },
] as const;

function useTodayStats(userId: string) {
  return useQuery({
    queryKey: ["m-today", userId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const [{ data: sent }, { count: open }] = await Promise.all([
        supabase.from("messages").select("conversation_id").eq("sender_id", userId).eq("direction", "outbound").gte("created_at", start.toISOString()).limit(5000),
        supabase.from("conversations").select("id", { count: "exact", head: true }).eq("assignee_id", userId).neq("status", "resolved"),
      ]);
      return { messages: sent?.length ?? 0, chats: new Set((sent ?? []).map((m) => m.conversation_id)).size, open: open ?? 0 };
    },
  });
}

export default function AccountScreen() {
  const { profile, refreshProfile, signOut } = useAuth();
  const me = profile!;
  const [status, setStatus] = useState(me.status);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: stats } = useTodayStats(me.id);
  const native = isNativeApp();

  useEffect(() => {
    notificationPermission().then(setPermission);
    if (!native) webPushSubscribed().then(setSubscribed);
  }, [native]);

  const pick = async (value: typeof me.status) => {
    setStatus(value);
    const { error } = await supabase.from("profiles").update({ status: value }).eq("id", me.id);
    if (error) {
      setStatus(me.status);
      return toast.error(errorMessage(error));
    }
    refreshProfile();
  };

  const enable = async () => {
    setBusy(true);
    try {
      if (native) {
        const p = await askNotificationPermission();
        setPermission(p);
        if (p !== "granted") throw new Error("Izin notifikasi ditolak. Aktifkan di Pengaturan HP → Aplikasi → Balas.id → Notifikasi.");
        if (!(await registerNativePush())) throw new Error("HP ini belum bisa didaftarkan untuk notifikasi. Coba lagi nanti.");
      } else {
        await subscribeWebPush(me.id);
        setPermission("granted");
      }
      setSubscribed(true);
      toast.success("Notifikasi aktif di HP ini");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    try {
      await callFunction("push", { action: "test" });
      toast.success("Notifikasi tes dikirim");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const logout = async () => {
    if (!window.confirm("Keluar dari Balas.id di HP ini?")) return;
    await unregisterNativePush().catch(() => undefined);
    await signOut();
  };

  const notifOn = native ? permission === "granted" : subscribed;
  const help = STATUSES.find((s) => s.value === status)?.help;

  return (
    <Screen
      header={
        <header className="flex items-center gap-3.5 border-b border-slate-200 bg-white px-5 pb-4 pt-[max(env(safe-area-inset-top),20px)]">
          <Link to="/m/akun/profil" aria-label="Ubah foto profil" className="relative shrink-0">
            <Avatar name={me.full_name || me.email} url={me.avatar_url} size={56} seed={me.id} />
            <span className="absolute -bottom-1 -right-1 flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-white bg-primary">
              <Camera className="h-3.5 w-3.5 text-white" />
            </span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-extrabold">{me.full_name || me.email}</p>
            <p className="truncate text-[13px] text-slate-600">{ROLE_LABELS[me.role]} · {me.email}</p>
          </div>
          <Link to="/m/akun/profil" className="flex min-h-[44px] items-center rounded-xl border border-slate-300 px-3 text-[13px] font-bold">
            Ubah profil
          </Link>
        </header>
      }
      footer={<BottomNav />}
    >
      <div className="space-y-3 p-4">
        <Section title="Status saya">
          <div role="radiogroup" aria-label="Status saya" className="grid grid-cols-3 gap-2">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={status === s.value}
                onClick={() => pick(s.value)}
                className={cn(
                  "flex min-h-[48px] items-center justify-center gap-2 rounded-xl text-[13px] font-bold",
                  status === s.value ? "border-2 border-primary bg-blue-50" : "border border-slate-300",
                )}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", s.dot)} />
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[13px] leading-relaxed text-slate-600">{help}</p>
        </Section>

        <Section title="Hari ini">
          <div className="grid grid-cols-3 gap-2">
            <Stat value={stats?.chats} label="chat dibalas" />
            <Stat value={stats?.messages} label="pesan terkirim" />
            <Stat value={stats?.open} label="chat aktif saya" />
          </div>
        </Section>

        <Section title="Notifikasi di HP ini">
          {!native && !pushSupported() ? (
            <p className="text-[13px] leading-relaxed text-slate-600">
              Browser ini belum mendukung notifikasi. Di iPhone: buka Balas.id di Safari, ketuk Bagikan → <b>Tambah ke Layar Utama</b>, lalu
              buka dari ikonnya.
            </p>
          ) : notifOn ? (
            <>
              <p className="flex items-center gap-2 text-[13px] font-semibold text-green-800">
                <BellRing className="h-4 w-4" /> Aktif
              </p>
              <p className="text-[13px] leading-relaxed text-slate-600">
                HP berbunyi saat pelanggan membalas chat Anda, ada chat baru untuk Anda, AI butuh bantuan tim, atau Anda disebut di catatan.
              </p>
              <button onClick={test} className="min-h-[44px] w-full rounded-xl border border-slate-300 text-sm font-bold">
                Kirim notifikasi tes
              </button>
            </>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-slate-600">
                {permission === "denied"
                  ? "Notifikasi diblokir. Aktifkan di Pengaturan HP → Aplikasi → Balas.id → Notifikasi, lalu ketuk tombol di bawah."
                  : "Aktifkan agar tidak ada chat pelanggan yang terlewat."}
              </p>
              <button onClick={enable} disabled={busy} className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-primary text-sm font-bold text-white">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aktifkan notifikasi"}
              </button>
            </>
          )}
        </Section>

        <Link to="/m/akun/kata-sandi" className="flex min-h-[52px] items-center gap-3 rounded-2xl bg-white px-4">
          <KeyRound className="h-5 w-5 text-slate-700" />
          <span className="flex-1 text-[15px] font-semibold">Ganti kata sandi</span>
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </Link>
        <button onClick={logout} className="min-h-[50px] w-full rounded-2xl border border-red-200 bg-white text-[15px] font-bold text-red-700">
          Keluar
        </button>
        <p className="pb-2 text-center text-xs text-slate-500">Balas.id Agen{native ? " · Android" : ""}</p>
      </div>
    </Screen>
  );
}

function Stat({ value, label }: { value?: number; label: string }) {
  return (
    <div>
      <p className="text-[22px] font-extrabold">{value ?? "–"}</p>
      <p className="text-xs text-slate-600">{label}</p>
    </div>
  );
}
