import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { callFunction, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64url: string) {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
const toB64url = (buf: ArrayBuffer | null) =>
  buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "";

// Push notifications on this device (phone or computer), and installing the app.
export function PushControl() {
  const { profile } = useAuth();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const [busy, setBusy] = useState(false);
  const [install, setInstall] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if (pushSupported()) {
      navigator.serviceWorker.getRegistration().then(async (reg) => setSubscribed(Boolean(await reg?.pushManager.getSubscription())));
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!profile) return null;

  const enable = async () => {
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") throw new Error("Izin notifikasi ditolak di browser. Aktifkan di pengaturan situs.");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const { public_key } = await callFunction<{ public_key: string }>("push", { action: "public_key" });
      const sub = (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key) }));
      const { error } = await supabase.from("push_subscriptions").upsert(
        { user_id: profile.id, endpoint: sub.endpoint, p256dh: toB64url(sub.getKey("p256dh")), auth: toB64url(sub.getKey("auth")), user_agent: navigator.userAgent.slice(0, 300) },
        { onConflict: "endpoint" },
      );
      if (error) throw error;
      setSubscribed(true);
      toast.success("Notifikasi aktif di perangkat ini");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Notifikasi dimatikan di perangkat ini");
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

  const on = subscribed === true;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifikasi" className={cn(!on && "text-muted-foreground")}>
          {on ? <BellRing className="h-5 w-5 text-primary" /> : <Bell className="h-5 w-5" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-sm">
        <div>
          <p className="font-medium">Notifikasi di perangkat ini</p>
          <p className="text-muted-foreground">
            Pemberitahuan saat ada pesan di chat Anda, chat baru untuk Anda, AI butuh bantuan, atau Anda disebut di catatan, walau Balas.id
            sedang ditutup.
          </p>
        </div>
        {!pushSupported() ? (
          <p className="rounded-md bg-muted p-2 text-xs">
            Browser ini belum mendukung notifikasi push. Di iPhone/iPad: buka Balas.id di Safari, ketuk Bagikan → "Tambah ke Layar Utama",
            lalu buka dari ikonnya.
          </p>
        ) : on ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={test}>
              Kirim tes
            </Button>
            <Button size="sm" variant="ghost" onClick={disable} disabled={busy}>
              <BellOff className="mr-1 h-4 w-4" /> Matikan
            </Button>
          </div>
        ) : (
          <>
            <Button size="sm" className="w-full" onClick={enable} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <BellRing className="mr-1 h-4 w-4" />} Aktifkan notifikasi
            </Button>
            {permission === "denied" && <p className="text-xs text-danger">Notifikasi diblokir browser. Izinkan di pengaturan situs, lalu coba lagi.</p>}
          </>
        )}
        {install && (
          <Button size="sm" variant="outline" className="w-full" onClick={() => install.prompt().then(() => setInstall(null))}>
            <Download className="mr-1 h-4 w-4" /> Pasang aplikasi Balas.id
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
