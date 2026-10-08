-- Automatic follow-up sequences: a series of prepared messages (e.g. 5-7
-- steps, one a day) sent to a customer who went quiet, stopped as soon as the
-- customer replies. Every send and reply is tracked per sequence, step and agent.
--
-- A chat enters a sequence by hand (an agent picks one in the chat) or
-- automatically ("no_reply": we answered and the customer has been silent for
-- trigger_after_hours). The minute sweep (followup Edge Function) sends the
-- steps that are due.

create table public.followup_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  is_active boolean not null default true,
  trigger text not null default 'manual' check (trigger in ('manual', 'no_reply')),
  trigger_after_hours integer not null default 24 check (trigger_after_hours between 1 and 720),
  -- Only chats with this label (e.g. "Prospek") enter automatically. Null = all chats.
  label_id uuid references public.labels (id) on delete set null,
  -- Local hour (organization time zone) at which steps are sent. Null = exactly after the delay.
  send_hour integer default 9 check (send_hour between 0 and 23),
  -- Let the AI reword each step to fit the conversation (falls back to the prepared text).
  ai_personalize boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index followup_sequences_org_idx on public.followup_sequences (organization_id);

create table public.followup_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sequence_id uuid not null references public.followup_sequences (id) on delete cascade,
  position integer not null check (position between 1 and 10),
  -- Wait after the previous step (the first step: after the chat enters the sequence).
  delay_days integer not null default 1 check (delay_days between 0 and 60),
  delay_hours integer not null default 0 check (delay_hours between 0 and 23),
  -- Variables: {nama} {sapaan} {agen} {bot} {toko}
  message text not null check (char_length(message) between 1 and 2000),
  -- WhatsApp API numbers: approved template used once the 24-hour window has closed.
  template_name text,
  template_language text,
  unique (sequence_id, position)
);
create index followup_steps_sequence_idx on public.followup_steps (sequence_id, position);

