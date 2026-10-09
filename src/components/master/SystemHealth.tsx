import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { AlertTriangle, Bug, Check, CheckCircle2, CloudUpload, HardDrive, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface StatusRow {
  key: string;
  ok: boolean;
  detail: Record<string, unknown>;
  checked_at: string;
  changed_at: string;
}

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: localeId });
const SOURCE_LABEL: Record<string, string> = { web: "Web", mobile: "Aplikasi HP", function: "Server" };

function bytes(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return v > 1e9 ? `${(v / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(v / 1e6))} MB`;
}

function Tile({ tone, icon: Icon, title, children }: { tone: "ok" | "bad" | "idle"; icon: typeof HardDrive; title: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border p-4",
        tone === "ok" && "border-success/30 bg-success/5",
        tone === "bad" && "border-danger/40 bg-danger/5",
        tone === "idle" && "border-warning/40 bg-warning/5",
      )}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", tone === "ok" ? "text-success" : tone === "bad" ? "text-danger" : "text-warning")} />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}

function BackupTile({ row }: { row?: StatusRow }) {
  if (!row) {
    return (
      <Tile tone="idle" icon={CloudUpload} title="Backup: belum ada catatan">
        <p className="text-muted-foreground">
          Backup harian berjalan pukul 02:15. Untuk menyalin ke Google Drive jalankan di server:{" "}
          <code className="rounded bg-muted px-1">sudo ./deploy/scripts/setup-backup.sh</code>
        </p>
      </Tile>
    );
  }
  const d = row.detail;
  const stale = Date.now() - new Date(row.checked_at).getTime() > 36 * 3600_000;
  if (!row.ok) {
    return (
      <Tile tone="bad" icon={CloudUpload} title="Backup terakhir GAGAL">
        <p>{String(d.error ?? "")} · {ago(row.checked_at)}</p>
        <p className="text-muted-foreground">Lihat /var/log/balas-backup.log di server.</p>
      </Tile>
    );
  }
  return (
    <Tile tone={stale ? "bad" : d.uploaded ? "ok" : "idle"} icon={CloudUpload} title={stale ? "Backup terlambat" : "Backup berhasil"}>
      <p>
        {ago(row.checked_at)} · {bytes(d.size_bytes)}
      </p>
      <p className="text-muted-foreground">
        {d.uploaded
          ? `Tersalin ke ${String(d.remote).replace(/:$/, "") === "gdrive" ? "Google Drive" : String(d.remote)}${d.encrypted ? " (terenkripsi)" : ""}`
          : "Hanya tersimpan di VPS. Jalankan setup-backup.sh agar tersalin ke Google Drive."}
      </p>
    </Tile>
  );
}

function WatchdogTile({ row }: { row?: StatusRow }) {
  const stale = !row || Date.now() - new Date(row.checked_at).getTime() > 15 * 60_000;
  if (stale) {
    return (
      <Tile tone="idle" icon={HardDrive} title="Pemantau server tidak aktif">
        <p className="text-muted-foreground">
          {row ? `Pemeriksaan terakhir ${ago(row.checked_at)}.` : "Belum pernah berjalan."} Jalankan deploy ulang agar jadwal pemantau terpasang.
        </p>
      </Tile>
    );
  }
  const problems = (row.detail.problems as string[] | undefined) ?? [];
  return (
    <Tile tone={row.ok ? "ok" : "bad"} icon={HardDrive} title={row.ok ? "Server normal" : "Server bermasalah"}>
      {problems.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <p className="text-muted-foreground">
        Diperiksa {ago(row.checked_at)}
        {row.detail.disk_used_percent != null && ` · disk ${String(row.detail.disk_used_percent)}% terpakai`}
        {!row.ok && ` · sejak ${ago(row.changed_at)}`}
      </p>
    </Tile>
  );
}

export function SystemHealthCard() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["system-status"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("system_status").select("*");
      if (error) throw error;
      return new Map((data as StatusRow[]).map((r) => [r.key, r]));
    },
  });
  const errors = useQuery({
    queryKey: ["app-errors"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_errors")
        .select("id, source, message, detail, url, occurrences, first_seen, last_seen, resolved_at")
        .is("resolved_at", null)
        .order("last_seen", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  const resolve = async (id: number) => {
    const { error } = await supabase.rpc("resolve_app_error", { p_id: id });
    if (error) toast.error(errorMessage(error));
    else qc.invalidateQueries({ queryKey: ["app-errors"] });
  };

  const open = errors.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" /> Kesehatan sistem
        </CardTitle>
        <CardDescription>
          Backup, kondisi server, dan error aplikasi. Masalah baru dikirim sebagai notifikasi ke Master Admin (aktifkan lonceng di atas).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <BackupTile row={status.data?.get("backup")} />
            <WatchdogTile row={status.data?.get("watchdog")} />
          </div>
        )}

        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Bug className="h-4 w-4" /> Error aplikasi {open.length > 0 && <Badge variant="destructive">{open.length}</Badge>}
          </p>
          {errors.isLoading ? null : open.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Tidak ada error yang belum ditangani.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {open.map((e) => (
                <li key={e.id} className="flex items-start gap-3 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <details className="min-w-0 flex-1">
                    <summary className="cursor-pointer list-none">
                      <span className="break-words font-medium">{e.message}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {SOURCE_LABEL[e.source] ?? e.source} · {e.occurrences}× · terakhir {ago(e.last_seen)}
                        {e.url && ` · ${e.url}`}
                      </span>
                    </summary>
                    {e.detail && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{e.detail}</pre>}
                  </details>
                  <Button size="sm" variant="outline" onClick={() => resolve(e.id)}>
                    <Check className="mr-1 h-4 w-4" /> Selesai
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
