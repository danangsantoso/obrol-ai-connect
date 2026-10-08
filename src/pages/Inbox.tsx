import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { displayName } from '@/lib/api';
import { ChatView } from '@/components/inbox/ChatView';
import { ContactPanel } from '@/components/inbox/ContactPanel';
import { ConversationList } from '@/components/inbox/ConversationList';
import { useConversations, useLabels, useMembers, useMessageSearch, useTeams } from '@/components/inbox/useInboxData';
import { ALL, isTakeable, type ConversationRow, type InboxTab } from '@/components/inbox/types';

function inTab(conv: ConversationRow, tab: InboxTab, meId: string) {
  switch (tab) {
    case 'unassigned':
      return (!conv.assignee_id && conv.status !== 'resolved') || isTakeable(conv, meId);
    case 'mine':
      return conv.assignee_id === meId && conv.status !== 'resolved';
    case 'all':
      return conv.status !== 'resolved';
    case 'resolved':
      return conv.status === 'resolved';
  }
}

export default function Inbox() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const meId = profile!.id;
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<InboxTab>('unassigned');
  const [search, setSearch] = useState('');
  const [labelFilter, setLabelFilter] = useState(ALL);
  const [agentFilter, setAgentFilter] = useState(ALL);
  const canFilterAgents = profile!.role !== 'agent';

  const { data: conversations = [], isLoading, live } = useConversations(orgId);
  const { data: members = [] } = useMembers(orgId);
  const { data: teams = [] } = useTeams(orgId);
  const { data: labels = [] } = useLabels(orgId);
  const { data: messageHits } = useMessageSearch(search);

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const counts = useMemo(() => {
    const result: Record<InboxTab, number> = { unassigned: 0, mine: 0, all: 0, resolved: 0 };
    for (const conv of conversations) {
      for (const t of Object.keys(result) as InboxTab[]) {
        if (inTab(conv, t, meId)) result[t] += 1;
      }
    }
    return result;
  }, [conversations, meId]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return conversations.filter((conv) => {
      if (labelFilter !== ALL && !conv.conversation_labels.some((l) => l.label_id === labelFilter)) return false;
      if (agentFilter !== ALL && conv.assignee_id !== agentFilter) return false;
      if (term) {
        const haystack = `${displayName(conv.contact)} ${conv.contact.wa_id} ${conv.last_message_preview ?? ''}`.toLowerCase();
        return haystack.includes(term) || messageHits?.has(conv.id);
      }
      return inTab(conv, tab, meId);
    });
  }, [conversations, search, tab, meId, messageHits, labelFilter, agentFilter]);

  // Unread total in the browser tab title.
  useEffect(() => {
    const unread = conversations.reduce((sum, c) => sum + c.unread_count, 0);
    document.title = unread > 0 ? `(${unread}) Inbox · Balas.id` : 'Inbox · Balas.id';
    return () => {
      document.title = 'Balas.id';
    };
  }, [conversations]);

  const selected = conversations.find((c) => c.id === conversationId);
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['conversations', orgId] });
    queryClient.invalidateQueries({ queryKey: ['unread', orgId] });
  }, [queryClient, orgId]);

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={visible}
        counts={counts}
        tab={tab}
        onTabChange={setTab}
        search={search}
        onSearchChange={setSearch}
        selectedId={conversationId}
        onSelect={(id) => navigate(`/inbox/${id}`)}
        members={memberMap}
        labels={labels}
        labelFilter={labelFilter}
        onLabelFilterChange={setLabelFilter}
        agentFilter={canFilterAgents ? agentFilter : null}
        onAgentFilterChange={canFilterAgents ? setAgentFilter : null}
        loading={isLoading}
        meId={meId}
        live={live}
      />
      {selected ? (
        <>
          <ChatView
            conversation={selected}
            me={profile!}
            members={members}
            memberMap={memberMap}
            teams={teams}
            labels={labels}
            onChanged={refresh}
          />
          <ContactPanel contactId={selected.contact_id} />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <MessageSquare className="h-10 w-10 text-primary/40" />
          <p className="text-sm">Pilih percakapan untuk mulai membalas.</p>
        </div>
      )}
    </div>
  );
}
