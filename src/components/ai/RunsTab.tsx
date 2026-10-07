import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

const KIND: Record<string, string> = { auto: "Otomatis", suggest: "Saran", test: "Uji coba" };
const STATUS: Record<string, { label: string; className: string }> = {
  replied: { label: "Dijawab", className: "border-success/40 text-success" },
  suggested: { label: "Draf", className: "" },
  handoff: { label: "Ke agen", className: "border-warning/50 text-warning" },
  error: { label: "Gagal", className: "border-destructive/40 text-destructive" },
};

// Recent AI activity: what it answered, when it handed over, errors and token use.
export function RunsTab({ orgId }: { orgId: string }) {
  const { data: runs = [] } = useQuery({
    queryKey: ["ai-runs", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_runs")
        .select("id, kind, status, model, reply, reason, error, input_tokens, output_tokens, latency_ms, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    refetchInterval: 15_000,
  });

  const totals = runs.reduce(
    (acc, r) => ({ input: acc.input + (r.input_tokens ?? 0), output: acc.output + (r.output_tokens ?? 0) }),
    { input: 0, output: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Riwayat AI</CardTitle>
        <CardDescription>
          100 aktivitas terakhir · {totals.input.toLocaleString("id-ID")} token masuk ·{" "}
          {totals.output.toLocaleString("id-ID")} token keluar
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Waktu</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Hasil</TableHead>
              <TableHead>Isi / alasan</TableHead>
              <TableHead className="text-right">Token · detik</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Belum ada aktivitas.
                </TableCell>
              </TableRow>
            )}
            {runs.map((r) => {
              const status = STATUS[r.status] ?? STATUS.error;
              return (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-xs">
                    {new Date(r.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell className="text-xs">
                    {KIND[r.kind] ?? r.kind}
                    <div className="text-muted-foreground">{r.model}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={status.className}>
                      {status.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md text-xs">
                    {r.error ? (
                      <span className="text-destructive">{r.error}</span>
                    ) : (
                      <>
                        {r.reply && <p className="line-clamp-3 whitespace-pre-wrap">{r.reply}</p>}
                        {r.reason && <p className="text-muted-foreground">Alasan: {r.reason}</p>}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                    {r.input_tokens ?? "–"}/{r.output_tokens ?? "–"} · {r.latency_ms ? (r.latency_ms / 1000).toFixed(1) : "–"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
