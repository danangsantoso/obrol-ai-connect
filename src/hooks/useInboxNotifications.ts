import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { displayName } from '@/lib/api';
import { toast } from 'sonner';

// Short two-tone chime generated on the fly (no audio file to ship).
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.3);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // audio not available (e.g. autoplay policy); the visual notification still shows
  }
}

export function useUnreadTotal(orgId: string) {
  return useQuery({
    queryKey: ['unread', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('conversations').select('unread_count').gt('unread_count', 0);
      if (error) throw error;
      return data.reduce((sum, row) => sum + row.unread_count, 0);
    },
    refetchInterval: 60_000,
  });
}

// Alerts the signed-in user about new customer messages in their chats or the
// queue, chats transferred to them, and @mentions in internal notes.
export function useInboxNotifications(orgId: string, userId: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const path = useRef(location.pathname);
  path.current = location.pathname;

  useEffect(() => {
    const notify = (title: string, body: string, conversationId: string) => {
      const viewing = path.current === `/inbox/${conversationId}` && !document.hidden;
      if (viewing) return;
      chime();
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(title, { body, tag: conversationId, icon: '/favicon.svg' });
        n.onclick = () => {
          window.focus();
          navigate(`/inbox/${conversationId}`);
          n.close();
        };
      } else {
        toast(title, {
          description: body,
          action: { label: 'Buka', onClick: () => navigate(`/inbox/${conversationId}`) },
        });
      }
    };

    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['unread', orgId] });
      queryClient.invalidateQueries({ queryKey: ['conversations', orgId] });
    };

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `organization_id=eq.${orgId}` },
        async (payload) => {
          const message = payload.new as Tables<'messages'>;
          refresh();
          if (message.direction !== 'inbound') return;
          const { data: conv } = await supabase
            .from('conversations')
            .select('assignee_id, contact:contacts(name, profile_name, wa_id)')
            .eq('id', message.conversation_id)
            .maybeSingle();
          if (!conv || (conv.assignee_id && conv.assignee_id !== userId)) return;
          const contact = conv.contact as { name: string | null; profile_name: string | null; wa_id: string };
          notify(
            conv.assignee_id ? displayName(contact) : `Antrean: ${displayName(contact)}`,
            message.body ?? `[${message.type}]`,
            message.conversation_id,
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'assignment_logs', filter: `to_assignee_id=eq.${userId}` },
        (payload) => {
          const log = payload.new as Tables<'assignment_logs'>;
          refresh();
          if (log.actor_id === userId) return;
          notify('Chat dipindahkan ke Anda', log.note ?? 'Buka untuk melanjutkan percakapan', log.conversation_id);
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notes', filter: `organization_id=eq.${orgId}` },
        (payload) => {
          const note = payload.new as Tables<'notes'>;
          if (note.author_id === userId || !note.mentions.includes(userId)) return;
          notify('Anda disebut di catatan internal', note.body, note.conversation_id);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId, navigate, queryClient]);
}
