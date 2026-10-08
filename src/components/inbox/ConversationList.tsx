import { format, isToday, isYesterday } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { displayName, initials } from '@/lib/api';
import type { ConversationRow, InboxTab, Label, Member } from './types';
import { ALL, memberName, isTakeable } from './types';
import { LabelChip } from './LabelChip';
import { ChannelIcon } from './ChannelIcon';

const TABS: { value: InboxTab; label: string }[] = [
  { value: 'unassigned', label: 'Antrean' },
  { value: 'mine', label: 'Saya' },
  { value: 'all', label: 'Semua' },
  { value: 'resolved', label: 'Selesai' },
];

function formatListTime(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Kemarin';
  return format(date, 'd MMM', { locale: localeId });
}

interface Props {
  conversations: ConversationRow[];
  counts: Record<InboxTab, number>;
  tab: InboxTab;
  onTabChange: (tab: InboxTab) => void;
  search: string;
  onSearchChange: (value: string) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  members: Map<string, Member>;
  labels: Label[];
  labelFilter: string;
  onLabelFilterChange: (value: string) => void;
  agentFilter: string | null;
  onAgentFilterChange: ((value: string) => void) | null;
  loading: boolean;
  meId: string;
  live: boolean;
}

export function ConversationList({
  conversations,
  counts,
  tab,
  onTabChange,
  search,
  onSearchChange,
  selectedId,
  onSelect,
  members,
  labels,
  labelFilter,
  onLabelFilterChange,
  agentFilter,
  onAgentFilterChange,
  loading,
  meId,
  live,
}: Props) {
  const labelMap = new Map(labels.map((l) => [l.id, l]));
  const activeMembers = [...members.values()].filter((m) => m.is_active);
  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-r border-border bg-card">
      <div className="space-y-3 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cari nama, nomor, atau isi pesan"
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => onTabChange(t.value)}
              className={cn(
                'rounded-md px-1 py-1.5 text-xs font-medium transition-colors',
                tab === t.value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {t.value !== 'resolved' && counts[t.value] > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                  {counts[t.value]}
                </span>
              )}
            </button>
          ))}
        </div>
        {(labels.length > 0 || onAgentFilterChange) && (
          <div className="flex gap-2">
            {labels.length > 0 && (
              <Select value={labelFilter} onValueChange={onLabelFilterChange}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Semua label</SelectItem>
                  {labels.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {onAgentFilterChange && agentFilter !== null && (
              <Select value={agentFilter} onValueChange={onAgentFilterChange}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Semua agen</SelectItem>
                  {activeMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {memberName(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>

      {!live && (
        <p className="border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning" role="status">
          Koneksi realtime terputus. Daftar diperbarui otomatis tiap 5 detik.
        </p>
      )}
      <ScrollArea className="flex-1">
        {loading && <p className="p-4 text-sm text-muted-foreground">Memuat percakapan...</p>}
        {!loading && conversations.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">Tidak ada percakapan di sini.</p>
        )}
        {conversations.map((conv) => {
          const name = displayName(conv.contact);
          const assignee = conv.assignee_id ? members.get(conv.assignee_id) : undefined;
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={cn(
                'flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-primary-light/60',
                selectedId === conv.id && 'bg-primary-light',
              )}
            >
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                  {initials(name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={cn('flex min-w-0 items-center gap-1 text-sm', conv.unread_count > 0 ? 'font-semibold' : 'font-medium')}>
                    <ChannelIcon provider={conv.channel?.provider} />
                    <span className="truncate">{name}</span>
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatListTime(conv.last_message_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-muted-foreground">{conv.last_message_preview ?? ''}</p>
                  {conv.unread_count > 0 && (
                    <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      {conv.unread_count}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {isTakeable(conv, meId)
                    ? <span className="font-medium text-warning">Belum dibalas {memberName(assignee)} · bisa diambil</span>
                    : assignee
                    ? `Ditangani ${memberName(assignee)}`
                    : conv.ai_engaged && conv.ai_active
                      ? <span className="font-medium text-primary">Dijawab AI</span>
                      : conv.ai_handoff_at
                        ? <span className="font-medium text-warning">Perlu agen (dari AI)</span>
                        : 'Belum di-assign'}
                  {conv.status === 'pending' && ' · Pending'}
                </p>
                {conv.conversation_labels.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {conv.conversation_labels.map(({ label_id }) => {
                      const label = labelMap.get(label_id);
                      return label ? <LabelChip key={label_id} label={label} /> : null;
                    })}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </ScrollArea>
    </div>
  );
}
