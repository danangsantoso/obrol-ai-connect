import type { Tables } from '@/integrations/supabase/types';

export type Contact = Tables<'contacts'>;
export type Message = Tables<'messages'>;
export type Note = Tables<'notes'>;
export type AssignmentLog = Tables<'assignment_logs'>;
export type Member = Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email' | 'role' | 'status' | 'is_active' | 'must_change_password'>;
export type Team = Tables<'teams'>;
export type Label = Tables<'labels'>;
export type QuickReply = Tables<'quick_replies'>;

export type ConversationRow = Tables<'conversations'> & {
  contact: Pick<Contact, 'id' | 'wa_id' | 'name' | 'profile_name' | 'username'>;
  channel: Pick<Tables<'channels'>, 'provider' | 'name' | 'ai_enabled'> | null;
  conversation_labels: { label_id: string }[];
};

export type InboxTab = 'unassigned' | 'mine' | 'all' | 'resolved';

export type TimelineItem =
  | { kind: 'message'; at: string; message: Message }
  | { kind: 'note'; at: string; note: Note }
  | { kind: 'log'; at: string; log: AssignmentLog };

export function memberName(member: Pick<Member, 'full_name' | 'email'> | undefined | null) {
  if (!member) return 'Tidak dikenal';
  return member.full_name || member.email;
}

// Value of the "no filter" option in the inbox filter dropdowns.
export const ALL = '__all__';

export const LABEL_COLORS = ['#2563EB', '#0891B2', '#16A34A', '#CA8A04', '#EA580C', '#DC2626', '#DB2777', '#7C3AED', '#64748B'];
