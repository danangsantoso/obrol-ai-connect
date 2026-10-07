import { useEffect, useState } from 'react';
import { Bot, Clock, Hand, QrCode, UserRoundCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import type { Profile } from '@/contexts/AuthContext';
import { STATUS_LABELS, displayName, errorMessage, formatWaId, socialWindowRemainingMs, windowRemainingMs } from '@/lib/api';
import { ChannelIcon } from './ChannelIcon';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Composer } from './Composer';
import { TemplateSender } from './TemplateSender';
import { Timeline } from './Timeline';
import { TransferDialog } from './TransferDialog';
import { LabelPicker } from './LabelPicker';
import { useTimeline } from './useInboxData';
import { useAiSettings } from '@/components/ai/aiSettings';
import type { ConversationRow, Label, Member, Team } from './types';
import { isTakeable, memberName } from './types';

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function formatRemaining(ms: number) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}j ${minutes}m` : `${minutes}m`;
}

interface Props {
  conversation: ConversationRow;
  me: Profile;
  members: Member[];
  memberMap: Map<string, Member>;
  teams: Team[];
  labels: Label[];
  onChanged: () => void;
}

export function ChatView({ conversation, me, members, memberMap, teams, labels, onChanged }: Props) {
  const { items, loading, reloadLogs, addMessage } = useTimeline(conversation.id);
  const [transferOpen, setTransferOpen] = useState(false);
  const now = useNow(30_000);

  // QR-linked numbers have no 24-hour window and no templates. Messenger and
  // Instagram allow 24 hours, then 7 days with the HUMAN_AGENT tag.
  const provider = conversation.channel?.provider ?? 'cloud_api';
  // Telegram bots and the website widget have no reply window either.
  const viaQr = provider === 'qr' || provider === 'telegram' || provider === 'webchat';
  const social = provider === 'messenger' || provider === 'instagram';
  const remaining = windowRemainingMs(conversation.last_customer_message_at, now);
  const socialRemaining = socialWindowRemainingMs(conversation.last_customer_message_at, now);
  const windowOpen = viaQr || (social ? socialRemaining > 0 : remaining > 0);
  const assignee = conversation.assignee_id ? memberMap.get(conversation.assignee_id) : undefined;
  const { data: ai } = useAiSettings(me.organization_id!);
  const aiReady = Boolean(ai?.enabled && ai.api_key_hint);
  const aiOnNumber = aiReady && Boolean(conversation.channel?.ai_enabled);
  const name = displayName(conversation.contact);
  const takeable = isTakeable(conversation, me.id);
  const replyDeadline =
    conversation.assignee_id === me.id && conversation.rotation_deadline && new Date(conversation.rotation_deadline).getTime() > Date.now()
      ? new Date(conversation.rotation_deadline).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      : null;

  useEffect(() => {
    if (conversation.unread_count > 0) {
      supabase.rpc('mark_conversation_read', { conv_id: conversation.id }).then(() => onChanged());
    }
  }, [conversation.id, conversation.unread_count, onChanged]);

  const afterChange = () => {
    reloadLogs();
    onChanged();
  };

  const claim = async () => {
    const { error } = await supabase.rpc('claim_conversation', { conv_id: conversation.id });
    if (error) {
      toast.error(errorMessage(error));
    } else {
      toast.success('Percakapan menjadi milik Anda');
    }
    afterChange();
  };

  const handToAi = async () => {
    if (!window.confirm('Serahkan chat ini ke AI? Chat dilepas dari agen dan AI menjawab pesan pelanggan berikutnya.')) return;
    const { error } = await supabase.rpc('hand_to_ai', { conv_id: conversation.id });
    if (error) toast.error(errorMessage(error));
    else toast.success('Chat diserahkan ke AI');
    afterChange();
  };

  const toggleAi = async () => {
    const { error } = await supabase.rpc('set_conversation_ai', { conv_id: conversation.id, active: !conversation.ai_active });
    if (error) toast.error(errorMessage(error));
    else toast.success(conversation.ai_active ? 'AI dimatikan untuk chat ini' : 'AI diaktifkan untuk chat ini');
    onChanged();
  };

  const setStatus = async (status: string) => {
    const { error } = await supabase.rpc('set_conversation_status', {
      conv_id: conversation.id,
      new_status: status as ConversationRow['status'],
    });
    if (error) toast.error(errorMessage(error));
    onChanged();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        <div className="min-w-[14rem] flex-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {formatWaId(conversation.contact.wa_id, conversation.contact.username)} · {assignee ? `Ditangani ${memberName(assignee)}` : 'Belum di-assign'}
          </p>
        </div>
        {viaQr ? (
          <Badge variant="outline" className="gap-1" title="Kanal tanpa batas waktu balasan">
            {provider === 'qr' ? <QrCode className="h-3 w-3" /> : <ChannelIcon provider={provider} className="h-3 w-3" />}
            {conversation.channel?.name ?? 'Nomor QR'}
          </Badge>
        ) : social ? (
          <Badge
            variant="outline"
            className={cn('gap-1', remaining > 0 ? 'border-success/40 text-success' : socialRemaining > 0 ? 'border-warning/50 text-warning' : 'border-destructive/40 text-destructive')}
            title="Meta: balasan bebas 24 jam sejak pesan terakhir pelanggan, lalu sampai 7 hari dengan tag Human Agent"
          >
            <ChannelIcon provider={provider} className="h-3 w-3" />
            {conversation.channel?.name} ·{' '}
            {remaining > 0
              ? `sisa ${formatRemaining(remaining)}`
              : socialRemaining > 0
                ? `Human Agent: sisa ${formatRemaining(socialRemaining)}`
                : 'tertutup'}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={cn('gap-1', windowOpen ? 'border-success/40 text-success' : 'border-warning/50 text-warning')}
            title="Jendela layanan 24 jam WhatsApp sejak pesan terakhir pelanggan"
          >
            <Clock className="h-3 w-3" />
            {windowOpen ? `24 jam: sisa ${formatRemaining(remaining)}` : '24 jam: tertutup'}
          </Badge>
        )}
        {aiOnNumber && conversation.assignee_id && !takeable && (
          <Button
            size="sm"
            variant="outline"
            onClick={handToAi}
            className="gap-1 border-primary/40 text-primary"
            title="Lepas chat ini dari agen; AI menjawab pesan pelanggan berikutnya"
          >
            <Bot className="h-4 w-4" />
            Serahkan ke AI
          </Button>
        )}
        {aiOnNumber && !conversation.assignee_id && (
          <Button
            size="sm"
            variant="outline"
            onClick={toggleAi}
            className={cn('gap-1', conversation.ai_active ? 'border-primary/40 text-primary' : 'text-muted-foreground')}
            title={
              conversation.ai_active
                ? 'AI membalas chat ini selama belum diambil agen. Klik untuk mematikan.'
                : 'Klik agar AI kembali membalas chat ini'
            }
          >
            <Bot className="h-4 w-4" />
            {conversation.ai_active ? 'AI aktif' : 'AI mati'}
          </Button>
        )}
        {(!conversation.assignee_id || takeable) && (
          <Button size="sm" onClick={claim}>
            <Hand className="mr-1 h-4 w-4" />
            {takeable ? 'Ambil alih' : 'Ambil chat'}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setTransferOpen(true)}>
          <UserRoundCog className="mr-1 h-4 w-4" />
          Pindahkan
        </Button>
        <Select value={conversation.status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {takeable && (
          <p className="basis-full rounded-md bg-warning/10 px-3 py-1.5 text-xs text-warning">
            Chat rotasi ini belum dibalas {memberName(assignee)}. Agen lain boleh mengambil alih.
          </p>
        )}
        {replyDeadline && (
          <p className="basis-full rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary">
            Chat dari rotasi otomatis. Balas sebelum pukul {replyDeadline}, setelah itu agen lain bisa mengambil alih.
          </p>
        )}
        {aiOnNumber && conversation.ai_handoff_at && !conversation.ai_engaged && !conversation.assignee_id && (
          <p className="basis-full rounded-md bg-warning/10 px-3 py-1.5 text-xs text-warning">
            AI menyerahkan chat ini ke agen{conversation.ai_handoff_reason ? `: ${conversation.ai_handoff_reason}` : '.'} Ambil chat
            untuk membalas.
          </p>
        )}
        <div className="basis-full">
          <LabelPicker
            conversationId={conversation.id}
            labels={labels}
            selectedIds={conversation.conversation_labels.map((l) => l.label_id)}
            onChanged={onChanged}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-muted/40">
        <Timeline items={items} members={memberMap} loading={loading} />
      </div>

      {!windowOpen && provider === 'cloud_api' && <TemplateSender conversationId={conversation.id} orgId={me.organization_id!} onSent={addMessage} />}
      <Composer
        key={conversation.id}
        conversationId={conversation.id}
        orgId={me.organization_id!}
        userId={me.id}
        contactName={name}
        members={members}
        windowOpen={windowOpen}
        aiSuggest={aiReady}
        onSent={(message) => {
          addMessage(message);
          onChanged();
        }}
      />

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        conversationId={conversation.id}
        currentAssigneeId={conversation.assignee_id}
        members={members}
        teams={teams}
        onDone={afterChange}
      />
    </div>
  );
}
