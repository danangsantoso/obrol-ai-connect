import type { Tables } from '@/integrations/supabase/types';

export type Contact = Tables<'contacts'>;
export type Message = Tables<'messages'>;
export type Note = Tables<'notes'>;
export type AssignmentLog = Tables<'assignment_logs'>;
export type Member = Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email' | 'role' | 'status' | 'is_active'>;
export type Team = Tables<'teams'>;

export type ConversationRow = Tables<'conversations'> & {
  contact: Pick<Contact, 'id' | 'wa_id' | 'name' | 'profile_name'>;
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
