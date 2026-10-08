-- Three ways to serve customers better:
--  1. Knowledge gaps: questions the AI could not answer from the catalog and
--     knowledge, counted, so the admin can add the answer in one click.
--  2. Satisfaction survey (CSAT): when a chat is resolved the customer is asked
--     for a 1-5 rating; the answer is recorded per agent and does not reopen the chat.
--  3. Business hours: outside them the AI answers right away, chats are not
--     rotated to agents who are off, and (without AI) an away message goes out.

-- ---------------------------------------------------------------------------
-- 1. Knowledge gaps
-- ---------------------------------------------------------------------------
alter table public.ai_runs
  add column question text,
  add column missing_info text;

create table public.knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 300),
  -- Lower-cased, punctuation-free form used to count the same question once.
  question_key text not null,
  times_asked integer not null default 1,
  last_asked_at timestamptz not null default now(),
  conversation_id uuid references public.conversations (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  answer_doc_id uuid references public.knowledge_docs (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, question_key)
);
create index knowledge_gaps_open_idx on public.knowledge_gaps (organization_id, times_asked desc) where status = 'open';
alter table public.knowledge_gaps enable row level security;
create policy "managers manage knowledge gaps" on public.knowledge_gaps
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'))
  with check (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

-- Counts a question the AI could not answer (service role, from the AI turn).
create or replace function public.record_knowledge_gap(p_org uuid, p_question text, p_conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.knowledge_gaps (organization_id, question, question_key, conversation_id)
  values (
    p_org, left(trim(p_question), 300),
    left(trim(regexp_replace(lower(p_question), '[^[:alnum:]]+', ' ', 'g')), 300),
    p_conversation
  )
  on conflict (organization_id, question_key) do update
    set times_asked = public.knowledge_gaps.times_asked + 1,
        last_asked_at = now(),
        conversation_id = excluded.conversation_id,
        -- asked again after being answered: the answer may not be good enough
        status = case when public.knowledge_gaps.status = 'dismissed' then 'dismissed' else 'open' end
$$;
revoke execute on function public.record_knowledge_gap(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Satisfaction survey
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column csat_enabled boolean not null default false,
  add column csat_message text not null default
    'Terima kasih sudah menghubungi kami 🙏 Bagaimana pelayanan kami hari ini? Balas dengan angka 1 sampai 5 (5 = sangat puas) ⭐'
    check (char_length(csat_message) between 1 and 1000),
  add column csat_thanks text not null default 'Terima kasih atas penilaiannya 🙏'
    check (char_length(csat_thanks) <= 500),
  add column business_hours jsonb not null default '{"enabled": false}'::jsonb,
  add column outside_hours_message text not null default
    'Terima kasih sudah menghubungi kami 🙏 Saat ini kami sedang di luar jam operasional. Pesan Anda akan kami balas secepatnya di jam kerja.'
    check (char_length(outside_hours_message) <= 1000);

create table public.csat_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- The agent who handled the chat when it was resolved (null = AI).
  agent_id uuid references public.profiles (id) on delete set null,
  handled_by_ai boolean not null default false,
  episode_opened_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'answered', 'skipped')),
  send_after timestamptz not null default now() + interval '1 minute',
  sent_at timestamptz,
  message_id uuid references public.messages (id) on delete set null,
  rating integer check (rating between 1 and 5),
  answered_at timestamptz,
  thanked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (conversation_id, episode_opened_at)
);
create index csat_requests_due_idx on public.csat_requests (send_after) where status = 'pending';
create index csat_requests_org_idx on public.csat_requests (organization_id, created_at desc);
alter table public.csat_requests enable row level security;
create policy "members read csat of their chats" on public.csat_requests
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (public.current_role_name() in ('admin', 'supervisor') or agent_id = auth.uid())
  );

-- A resolved chat that someone actually answered gets a survey (once per episode).
create or replace function public.csat_on_resolve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  if new.status <> 'resolved' or old.status = 'resolved' then
    return null;
  end if;
  select csat_enabled into v_enabled from public.organizations where id = new.organization_id;
  if not coalesce(v_enabled, false) then
    return null;
  end if;
  if not exists (
    select 1 from public.messages m
    where m.conversation_id = new.id and m.direction = 'outbound' and m.created_at >= old.opened_at
      and not (m.metadata ? 'broadcast') and not (m.metadata ? 'followup')
  ) then
    return null;
  end if;
  insert into public.csat_requests (organization_id, conversation_id, agent_id, handled_by_ai, episode_opened_at)
  values (new.organization_id, new.id, old.assignee_id, old.assignee_id is null and old.ai_engaged, old.opened_at)
  on conflict do nothing;
  return null;
