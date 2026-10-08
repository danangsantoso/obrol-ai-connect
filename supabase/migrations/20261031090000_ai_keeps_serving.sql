-- The AI keeps serving a chat until a person takes it over or moves it, and
-- follows up when the customer goes quiet.
--  - keep_serving: the AI no longer hands chats to the team on its own. When
--    something needs a person (a complaint, a payment proof, missing
--    information) it tells the customer the team will check, leaves an
--    internal note, and carries on. The admin's hand-over phrases, a used-up
--    quota and AI errors still hand the chat over.
--  - AI follow-up: when the AI answered last and the customer has been silent
--    for ai_followup_after_hours, the AI writes a follow-up from the chat so
--    far; at most ai_followup_max per silence, a day apart, 08.00-20.00 local
--    time, and only inside the channel's 24-hour window where one applies.
alter table public.ai_settings
  add column keep_serving boolean not null default true,
  add column ai_followup boolean not null default true,
  add column ai_followup_after_hours integer not null default 3 check (ai_followup_after_hours between 1 and 72),
  add column ai_followup_max integer not null default 3 check (ai_followup_max between 1 and 10);

alter table public.conversations
  add column ai_followups_sent integer not null default 0,
  add column ai_last_followup_at timestamptz;

-- A customer message starts a new silence.
create or replace function public.reset_ai_followups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'inbound' then
    update public.conversations set ai_followups_sent = 0
    where id = new.conversation_id and ai_followups_sent <> 0;
  end if;
  return null;
end;
$$;
create trigger messages_reset_ai_followups after insert on public.messages
  for each row execute function public.reset_ai_followups();

-- Chats due for an AI follow-up, claimed so a parallel sweep skips them.
create or replace function public.ai_followup_claim(p_limit integer default 20)
returns table (conversation_id uuid, organization_id uuid, followup_number integer, followup_max integer)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select c.id
    from public.conversations c
    join public.ai_settings s on s.organization_id = c.organization_id
    join public.channels ch on ch.id = c.channel_id
    join public.organizations o on o.id = c.organization_id
    where s.enabled and s.ai_followup and ch.ai_enabled and ch.is_active and o.is_active
      and c.ai_engaged and c.ai_active and c.assignee_id is null and c.status <> 'resolved'
      and c.ai_pending_message_id is null
      and (c.ai_busy_until is null or c.ai_busy_until < now())
      and c.last_customer_message_at is not null
      and c.last_customer_message_at < now() - make_interval(hours => s.ai_followup_after_hours)
      and c.ai_followups_sent < s.ai_followup_max
      and (c.ai_last_followup_at is null or c.ai_last_followup_at < now() - interval '20 hours')
      -- Channels with a reply window: only inside it.
      and (ch.provider not in ('cloud_api', 'messenger', 'instagram') or c.last_customer_message_at > now() - interval '23 hours')
      -- Waking hours of the business.
      and extract(hour from now() at time zone o.timezone) between 8 and 19
      -- We spoke last: the customer is the one who went quiet.
      and exists (
        select 1 from public.messages m
        where m.conversation_id = c.id and m.direction = 'outbound' and m.created_at > c.last_customer_message_at
      )
      -- A follow-up sequence started by a person takes precedence.
      and not exists (select 1 from public.followup_enrollments e where e.conversation_id = c.id and e.status = 'active')
    order by c.last_customer_message_at
    limit p_limit
    for update of c skip locked
  )
  update public.conversations c
  set ai_followups_sent = c.ai_followups_sent + 1, ai_last_followup_at = now()
  from due, public.ai_settings s
  where c.id = due.id and s.organization_id = c.organization_id
  returning c.id, c.organization_id, c.ai_followups_sent, s.ai_followup_max
$$;
revoke execute on function public.ai_followup_claim(integer) from public, anon, authenticated;
