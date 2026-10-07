-- Giving chats back to the AI agent.
--  * hand_to_ai(): an agent releases a chat; the AI answers the customer's next message.
--  * ai_settings.reclaim_on_resolve (default on): a resolved chat leaves its
--    agent, so a returning customer is answered by the AI first.

alter table public.ai_settings add column reclaim_on_resolve boolean not null default true;

create or replace function public.hand_to_ai(conv_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.conversations;
  result public.conversations;
begin
  if not public.can_access_conversation(conv_id) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;
  select * into conv from public.conversations where id = conv_id for update;

  update public.conversations
  set assignee_id = null,
      rotation_deadline = null,
      ai_active = true,
      ai_reply_count = 0,
      ai_handoff_at = null,
      ai_handoff_reason = null
  where id = conv_id
  returning * into result;

  if conv.assignee_id is not null then
    insert into public.assignment_logs (
      organization_id, conversation_id, from_assignee_id, to_assignee_id, from_team_id, to_team_id, actor_id, note
    ) values (
      conv.organization_id, conv_id, conv.assignee_id, null, conv.team_id, conv.team_id, auth.uid(), 'Diserahkan ke AI'
    );
  end if;
  return result;
end;
$$;

-- Same as before (a resolved chat starts fresh for the AI), plus: the chat
-- leaves its agent when the organization wants returning customers to meet the AI.
create or replace function public.reset_ai_on_resolve()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.ai_active := true;
    new.ai_reply_count := 0;
    new.ai_handoff_at := null;
    new.ai_handoff_reason := null;
    if exists (
      select 1
      from public.ai_settings s
      join public.channels ch on ch.id = new.channel_id and ch.ai_enabled
      where s.organization_id = new.organization_id and s.enabled and s.reclaim_on_resolve
    ) then
      new.assignee_id := null;
      new.rotation_deadline := null;
    end if;
  end if;
  return new;
end;
$$;
