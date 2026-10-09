import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, addHours, format, nextMonday, setHours, setMinutes, startOfMinute } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { AlarmClock, CalendarClock, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Snoozing chats and scheduling messages: both pick a moment in the future.

const at = (d: Date, h: number) => setMinutes(setHours(startOfMinute(d), h), 0);

function presets(now = new Date()) {
  const list = [
    { label: '1 jam lagi', when: addHours(startOfMinute(now), 1) },
    { label: '3 jam lagi', when: addHours(startOfMinute(now), 3) },
  ];
  if (now.getHours() < 15) list.push({ label: 'Sore ini 16.00', when: at(now, 16) });
  list.push({ label: 'Besok 09.00', when: at(addDays(now, 1), 9) });
  list.push({ label: 'Senin 09.00', when: at(nextMonday(now), 9) });
  return list;
}

export const formatWhen = (iso: string | Date) => format(new Date(iso), 'EEE d MMM, HH.mm', { locale: localeId });
const localInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

export const isSnoozed = (c: { snoozed_until: string | null }, now = Date.now()) =>
  Boolean(c.snoozed_until && new Date(c.snoozed_until).getTime() > now);

function WhenPicker({ title, action, onPick, busy }: { title: string; action: string; onPick: (when: Date) => void; busy: boolean }) {
  const [custom, setCustom] = useState(localInput(addHours(new Date(), 2)));
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{title}</p>
      <div className="grid gap-1">
        {presets().map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={busy}
            onClick={() => onPick(p.when)}
            className="flex items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
          >
            <span>{p.label}</span>
            <span className="text-xs text-muted-foreground">{formatWhen(p.when)}</span>
          </button>
        ))}
      </div>
      <div className="space-y-1 border-t pt-2">
        <label htmlFor="when-custom" className="text-xs text-muted-foreground">
          Pilih tanggal & jam
        </label>
        <div className="flex gap-2">
          <Input id="when-custom" type="datetime-local" value={custom} min={localInput(new Date())} onChange={(e) => setCustom(e.target.value)} />
          <Button size="sm" disabled={busy || !custom} onClick={() => onPick(new Date(custom))}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : action}
          </Button>
        </div>
      </div>
    </div>
  );
}

// "Tunda": the chat leaves the lists until the chosen time, then comes back
// with a reminder (or earlier when the customer writes).
export function SnoozeButton({
  conversation,
  onChanged,
  className,
}: {
  conversation: { id: string; snoozed_until: string | null };
  onChanged: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const snoozed = isSnoozed(conversation);

  const snooze = async (until: Date | null) => {
    setBusy(true);
    const { error } = await supabase.rpc('snooze_conversation', { p_conversation: conversation.id, p_until: until?.toISOString() ?? null });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(until ? `Chat ditunda sampai ${formatWhen(until)}. Anda akan diingatkan.` : 'Penundaan dibatalkan');
    setOpen(false);
    onChanged();
  };

  if (snoozed) {
    return (
      <Button size="sm" variant="outline" className={cn('gap-1 border-warning/50 text-warning', className)} onClick={() => snooze(null)} disabled={busy} title="Batalkan penundaan">
        <AlarmClock className="h-4 w-4" />
        Ditunda s/d {formatWhen(conversation.snoozed_until!)}
        <X className="h-3.5 w-3.5" />
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className={cn('gap-1', className)} title="Ingatkan saya nanti">
          <AlarmClock className="h-4 w-4" />
          Tunda
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <WhenPicker title="Ingatkan saya untuk chat ini" action="Tunda" onPick={snooze} busy={busy} />
        <p className="mt-2 text-xs text-muted-foreground">Chat pindah ke tab Ditunda. Bila pelanggan membalas lebih dulu, chat langsung kembali.</p>
      </PopoverContent>
    </Popover>
  );
}

type Scheduled = { id: string; body: string | null; send_at: string; status: string; error: string | null; created_by: string | null };

function useScheduled(conversationId: string) {
  return useQuery({
    queryKey: ['scheduled-messages', conversationId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scheduled_messages')
        .select('id, body, send_at, status, error, created_by')
        .eq('conversation_id', conversationId)
        .in('status', ['pending', 'sending', 'failed'])
        .gte('send_at', addDays(new Date(), -2).toISOString())
        .order('send_at');
      if (error) throw error;
      return data as Scheduled[];
    },
  });
}

// Clock button next to "send": the typed text goes out at the chosen time.
export function ScheduleButton({
  conversationId,
  orgId,
  userId,
  text,
  disabled,
  onScheduled,
}: {
  conversationId: string;
  orgId: string;
  userId: string;
  text: string;
  disabled: boolean;
  onScheduled: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const schedule = async (when: Date) => {
    if (when.getTime() < Date.now() + 60_000) return toast.error('Pilih waktu minimal 1 menit dari sekarang');
    setBusy(true);
    const { error } = await supabase.from('scheduled_messages').insert({
      organization_id: orgId,
      conversation_id: conversationId,
      created_by: userId,
      body: text.trim(),
      send_at: when.toISOString(),
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`Pesan dijadwalkan ${formatWhen(when)}`);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ['scheduled-messages', conversationId] });
    onScheduled();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" disabled={disabled} aria-label="Jadwalkan pesan" title="Kirim nanti">
          <CalendarClock className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <WhenPicker title="Kirim pesan ini nanti" action="Jadwalkan" onPick={schedule} busy={busy} />
      </PopoverContent>
    </Popover>
  );
}

// Messages waiting to be sent (or that failed) above the composer.
export function ScheduledList({ conversationId, meId, canManage }: { conversationId: string; meId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data = [] } = useScheduled(conversationId);
  if (!data.length) return null;

  const cancel = async (id: string) => {
    const { error } = await supabase.rpc('cancel_scheduled_message', { p_id: id });
    if (error) toast.error(errorMessage(error));
    qc.invalidateQueries({ queryKey: ['scheduled-messages', conversationId] });
  };

  return (
    <ul className="space-y-1 border-t border-border bg-primary/5 px-4 py-2 text-xs" aria-label="Pesan terjadwal">
      {data.map((s) => (
        <li key={s.id} className="flex items-start gap-2">
          <CalendarClock className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', s.status === 'failed' ? 'text-destructive' : 'text-primary')} />
          <p className="min-w-0 flex-1">
            <b>{s.status === 'failed' ? 'Gagal terkirim' : s.status === 'sending' ? 'Sedang dikirim' : formatWhen(s.send_at)}</b>
            {s.status === 'failed' && s.error && <span className="text-destructive"> ({s.error})</span>}
            <span className="block truncate text-muted-foreground">{s.body}</span>
          </p>
          {s.status === 'pending' && (s.created_by === meId || canManage) && (
            <button className="font-semibold text-primary" onClick={() => cancel(s.id)}>
              Batalkan
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
