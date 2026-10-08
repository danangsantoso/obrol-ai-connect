import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { callFunction, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { pushSupported, subscribeWebPush, unsubscribeWebPush, webPushSubscribed } from "@/lib/webpush";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

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
    webPushSubscribed().then(setSubscribed);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!profile) return null;

  const enable = async () => {
    setBusy(true);
    try {
      await subscribeWebPush(profile.id);
      setSubscribed(true);
      toast.success("Notifikasi aktif di perangkat ini");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPermission(typeof Notification !== "undefined" ? Notification.permission : "denied");
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    try {
      await unsubscribeWebPush();
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
