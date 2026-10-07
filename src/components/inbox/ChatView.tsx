import { useEffect, useState } from 'react';
import { Clock, Hand, UserRoundCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import type { Profile } from '@/contexts/AuthContext';
import { STATUS_LABELS, displayName, errorMessage, windowRemainingMs } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Composer } from './Composer';
import { TemplateSender } from './TemplateSender';
import { Timeline } from './Timeline';
import { TransferDialog } from './TransferDialog';
import { LabelPicker } from './LabelPicker';
import { useTimeline } from './useInboxData';
import type { ConversationRow, Label, Member, Team } from './types';
import { memberName } from './types';

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

  const remaining = windowRemainingMs(conversation.last_customer_message_at, now);
  const windowOpen = remaining > 0;
  const assignee = conversation.assignee_id ? memberMap.get(conversation.assignee_id) : undefined;
  const name = displayName(conversation.contact);

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
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground">
            +{conversation.contact.wa_id} · {assignee ? `Ditangani ${memberName(assignee)}` : 'Belum di-assign'}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn('gap-1', windowOpen ? 'border-success/40 text-success' : 'border-warning/50 text-warning')}
          title="Jendela layanan 24 jam WhatsApp sejak pesan terakhir pelanggan"
        >
          <Clock className="h-3 w-3" />
          {windowOpen ? `24 jam: sisa ${formatRemaining(remaining)}` : '24 jam: tertutup'}
        </Badge>
        {!conversation.assignee_id && (
          <Button size="sm" onClick={claim}>
            <Hand className="mr-1 h-4 w-4" />
            Ambil chat
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

      {!windowOpen && <TemplateSender conversationId={conversation.id} orgId={me.organization_id!} onSent={addMessage} />}
      <Composer
        key={conversation.id}
        conversationId={conversation.id}
        orgId={me.organization_id!}
        userId={me.id}
        contactName={name}
        members={members}
        windowOpen={windowOpen}
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
