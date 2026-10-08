import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { toast } from "sonner";

interface Gap {
  id: string;
  question: string;
  times_asked: number;
  last_asked_at: string;
  conversation_id: string | null;
  status: string;
}

// Questions customers asked that the AI had no data for. Answering one adds a
// small knowledge document the AI uses from then on.
export function GapsTab({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [answering, setAnswering] = useState<Gap | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: gaps = [] } = useQuery({
    queryKey: ["knowledge-gaps", orgId],
    queryFn: async () =>
      ((await supabase.from("knowledge_gaps").select("*").order("times_asked", { ascending: false }).order("last_asked_at", { ascending: false }).limit(200)).data ?? []) as Gap[],
  });
  const open = gaps.filter((g) => g.status === "open");
  const done = gaps.filter((g) => g.status === "answered").length;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["knowledge-gaps", orgId] });

  const save = async () => {
    if (!answering || !answer.trim()) return;
    setBusy(true);
    try {
      const { data: doc, error } = await supabase
        .from("knowledge_docs")
        .insert({ organization_id: orgId, title: `FAQ: ${answering.question}`.slice(0, 200), content: `Pertanyaan: ${answering.question}\nJawaban: ${answer.trim()}` })
        .select()
        .single();
      if (error) throw error;
      const { error: gapError } = await supabase.from("knowledge_gaps").update({ status: "answered", answer_doc_id: doc.id }).eq("id", answering.id);
      if (gapError) throw gapError;
      toast.success("Jawaban ditambahkan ke pengetahuan AI");
      setAnswering(null);
      setAnswer("");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["knowledge-docs", orgId] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async (g: Gap) => {
    const { error } = await supabase.from("knowledge_gaps").update({ status: "dismissed" }).eq("id", g.id);
    if (error) return toast.error(errorMessage(error));
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pertanyaan yang belum terjawab</CardTitle>
        <CardDescription>
          Pertanyaan pelanggan yang tidak bisa dijawab AI karena datanya belum ada. Tambahkan jawabannya agar AI bisa menjawab
          sendiri lain kali. {done > 0 && `${done} pertanyaan sudah dijawab.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {open.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" /> Tidak ada pertanyaan yang menunggu jawaban.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pertanyaan</TableHead>
                <TableHead className="text-right">Ditanyakan</TableHead>
                <TableHead>Terakhir</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {open.map((g) => (
                <TableRow key={g.id} data-testid="gap-row">
                  <TableCell className="font-medium">{g.question}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{g.times_asked}×</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{new Date(g.last_asked_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {g.conversation_id && (
                      <Button asChild variant="ghost" size="icon" aria-label="Buka chat">
                        <Link to={`/inbox/${g.conversation_id}`}>
                          <MessageSquare className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setAnswering(g)}>
                      Jawab
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dismiss(g)}>
                      Abaikan
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={!!answering} onOpenChange={(o) => !o && setAnswering(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Jawab untuk AI</DialogTitle>
            <DialogDescription>{answering?.question}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="gap-answer">Jawaban</Label>
            <Textarea id="gap-answer" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Bisa, COD tersedia untuk area Jabodetabek dengan biaya tambahan Rp5.000." />
            <p className="text-xs text-muted-foreground">Disimpan sebagai dokumen pengetahuan "FAQ" dan langsung dipakai AI.</p>
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={busy || !answer.trim()}>
              Simpan jawaban
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
