import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AssignmentLog, ConversationRow, Label, Member, Message, Note, QuickReply, Team, TimelineItem } from './types';

const CONVERSATION_SELECT =
  '*, contact:contacts!inner(id, wa_id, name, profile_name, username), channel:channels(provider, name, ai_enabled), conversation_labels(label_id)';

// Realtime can drop (phone asleep, network change, server restart). While it is
// down the data is polled every few seconds, and it is reloaded as soon as the
// connection is back or the tab is opened again, so nothing is missed.
const LIVE_POLL_MS = 30_000;
const FALLBACK_POLL_MS = 5_000;
const DOWN = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

function useReloadOnReturn(reload: () => void) {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') latest.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, []);
}

export function useConversations(orgId: string) {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(true);
  const query = useQuery({
    queryKey: ['conversations', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select(CONVERSATION_SELECT)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return data as unknown as ConversationRow[];
    },
    // Realtime only reports rows the user can still see; a periodic refresh
    // drops chats that were transferred away and shows rotated chats whose
    // agent missed the reply deadline.
    refetchInterval: live ? LIVE_POLL_MS : FALLBACK_POLL_MS,
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: ['conversations', orgId] });
  useReloadOnReturn(reload);

  // Any change in the organization's conversations refreshes the list.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasDown = false;
    const channel = supabase
      .channel(`conversations:${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `organization_id=eq.${orgId}` },
        () => {
          clearTimeout(timer);
          timer = setTimeout(() => queryClient.invalidateQueries({ queryKey: ['conversations', orgId] }), 250);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (wasDown) queryClient.invalidateQueries({ queryKey: ['conversations', orgId] });
          wasDown = false;
          setLive(true);
        } else if (DOWN.has(status)) {
          wasDown = true;
          setLive(false);
        }
      });
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  return { ...query, live };
}

// Conversation ids whose messages contain the search text (RLS limits it to what the user may see).
export function useMessageSearch(text: string) {
  const term = text.trim();
  return useQuery({
    queryKey: ['message-search', term],
    enabled: term.length >= 3,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('conversation_id')
        .ilike('body', `%${term.replace(/[%_]/g, '\\$&')}%`)
        .limit(200);
      if (error) throw error;
      return new Set(data.map((row) => row.conversation_id));
    },
  });
}

export function useMembers(orgId: string) {
  return useQuery({
    queryKey: ['members', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, status, is_active, must_change_password')
        .eq('organization_id', orgId)
        .order('full_name');
      if (error) throw error;
      return data as Member[];
    },
  });
}

export function useLabels(orgId: string) {
  return useQuery({
    queryKey: ['labels', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labels')
        .select('*')
        .eq('organization_id', orgId)
        .order('position')
        .order('name');
      if (error) throw error;
      return data as Label[];
    },
  });
}

// Shared quick replies plus the signed-in user's own (RLS returns exactly those).
export function useQuickReplies(orgId: string) {
  return useQuery({
    queryKey: ['quick-replies', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('quick_replies').select('*').order('shortcut');
      if (error) throw error;
      return data as QuickReply[];
    },
  });
}

export function useTeams(orgId: string) {
  return useQuery({
    queryKey: ['teams', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('teams').select('*').eq('organization_id', orgId).order('name');
      if (error) throw error;
      return data as Team[];
    },
  });
}

// Messages, internal notes and assignment history of one conversation, merged
// into a single timeline and kept live through Realtime.
export function useTimeline(conversationId: string | undefined) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [logs, setLogs] = useState<AssignmentLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const current = useRef(conversationId);
  useReloadOnReturn(() => setReloadTick((t) => t + 1));

  // While realtime is down, poll the open chat.
  useEffect(() => {
    if (live || !conversationId) return;
    const timer = setInterval(() => setReloadTick((t) => t + 1), FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [live, conversationId]);

  // Reload without clearing the screen (after a reconnect, on return, or while polling).
  useEffect(() => {
    if (!reloadTick || !conversationId) return;
    Promise.all([
      supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at').limit(500),
      supabase.from('notes').select('*').eq('conversation_id', conversationId).order('created_at'),
      supabase.from('assignment_logs').select('*').eq('conversation_id', conversationId).order('created_at'),
    ]).then(([m, n, l]) => {
      if (current.current !== conversationId) return;
      if (m.data) setMessages(m.data);
      if (n.data) setNotes(n.data);
      if (l.data) setLogs(l.data);
    });
  }, [reloadTick, conversationId]);

  useEffect(() => {
    current.current = conversationId;
    setMessages([]);
    setNotes([]);
    setLogs([]);
    if (!conversationId) return;

    setLoading(true);
    const load = async () => {
      const [m, n, l] = await Promise.all([
        supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at').limit(500),
        supabase.from('notes').select('*').eq('conversation_id', conversationId).order('created_at'),
        supabase.from('assignment_logs').select('*').eq('conversation_id', conversationId).order('created_at'),
      ]);
      if (current.current !== conversationId) return;
      setMessages(m.data ?? []);
      setNotes(n.data ?? []);
      setLogs(l.data ?? []);
      setLoading(false);
    };
    load();

    const upsert = <T extends { id: string }>(rows: T[], row: T) => {
      const index = rows.findIndex((r) => r.id === row.id);
      if (index === -1) return [...rows, row];
      const copy = rows.slice();
      copy[index] = row;
      return copy;
    };

    let wasDown = false;
    const channel = supabase
      .channel(`timeline:${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          setMessages((rows) => upsert(rows, payload.new as Message));
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notes', filter: `conversation_id=eq.${conversationId}` },
        (payload) => setNotes((rows) => upsert(rows, payload.new as Note)),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (wasDown) setReloadTick((t) => t + 1);
          wasDown = false;
          setLive(true);
        } else if (DOWN.has(status)) {
          wasDown = true;
          setLive(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const reloadLogs = async () => {
    if (!conversationId) return;
    const { data } = await supabase
      .from('assignment_logs')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at');
    setLogs(data ?? []);
  };

  const addMessage = (message: Message) => setMessages((rows) =>
    rows.some((r) => r.id === message.id) ? rows : [...rows, message],
  );

  const items = useMemo<TimelineItem[]>(() => {
    const all: TimelineItem[] = [
      ...messages.map((message) => ({ kind: 'message' as const, at: message.created_at, message })),
      ...notes.map((note) => ({ kind: 'note' as const, at: note.created_at, note })),
      ...logs.map((log) => ({ kind: 'log' as const, at: log.created_at, log })),
    ];
    return all.sort((a, b) => a.at.localeCompare(b.at));
  }, [messages, notes, logs]);

  return { items, loading, reloadLogs, addMessage };
}

// Signed URL for a private media file, cached for the session.
const signedUrlCache = new Map<string, string>();

export function useSignedUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(path ? signedUrlCache.get(path) ?? null : null);
  useEffect(() => {
    if (!path || signedUrlCache.has(path)) {
      setUrl(path ? signedUrlCache.get(path) ?? null : null);
      return;
    }
    let cancelled = false;
    supabase.storage
      .from('media')
      .createSignedUrl(path, 60 * 60)
      .then(({ data }) => {
        if (!data?.signedUrl || cancelled) return;
        signedUrlCache.set(path, data.signedUrl);
        setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url;
}
