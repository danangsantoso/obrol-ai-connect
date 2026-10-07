import { useState } from "react";
import { Bot, Loader2, RotateCcw, Send, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { callFunction, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChatText } from "@/components/chat/ChatText";

interface TestAnswer {
  reply: string;
  handoff: boolean;
  reason: string;
  customer_name: string;
  handoff_message: string;
  sources: { doc_title: string; product_name: string | null }[];
  usage: { input_tokens: number | null; output_tokens: number | null; latency_ms: number };
}

type Turn =
  | { role: "customer"; text: string }
  | { role: "agent"; text: string; answer?: TestAnswer; error?: string };

// Chat with the AI as if you were a customer, using the saved settings and knowledge.
export function PlaygroundTab() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  // The customer's name as a WhatsApp profile would give it; the AI also picks it up from the chat.
  const [customerName, setCustomerName] = useState("");

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = question.trim();
    if (!text) return;
    const history = turns.filter((t) => t.text).map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: "customer", text }]);
    setQuestion("");
    setBusy(true);
    try {
      const answer = await callFunction<TestAnswer>("ai-reply", {
        action: "test",
        question: text,
        history,
        customer_name: customerName.trim() || undefined,
      });
      if (answer.customer_name && !customerName.trim()) setCustomerName(answer.customer_name);
      const shown = answer.handoff ? [answer.reply, answer.handoff_message].filter(Boolean).join("\n\n") : answer.reply;
      setTurns((t) => [...t, { role: "agent", text: shown, answer }]);
    } catch (err) {
      setTurns((t) => [...t, { role: "agent", text: "", error: errorMessage(err) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Uji coba AI</CardTitle>
          <CardDescription>
            Bertanyalah seperti pelanggan. Memakai pengaturan dan pengetahuan yang sudah disimpan; tidak ada pesan yang dikirim
            ke WhatsApp.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setTurns([]);
            setCustomerName("");
          }}
          disabled={!turns.length && !customerName}
        >
          <RotateCcw className="mr-1 h-4 w-4" /> Ulang
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Nama pelanggan (opsional, seperti nama profil WhatsApp)"
            aria-label="Nama pelanggan uji"
            className="h-8 max-w-sm"
          />
        </div>
        <div className="max-h-[480px] min-h-[200px] space-y-3 overflow-y-auto rounded-lg border bg-muted/40 p-4">
          {turns.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">Contoh: "Kak, madu hutan ada garansinya? Ongkir ke Bandung berapa?"</p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={cn("flex gap-2", t.role === "customer" ? "justify-start" : "justify-end")}>
              {t.role === "customer" && <UserRound className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />}
              <div
                className={cn(
                  "max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm",
                  t.role === "customer" ? "bg-card" : "bg-primary text-primary-foreground",
                  t.role === "agent" && t.error && "bg-destructive text-destructive-foreground",
                )}
              >
                {t.role === "agent" && t.error ? (
                  <p>{t.error}</p>
                ) : (
                  <p className="whitespace-pre-wrap" data-testid={t.role === "agent" ? "ai-answer" : undefined}>
                    <ChatText text={t.text} />
                  </p>
                )}
                {t.role === "agent" && t.answer && (
                  <div className="mt-2 space-y-1 border-t border-primary-foreground/20 pt-2 text-xs opacity-90">
                    {t.answer.handoff && (
                      <Badge variant="secondary" className="mr-1">Diserahkan ke agen: {t.answer.reason || "-"}</Badge>
                    )}
                    <p>
                      Sumber:{" "}
                      {t.answer.sources.length
                        ? t.answer.sources.map((s) => (s.product_name ? `${s.product_name} › ${s.doc_title}` : s.doc_title)).join(", ")
                        : "katalog saja"}
                    </p>
                    <p>
                      {(t.answer.usage.latency_ms / 1000).toFixed(1)} dtk · {t.answer.usage.input_tokens ?? "?"} token masuk ·{" "}
                      {t.answer.usage.output_tokens ?? "?"} token keluar
                    </p>
                  </div>
                )}
              </div>
              {t.role === "agent" && <Bot className="mt-1 h-5 w-5 shrink-0 text-primary" />}
            </div>
          ))}
          {busy && (
            <div className="flex justify-end">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
        </div>
        <form onSubmit={ask} className="flex gap-2">
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Tulis pertanyaan pelanggan…" aria-label="Pertanyaan uji" />
          <Button type="submit" disabled={busy || !question.trim()}>
            <Send className="mr-1 h-4 w-4" /> Kirim
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
