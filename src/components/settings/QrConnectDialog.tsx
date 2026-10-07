import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { callFunction, errorMessage } from "@/lib/api";
import { normalizePhone } from "@/lib/csv";

export interface QrState {
  status: "disconnected" | "connecting" | "connected";
  phone: string | null;
  qr: { base64: string | null; pairingCode: string | null } | null;
}

const POLL_MS = 4000;

interface Props {
  channel: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}

// Shows the QR code of a QR channel (refreshed while open) or a pairing code
// for linking from WhatsApp → Perangkat tertaut on the phone.
export function QrConnectDialog({ channel, onOpenChange, onConnected }: Props) {
  const [state, setState] = useState<QrState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [requesting, setRequesting] = useState(false);
  const busy = useRef(false);
  // Keeps the content in place while the dialog animates closed.
  const [shown, setShown] = useState(channel);
  if (channel && channel !== shown) setShown(channel);

  const poll = useCallback(
    async (withPhone?: string) => {
      if (!channel || busy.current) return;
      busy.current = true;
      try {
        const next = await callFunction<QrState>("wa-qr", {
          action: "connect",
          channel_id: channel.id,
          ...(withPhone ? { phone: withPhone } : {}),
        });
        setState(next);
        setError(null);
        if (next.status === "connected") onConnected();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        busy.current = false;
      }
    },
    [channel, onConnected],
  );

  useEffect(() => {
    if (!channel) return;
    setState(null);
    setError(null);
    setPhone("");
    poll();
    const timer = setInterval(() => poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [channel, poll]);

  const connected = state?.status === "connected";

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequesting(true);
    // Wait for a poll already in flight so the code request is not skipped.
    while (busy.current) await new Promise((r) => setTimeout(r, 200));
    await poll(normalizePhone(phone) ?? phone);
    setRequesting(false);
  };

  return (
    <Dialog open={channel !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hubungkan {shown?.name}</DialogTitle>
          <DialogDescription>
            Di HP: buka WhatsApp → <b>Perangkat tertaut</b> → <b>Tautkan perangkat</b>.
          </DialogDescription>
        </DialogHeader>

        {connected ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-success" />
            <p className="font-medium">Terhubung{state?.phone ? ` ke ${state.phone}` : ""}</p>
            <p className="text-sm text-muted-foreground">Chat yang masuk ke nomor ini akan muncul di Inbox.</p>
            <Button className="mt-2" onClick={() => onOpenChange(false)}>
              Selesai
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="qr">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="qr">Scan QR</TabsTrigger>
              <TabsTrigger value="code">Kode tautan</TabsTrigger>
            </TabsList>
            <TabsContent value="qr" className="flex flex-col items-center gap-3 pt-2">
              {state?.qr?.base64 ? (
                <img src={state.qr.base64} alt="QR code WhatsApp" className="h-64 w-64 rounded-md border" />
              ) : (
                <div className="flex h-64 w-64 items-center justify-center rounded-md border bg-muted">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              <p className="text-center text-xs text-muted-foreground">
                QR diperbarui otomatis. Arahkan kamera HP ke kode ini.
              </p>
            </TabsContent>
            <TabsContent value="code" className="space-y-3 pt-2">
              <form onSubmit={requestCode} className="space-y-2">
                <Label htmlFor="qr-phone">Nomor WhatsApp yang akan dihubungkan</Label>
                <div className="flex gap-2">
                  <Input
                    id="qr-phone"
                    inputMode="tel"
                    placeholder="0812 3456 7890"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                  <Button type="submit" disabled={requesting}>
                    {requesting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    Minta kode
                  </Button>
                </div>
              </form>
              {state?.qr?.pairingCode && (
                <div className="rounded-md border bg-muted p-4 text-center">
                  <p className="font-mono text-2xl font-semibold tracking-widest">{state.qr.pairingCode}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Di HP pilih <b>Tautkan dengan nomor telepon saja</b>, lalu masukkan kode ini.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        {error && !connected && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