end;
$$;
create trigger conversations_csat after update of status on public.conversations
  for each row execute function public.csat_on_resolve();

-- "1".."5" (or ⭐ to ⭐⭐⭐⭐⭐) in reply to a survey sent in the last 24 hours.
create or replace function public.csat_rating(p_body text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when trim(p_body) ~ '^[1-5]([[:space:]]*/[[:space:]]*5)?[[:space:]]*[!.]?$' then substr(trim(p_body), 1, 1)::integer
    when trim(p_body) ~ '^⭐{1,5}$' then char_length(trim(p_body))
    else null end
$$;

create or replace function public.csat_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rating integer;
begin
  if new.direction <> 'inbound' then
    return null;
  end if;
  v_rating := public.csat_rating(coalesce(new.body, ''));
  if v_rating is null then
    return null;
  end if;
  update public.csat_requests
  set status = 'answered', rating = v_rating, answered_at = now()
  where conversation_id = new.conversation_id and status = 'sent' and sent_at > now() - interval '24 hours';
  return null;
end;
$$;
create trigger messages_csat after insert on public.messages
  for each row execute function public.csat_on_message();

-- The rating does not reopen the chat: the customer is only answering the survey.
-- (Runs before the other status triggers: names sort alphabetically.)
create or replace function public.csat_keep_resolved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'resolved' and new.status <> 'resolved' and exists (
    select 1 from public.csat_requests r
    where r.conversation_id = new.id and r.status = 'answered' and r.answered_at = now()
  ) then
    new.status := old.status;
    new.opened_at := old.opened_at;
    new.resolved_at := old.resolved_at;
    new.first_response_at := old.first_response_at;
    new.unread_count := old.unread_count;
  end if;
  return new;
end;
$$;
create trigger conversations_a_csat_keep_resolved before update on public.conversations
  for each row execute function public.csat_keep_resolved();

-- Average rating per agent (null = AI) for the reports.
create or replace function public.csat_summary(p_days integer default 30)
returns table (agent_id uuid, handled_by_ai boolean, surveys bigint, answered bigint, average numeric, satisfied bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select agent_id, handled_by_ai,
    count(*) filter (where status in ('sent', 'answered')),
    count(*) filter (where status = 'answered'),
    round(avg(rating) filter (where status = 'answered'), 2),
    count(*) filter (where rating >= 4)
  from public.csat_requests
  where organization_id = public.current_org_id()
    and created_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
  group by agent_id, handled_by_ai
$$;
grant execute on function public.csat_summary(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Business hours
-- ---------------------------------------------------------------------------
-- business_hours: {"enabled": true, "days": {"1": ["08:00", "17:00"], ..., "7": null}}
-- (ISO weekday: 1 = Monday ... 7 = Sunday; null or missing = closed that day).
create or replace function public.is_business_open(p_org uuid, p_at timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hours jsonb;
  v_tz text;
  v_local timestamp;
  v_day jsonb;
begin
  select business_hours, timezone into v_hours, v_tz from public.organizations where id = p_org;
  if v_hours is null or not coalesce((v_hours ->> 'enabled')::boolean, false) then
    return true;
  end if;
  v_local := p_at at time zone v_tz;
  v_day := v_hours -> 'days' -> extract(isodow from v_local)::text;
  if v_day is null or jsonb_typeof(v_day) <> 'array' or jsonb_array_length(v_day) < 2 then
    return false;
  end if;
  return v_local::time >= (v_day ->> 0)::time and v_local::time < (v_day ->> 1)::time;
exception when others then
  return true; -- a malformed schedule never blocks the team
end;
$$;
grant execute on function public.is_business_open(uuid, timestamptz) to authenticated;

create or replace function public.claim_ai_turn(p_conversation_id uuid)
returns table (outcome text, message_id uuid, wait_ms integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations;
  s public.ai_settings;
  ch public.channels;
  due timestamptz;
  since timestamptz;
  has_settings boolean;
  held_by_agent boolean;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.ai_pending_message_id is null then
    return query select 'skip'::text, null::uuid, 0;
    return;
  end if;
  select * into s from public.ai_settings where organization_id = c.organization_id;
  has_settings := found;
  select * into ch from public.channels where id = c.channel_id;
  -- An agent holds the chat, except a rotated agent who has not answered yet.
  held_by_agent := c.assignee_id is not null and c.rotation_deadline is null;
  if not has_settings or not s.enabled or not ch.ai_enabled or not ch.is_active
     or not c.ai_active or held_by_agent or c.status = 'resolved' then
    -- nothing to do until something changes; drop the mark
    update public.conversations set ai_pending_message_id = null, ai_due_at = null where id = c.id;
    return query select 'skip'::text, null::uuid, 0;
    return;
  end if;
  if c.ai_busy_until is not null and c.ai_busy_until > now() then
    return query select 'wait'::text, null::uuid,
      greatest(500, (extract(epoch from c.ai_busy_until - now()) * 1000)::integer);
    return;
  end if;

  -- Outside business hours nobody is there to answer first: the AI answers right away.
  if not public.is_business_open(c.organization_id) then
    s.agent_wait_minutes := 0;
  end if;

  if c.ai_engaged then
    due := c.ai_pending_at + make_interval(secs => s.reply_delay_seconds);
  else
    -- People first: the oldest customer message nobody has answered yet.
    select min(m.created_at) into since
    from public.messages m
    where m.conversation_id = c.id and m.direction = 'inbound'
      and m.created_at > coalesce((
        select max(o.created_at) from public.messages o
        where o.conversation_id = c.id and o.direction = 'outbound'
      ), '-infinity'::timestamptz);
    -- After the AI itself asked for a person, give people at least 3 minutes.
    due := greatest(
      coalesce(since, c.ai_pending_at) + make_interval(mins => case
        when c.ai_handoff_at is not null then case when s.agent_wait_minutes = 0 then 0 else greatest(s.agent_wait_minutes, 3) end
        else s.agent_wait_minutes end),
      c.ai_pending_at + make_interval(secs => s.reply_delay_seconds)
    );
  end if;
  if due > now() then
    update public.conversations set ai_due_at = due where id = c.id and ai_due_at is distinct from due;
    return query select 'wait'::text, null::uuid, (extract(epoch from due - now()) * 1000)::integer + 100;
    return;
  end if;

  if not c.ai_engaged and c.assignee_id is not null then
    insert into public.assignment_logs (
      organization_id, conversation_id, from_assignee_id, to_assignee_id, from_team_id, to_team_id, actor_id, note
    ) values (
      c.organization_id, c.id, c.assignee_id, null, c.team_id, c.team_id, null,
      'Diambil alih AI: belum dibalas agen dalam ' || s.agent_wait_minutes || ' menit'
    );
  end if;
  update public.conversations
  set ai_pending_message_id = null,
      ai_due_at = null,
      ai_busy_until = now() + interval '2 minutes',
      ai_engaged = true,
      ai_handoff_at = null,
      ai_handoff_reason = null,
      assignee_id = null,
      rotation_deadline = null
  where id = c.id;
  return query select 'claimed'::text, c.ai_pending_message_id, 0;
end;
$$;

create or replace function public.rotate_conversation_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_ai boolean;
  v_agent uuid;
  v_new_customer_message boolean;
  v_handed_off boolean;
begin
  -- A reply or a manual (re)assignment ends the waiting period.
  if tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id then
    new.rotation_deadline := null;
  end if;

  if new.assignee_id is not null or new.status = 'resolved' then
    return new;
  end if;

  v_new_customer_message := new.last_customer_message_at is not null and (
    tg_op = 'INSERT' or new.last_customer_message_at is distinct from old.last_customer_message_at
  );
  -- Back to people: the AI handed over, or was switched off for this chat.
  v_handed_off := tg_op = 'UPDATE' and (
    (old.ai_active and not new.ai_active) or (old.ai_engaged and not new.ai_engaged)
  );
  if not (v_new_customer_message or v_handed_off) then
    return new;
  end if;

  select * into v_org from public.organizations where id = new.organization_id;
  if not v_org.auto_rotate then
    return new;
  end if;

  -- While the AI agent answers this chat it stays unassigned. When the AI
  -- waits for people first (agent_wait_minutes > 0), the chat is rotated to an
  -- agent and the AI only steps in if that agent does not answer in time.
  select coalesce(s.enabled, false) and ch.ai_enabled and new.ai_active
         and (new.ai_engaged or coalesce(s.agent_wait_minutes, 0) = 0) into v_ai
  from public.channels ch
  left join public.ai_settings s on s.organization_id = new.organization_id
  where ch.id = new.channel_id;
  if coalesce(v_ai, false) then
    return new;
  end if;

  -- Outside business hours chats wait in the queue instead of going to an agent who is off.
  if not public.is_business_open(new.organization_id) then
    return new;
  end if;

  v_agent := public.next_rotation_agent(new.organization_id, new.team_id);
  if v_agent is null then
    return new;
  end if;

  update public.profiles set last_rotated_at = clock_timestamp() where id = v_agent;
  new.assignee_id := v_agent;
  new.rotated_at := now();
  new.rotation_deadline := now() + make_interval(mins => v_org.rotate_timeout_minutes);
  return new;
end;
$$;