create table public.followup_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sequence_id uuid not null references public.followup_sequences (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- The agent responsible (the chat's agent, or who started it); null = AI / unassigned.
  agent_id uuid references public.profiles (id) on delete set null,
  enrolled_by uuid references public.profiles (id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'replied', 'completed', 'stopped', 'failed')),
  steps_total integer not null,
  -- Last step sent (0 = none yet).
  current_step integer not null default 0,
  next_send_at timestamptz,
  attempts integer not null default 0,
  replied_at timestamptz,
  replied_after_step integer,
  stop_reason text,
  last_error text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index followup_enrollments_one_active on public.followup_enrollments (conversation_id) where status = 'active';
create index followup_enrollments_due_idx on public.followup_enrollments (next_send_at) where status = 'active';
create index followup_enrollments_org_idx on public.followup_enrollments (organization_id, started_at desc);
create index followup_enrollments_conv_idx on public.followup_enrollments (conversation_id, started_at desc);

create table public.followup_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  enrollment_id uuid not null references public.followup_enrollments (id) on delete cascade,
  position integer not null,
  message_id uuid references public.messages (id) on delete set null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index followup_sends_enrollment_idx on public.followup_sends (enrollment_id, position);

create trigger followup_sequences_updated_at before update on public.followup_sequences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access: everyone in the organization reads sequences; admins and supervisors
-- edit them. Enrollments are visible with the chat they belong to and change
-- only through the functions below.
-- ---------------------------------------------------------------------------
alter table public.followup_sequences enable row level security;
alter table public.followup_steps enable row level security;
alter table public.followup_enrollments enable row level security;
alter table public.followup_sends enable row level security;

create policy "members read sequences" on public.followup_sequences
  for select to authenticated using (organization_id = public.current_org_id());
create policy "managers edit sequences" on public.followup_sequences
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'))
  with check (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

create policy "members read steps" on public.followup_steps
  for select to authenticated using (organization_id = public.current_org_id());
create policy "managers edit steps" on public.followup_steps
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'))
  with check (
    organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor')
    and exists (select 1 from public.followup_sequences s where s.id = sequence_id and s.organization_id = organization_id)
  );

create policy "members read enrollments of their chats" on public.followup_enrollments
  for select to authenticated
  using (organization_id = public.current_org_id() and public.can_access_conversation(conversation_id));

create policy "members read sends of their chats" on public.followup_sends
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and exists (
      select 1 from public.followup_enrollments e
      where e.id = enrollment_id and public.can_access_conversation(e.conversation_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

-- When a step waiting `days` + `hours` after `from` goes out: at send_hour
-- local time on that day when the sequence has one, never before `from`.
create or replace function public.followup_due_at(
  p_tz text, p_from timestamptz, p_days integer, p_hours integer, p_send_hour integer
)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_at timestamptz := p_from + make_interval(days => p_days, hours => p_hours);
  v_local date;
begin
  if p_send_hour is null then
    return v_at;
  end if;
  v_local := (v_at at time zone p_tz)::date;
  v_at := (v_local + make_time(p_send_hour, 0, 0)) at time zone p_tz;
  return greatest(v_at, p_from);
end;
$$;

-- Due time of a sequence step for an enrollment, counted from `p_from`.
create or replace function public.followup_step_due(p_sequence_id uuid, p_position integer, p_from timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select public.followup_due_at(o.timezone, p_from, st.delay_days, st.delay_hours, s.send_hour)
  from public.followup_steps st
  join public.followup_sequences s on s.id = st.sequence_id
  join public.organizations o on o.id = s.organization_id
  where st.sequence_id = p_sequence_id and st.position = p_position
$$;
revoke execute on function public.followup_step_due(uuid, integer, timestamptz) from public, anon, authenticated;

-- Puts a chat into a sequence (replacing a running one). Agents can do this
-- for chats they can see; the automatic trigger calls it as the service role.
create or replace function public.followup_enroll(p_conversation_id uuid, p_sequence_id uuid)
returns public.followup_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_seq public.followup_sequences;
  v_steps integer;
  v_first integer;
  v_result public.followup_enrollments;
  v_caller uuid := auth.uid();
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  -- can_access_conversation can return null for "no".
  if v_caller is not null and public.can_access_conversation(p_conversation_id) is not true then
    raise exception 'conversation not found' using errcode = '42501';
  end if;

  select * into v_seq from public.followup_sequences
  where id = p_sequence_id and organization_id = v_conv.organization_id;
  if not found then
    raise exception 'sequence not found' using errcode = 'P0002';
  end if;
  if not v_seq.is_active then
    raise exception 'Urutan follow-up ini sedang nonaktif' using errcode = 'P0001';
  end if;

  select count(*), min(position) into v_steps, v_first from public.followup_steps where sequence_id = p_sequence_id;
  if v_steps = 0 then
    raise exception 'Urutan follow-up ini belum punya pesan' using errcode = 'P0001';
  end if;

  update public.followup_enrollments
  set status = 'stopped', stop_reason = 'Diganti urutan lain', ended_at = now(), next_send_at = null
  where conversation_id = p_conversation_id and status = 'active';

  insert into public.followup_enrollments (
    organization_id, sequence_id, conversation_id, agent_id, enrolled_by, steps_total, next_send_at
  ) values (
    v_conv.organization_id, p_sequence_id, p_conversation_id,
    coalesce(v_conv.assignee_id, v_caller), v_caller, v_steps,
    public.followup_step_due(p_sequence_id, v_first, now())
  )
  returning * into v_result;
  return v_result;
end;
$$;
grant execute on function public.followup_enroll(uuid, uuid) to authenticated;

create or replace function public.followup_stop(p_enrollment_id uuid)
returns public.followup_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.followup_enrollments;
begin
  select * into v_result from public.followup_enrollments where id = p_enrollment_id;
  if not found or public.can_access_conversation(v_result.conversation_id) is not true then
    raise exception 'follow-up not found' using errcode = 'P0002';
  end if;
  update public.followup_enrollments
  set status = 'stopped', stop_reason = coalesce(stop_reason, 'Dihentikan agen'), ended_at = now(), next_send_at = null
  where id = p_enrollment_id and status = 'active'
  returning * into v_result;
  return v_result;
end;
$$;
grant execute on function public.followup_stop(uuid) to authenticated;

-- Automatic entry: chats we answered whose customer has been silent for the
-- sequence's trigger time. A chat enters at most once per silence (a new
-- customer message starts a new silence), and only recent silences count, so
-- turning a sequence on does not message the whole backlog.
create or replace function public.followup_auto_enroll()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq record;
  v_conv record;
  v_count integer := 0;
begin
  for v_seq in
    select s.* from public.followup_sequences s
    join public.organizations o on o.id = s.organization_id and o.is_active
    where s.is_active and s.trigger = 'no_reply'
      and exists (select 1 from public.followup_steps st where st.sequence_id = s.id)
    order by s.created_at
  loop
    for v_conv in
      select c.id from public.conversations c
      where c.organization_id = v_seq.organization_id
        and c.status <> 'resolved'
        and c.last_customer_message_at is not null
        and c.last_customer_message_at < now() - make_interval(hours => v_seq.trigger_after_hours)
        and c.last_customer_message_at > now() - make_interval(hours => v_seq.trigger_after_hours + 48)
        and exists (
          select 1 from public.messages m
          where m.conversation_id = c.id and m.direction = 'outbound' and m.created_at > c.last_customer_message_at
        )
        and not exists (
          select 1 from public.followup_enrollments e
          where e.conversation_id = c.id and (e.status = 'active' or e.started_at > c.last_customer_message_at)
        )
        and (v_seq.label_id is null or exists (
          select 1 from public.conversation_labels cl where cl.conversation_id = c.id and cl.label_id = v_seq.label_id
        ))
      limit 200
    loop
      begin
        perform public.followup_enroll(v_conv.id, v_seq.id);
        v_count := v_count + 1;
      exception when unique_violation then
        null; -- entered by someone else meanwhile
      end;
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.followup_auto_enroll() from public, anon, authenticated;

-- Hands due steps to one sweep: each is pushed 10 minutes ahead so a second
-- sweep does not send it again while the first is still sending.
create or replace function public.followup_claim_due(p_limit integer default 30)
returns setof public.followup_enrollments
language sql
security definer
set search_path = ''
as $$
  update public.followup_enrollments e
  set next_send_at = now() + interval '10 minutes'
  where e.id in (
    select id from public.followup_enrollments
    where status = 'active' and next_send_at <= now()
    order by next_send_at
    limit p_limit
    for update skip locked
  )
  returning e.*
$$;
revoke execute on function public.followup_claim_due(integer) from public, anon, authenticated;

-- Records a send attempt and schedules the next step (or ends the sequence).
-- p_outcome: sent | retry (try again in 30 minutes, at most 3 times) | failed.
create or replace function public.followup_record_send(
  p_enrollment_id uuid, p_position integer, p_outcome text, p_message_id uuid, p_error text
)
returns public.followup_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.followup_enrollments;
  v_next integer;
begin
  select * into v_e from public.followup_enrollments where id = p_enrollment_id for update;
  if not found or v_e.status <> 'active' then
    return v_e;
  end if;

  insert into public.followup_sends (organization_id, enrollment_id, position, message_id, status, error)
  values (v_e.organization_id, v_e.id, p_position, p_message_id,
          case when p_outcome = 'sent' then 'sent' else 'failed' end, p_error);

  if p_outcome = 'sent' then
    select min(position) into v_next from public.followup_steps
    where sequence_id = v_e.sequence_id and position > p_position;
    update public.followup_enrollments
    set current_step = p_position, attempts = 0, last_error = null,
        status = case when v_next is null then 'completed' else 'active' end,
        ended_at = case when v_next is null then now() end,
        next_send_at = case when v_next is null then null else public.followup_step_due(v_e.sequence_id, v_next, now()) end
    where id = v_e.id
    returning * into v_e;
  elsif p_outcome = 'retry' and v_e.attempts < 2 then
    update public.followup_enrollments
    set attempts = attempts + 1, last_error = p_error, next_send_at = now() + interval '30 minutes'
    where id = v_e.id
    returning * into v_e;
  else
    update public.followup_enrollments
    set status = 'failed', last_error = p_error, stop_reason = p_error, ended_at = now(), next_send_at = null
    where id = v_e.id
    returning * into v_e;
  end if;
  return v_e;
end;
$$;
revoke execute on function public.followup_record_send(uuid, integer, text, uuid, text) from public, anon, authenticated;

-- A customer reply ends the follow-up: that is what it was for.
create or replace function public.followup_on_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'inbound' and new.type <> 'reaction' then
    update public.followup_enrollments
    set status = 'replied', replied_at = new.created_at, replied_after_step = current_step,
        ended_at = new.created_at, next_send_at = null
    where conversation_id = new.conversation_id and status = 'active';
  end if;
  return null;
end;
$$;

create trigger messages_followup_reply after insert on public.messages
  for each row execute function public.followup_on_reply();

-- ---------------------------------------------------------------------------
-- Tracking: results per sequence and per agent over the last p_days days
-- (chats the caller can see).
-- ---------------------------------------------------------------------------
create or replace function public.followup_stats(p_days integer default 30)
returns table (
  sequence_id uuid,
  agent_id uuid,
  enrolled bigint,
  active bigint,
  replied bigint,
  completed bigint,
  stopped bigint,
  failed bigint,
  messages_sent bigint,
  replied_by_step jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with e as (
    select * from public.followup_enrollments
    where organization_id = public.current_org_id()
      and started_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
  )
  select
    g.sequence_id,
    g.agent_id,
    count(*),
    count(*) filter (where g.status = 'active'),
    count(*) filter (where g.status = 'replied'),
    count(*) filter (where g.status = 'completed'),
    count(*) filter (where g.status = 'stopped'),
    count(*) filter (where g.status = 'failed'),
    coalesce(sum(g.current_step), 0)::bigint,
    coalesce((
      select jsonb_object_agg(r.step, r.n)
      from (
        select x.replied_after_step::text as step, count(*) as n
        from e x
        where x.status = 'replied' and x.sequence_id = g.sequence_id and x.agent_id is not distinct from g.agent_id
        group by x.replied_after_step
      ) r
    ), '{}'::jsonb)
  from e g
  group by g.sequence_id, g.agent_id
$$;
grant execute on function public.followup_stats(integer) to authenticated;

alter publication supabase_realtime add table public.followup_enrollments;
