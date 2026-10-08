import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { STATUS_INFO, formatWhen, useSequences } from "./followup";

// Start, watch and stop the follow-up sequence of one chat.
export function ChatFollowup({ conversationId, orgId }: { conversationId: string; orgId: string }) {
  const queryClient = useQueryClient();
  const { data: sequences = [] } = useSequences(orgId);
  const usable = sequences.filter((s) => s.is_active && s.followup_steps.length);
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const { data: latest } = useQuery({
    queryKey: ["chat-followup", conversationId],
    queryFn: async () =>
      (
        await supabase
          .from("followup_enrollments")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
    refetchInterval: 30_000,
  });
  const active = latest?.status === "active" ? latest : null;
  const name = (id: string) => sequences.find((s) => s.id === id)?.name ?? "Follow-up";
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["chat-followup", conversationId] });

  const start = async () => {
    const id = picked || usable[0]?.id;
    if (!id) return;
    setBusy(true);
    const { error } = await supabase.rpc("followup_enroll", { p_conversation_id: conversationId, p_sequence_id: id });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`Follow-up "${name(id)}" dimulai`);
    refresh();
  };
  const stop = async () => {
    if (!active) return;
    setBusy(true);
    const { error } = await supabase.rpc("followup_stop", { p_enrollment_id: active.id });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Follow-up dihentikan");
    refresh();
  };

  if (!sequences.length && !latest) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className={cn("gap-1", active && "border-primary/40 text-primary")}>
          <CalendarClock className="h-4 w-4" />
          {active ? `Follow-up ${active.current_step}/${active.steps_total}` : "Follow-up"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-sm">
        {active ? (
          <>
            <div>
              <p className="font-medium">{name(active.sequence_id)}</p>
              <p className="text-muted-foreground">
                Lapis {active.current_step} dari {active.steps_total} terkirim. Berikutnya: {formatWhen(active.next_send_at)}.
              </p>
              {active.last_error && <p className="mt-1 text-xs text-warning">Percobaan terakhir gagal: {active.last_error}</p>}
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={stop} disabled={busy}>
              Hentikan follow-up
            </Button>
          </>
        ) : (
          <>
            {latest && (
              <p className="rounded-md bg-muted px-2 py-1.5 text-xs">
                Terakhir: {name(latest.sequence_id)} ·{" "}
                {latest.status === "replied"
                  ? `pelanggan membalas setelah lapis ${latest.replied_after_step ?? 0}`
                  : (STATUS_INFO[latest.status]?.label ?? latest.status).toLowerCase()}
                {latest.stop_reason && latest.status !== "replied" ? ` (${latest.stop_reason})` : ""}
              </p>
            )}
            {usable.length ? (
              <>
                <Select value={picked || usable[0].id} onValueChange={setPicked}>
                  <SelectTrigger aria-label="Pilih urutan follow-up">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {usable.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.followup_steps.length} lapis)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" className="w-full" onClick={start} disabled={busy}>
                  Mulai follow-up
                </Button>
                <p className="text-xs text-muted-foreground">Berhenti otomatis begitu pelanggan membalas.</p>
              </>
            ) : (
              <p className="text-muted-foreground">Belum ada urutan aktif. Buat di menu Follow-up.</p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
