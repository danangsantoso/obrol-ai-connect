import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Facebook, Instagram, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { callFunction, errorMessage } from "@/lib/api";
import { toast } from "sonner";

interface FoundPage {
  id: string;
  name: string;
  messenger: "here" | "elsewhere" | null;
  instagram: { id: string; username: string | null; avatar: string | null; connected: "here" | "elsewhere" | null } | null;
}

type Picks = Record<string, { messenger: boolean; instagram: boolean }>;

// "Login with Facebook" for Messenger and Instagram: the button sends the admin
// to Facebook; on return (?social=<state>) the admin picks Pages to connect.
export function SocialConnect({ onConnected }: { onConnected: () => void }) {
  const [params, setParams] = useSearchParams();
  const [starting, setStarting] = useState(false);
  const [state, setState] = useState<string | null>(null);
  const [pages, setPages] = useState<FoundPage[] | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const failed = params.get("social_error");
    const returned = params.get("social");
    if (!failed && !returned) return;
    if (failed) toast.error(`Login Facebook: ${failed}`);
    if (returned) setState(returned);
    const next = new URLSearchParams(params);
    next.delete("social");
    next.delete("social_error");
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (!state) return;
    callFunction<{ pages: FoundPage[] }>("social-oauth", { action: "pages", state })
      .then(({ pages }) => {
        setPages(pages);
        setPicks(
          Object.fromEntries(
            pages.map((p) => [p.id, { messenger: p.messenger === null, instagram: Boolean(p.instagram) && p.instagram?.connected === null }]),
          ),
        );
      })
      .catch((err) => {
        toast.error(errorMessage(err));
        setState(null);
      });
  }, [state]);

  const start = async () => {
    setStarting(true);
    try {
      const { url } = await callFunction<{ url: string }>("social-oauth", { action: "start" });
      window.location.assign(url);
    } catch (err) {
      toast.error(errorMessage(err));
      setStarting(false);
    }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const items = Object.entries(picks).map(([page_id, p]) => ({ page_id, ...p }));
      const { connected } = await callFunction<{ connected: number }>("social-oauth", { action: "connect", state, items });
      toast.success(`${connected} akun terhubung`);
      setState(null);
      setPages(null);
      onConnected();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setConnecting(false);
    }
  };

  const toggle = (id: string, key: "messenger" | "instagram", value: boolean) =>
    setPicks((p) => ({ ...p, [id]: { ...p[id], [key]: value } }));
  const anyPicked = Object.values(picks).some((p) => p.messenger || p.instagram);

  return (
    <div className="max-w-3xl space-y-2 rounded-lg border p-4">
      <p className="font-medium">Facebook Messenger & Instagram</p>
      <p className="text-sm text-muted-foreground">
        Login dengan akun Facebook yang mengelola Halaman bisnis Anda, lalu pilih Halaman dan akun Instagram Bisnis yang
        tertaut. Pesan masuk ke Inbox yang sama.
      </p>
      <Button type="button" onClick={start} disabled={starting} className="bg-[#1877F2] hover:bg-[#1877F2]/90">
        {starting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Facebook className="mr-1 h-4 w-4" />}
        Hubungkan dengan Facebook
      </Button>

      <Dialog open={state !== null} onOpenChange={(o) => { if (!o) { setState(null); setPages(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pilih akun yang dihubungkan</DialogTitle>
            <DialogDescription>Halaman Facebook (Messenger) dan akun Instagram Bisnis yang tertaut ke Halaman itu.</DialogDescription>
          </DialogHeader>
          {!pages ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          ) : pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tidak ada Halaman. Pastikan akun Facebook ini admin sebuah Halaman dan izin Halaman dicentang saat login.
            </p>
          ) : (
            <div className="max-h-80 space-y-3 overflow-y-auto">
              {pages.map((p) => (
                <div key={p.id} className="space-y-2 rounded-md border p-3">
                  <p className="font-medium">{p.name}</p>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={picks[p.id]?.messenger ?? false}
                      disabled={p.messenger === "elsewhere"}
                      onCheckedChange={(v) => toggle(p.id, "messenger", v === true)}
                      aria-label={`Messenger ${p.name}`}
                    />
                    <Facebook className="h-4 w-4 text-[#1877F2]" /> Messenger
                    {p.messenger === "here" && <span className="text-xs text-muted-foreground">(sudah terhubung, perbarui)</span>}
                    {p.messenger === "elsewhere" && <span className="text-xs text-destructive">(dipakai organisasi lain)</span>}
                  </label>
                  {p.instagram ? (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={picks[p.id]?.instagram ?? false}
                        disabled={p.instagram.connected === "elsewhere"}
                        onCheckedChange={(v) => toggle(p.id, "instagram", v === true)}
                        aria-label={`Instagram ${p.name}`}
                      />
                      <Instagram className="h-4 w-4 text-[#E1306C]" /> Instagram {p.instagram.username ? `@${p.instagram.username}` : ""}
                      {p.instagram.connected === "here" && <span className="text-xs text-muted-foreground">(sudah terhubung, perbarui)</span>}
                      {p.instagram.connected === "elsewhere" && <span className="text-xs text-destructive">(dipakai organisasi lain)</span>}
                    </label>
                  ) : (
                    <p className="text-xs text-muted-foreground">Tidak ada akun Instagram Bisnis yang tertaut ke Halaman ini.</p>
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button onClick={connect} disabled={!anyPicked || connecting}>
              {connecting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Hubungkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
