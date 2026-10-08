-- Team performance: response times against an SLA target, resolution times,
-- satisfaction, and sales, per agent and for the AI.

-- Who resolved each chat episode and how long it was open. Kept separately
-- because the chat's assignee may be cleared when it is resolved.
create table public.conversation_resolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  agent_id uuid references public.profiles (id) on delete set null,
  by_ai boolean not null default false,
  opened_at timestamptz not null,
  resolved_at timestamptz not null default now()
);
create index conversation_resolutions_org_idx on public.conversation_resolutions (organization_id, resolved_at);
alter table public.conversation_resolutions enable row level security;
create policy "managers read resolutions" on public.conversation_resolutions
  for select to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

create or replace function public.log_resolution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' then
    insert into public.conversation_resolutions (organization_id, conversation_id, agent_id, by_ai, opened_at)
    values (
      new.organization_id, new.id, coalesce(old.assignee_id, auth.uid()),
      old.assignee_id is null and auth.uid() is null and old.ai_engaged, old.opened_at
    );
  end if;
  return null;
end;
$$;
create trigger conversations_log_resolution after update of status on public.conversations
  for each row execute function public.log_resolution();

-- Chats already resolved before this report existed.
insert into public.conversation_resolutions (organization_id, conversation_id, agent_id, by_ai, opened_at, resolved_at)
select organization_id, id, assignee_id, assignee_id is null and ai_engaged, opened_at, resolved_at
from public.conversations
where status = 'resolved' and resolved_at is not null;

-- Replies that answer the customer, with how long the customer waited:
-- from the first unanswered customer message to the reply. Automatic
-- messages (follow-ups, broadcasts, surveys, away messages, order notices)
-- are not replies.
create or replace function public.reply_waits(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (conversation_id uuid, replied_at timestamptz, sender_id uuid, is_ai boolean, from_phone boolean, wait_seconds numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select id, conversation_id, direction, created_at, sender_id,
      coalesce((metadata ->> 'ai')::boolean, false) as is_ai,
      coalesce((metadata ->> 'sent_from_phone')::boolean, false) as from_phone,
      direction = 'outbound' as is_reply
    from public.messages
    where organization_id = p_org
      and created_at >= p_from - interval '7 days' and created_at < p_to
      and type <> 'reaction'
      and (direction = 'inbound' or not (metadata ?| array['followup', 'broadcast', 'csat', 'away', 'order']))
  ),
  w as (
    select *,
      max(case when is_reply then created_at end) over (
        partition by conversation_id order by created_at rows between unbounded preceding and 1 preceding
      ) as prev_reply
    from m
  ),
  replies as (
    select r.*, (
      select min(i.created_at) from m i
      where i.conversation_id = r.conversation_id and i.direction = 'inbound'
        and i.created_at > coalesce(r.prev_reply, '-infinity'::timestamptz) and i.created_at < r.created_at
    ) as wait_start
    from w r
    where r.is_reply and r.created_at >= p_from
  )
  select conversation_id, created_at, sender_id, is_ai, from_phone, extract(epoch from created_at - wait_start)
  from replies
  where wait_start is not null
$$;
revoke execute on function public.reply_waits(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- One row per agent, plus the AI ("ai") and replies typed on the linked phone ("phone").
create or replace function public.performance_report(p_from timestamptz, p_to timestamptz, p_sla_minutes integer default 5)
returns table (
  actor text,
  agent_id uuid,
  replies bigint,
  chats bigint,
  median_response_seconds numeric,
  avg_response_seconds numeric,
  within_sla bigint,
  resolved bigint,
  median_resolution_minutes numeric,
  csat_answered bigint,
  csat_average numeric,
  orders_paid bigint,
  revenue numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if public.current_role_name() not in ('admin', 'supervisor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with waits as (
    select case when w.is_ai then 'ai' when w.sender_id is null then 'phone' else 'agent' end as actor, w.sender_id as agent_id,
           w.conversation_id, w.wait_seconds
    from public.reply_waits(v_org, p_from, p_to) w
  ),
  r as (
    select waits.actor, waits.agent_id, count(*) as replies, count(distinct waits.conversation_id) as chats,
      percentile_cont(0.5) within group (order by waits.wait_seconds)::numeric as median_s,
      avg(waits.wait_seconds) as avg_s,
      count(*) filter (where waits.wait_seconds <= p_sla_minutes * 60) as sla
    from waits group by waits.actor, waits.agent_id
  ),
  res as (
    select case when x.by_ai then 'ai' else 'agent' end as actor, case when x.by_ai then null else x.agent_id end as agent_id,
      count(*) as n,
      percentile_cont(0.5) within group (order by extract(epoch from x.resolved_at - x.opened_at) / 60)::numeric as median_m
    from public.conversation_resolutions x
    where x.organization_id = v_org and x.resolved_at >= p_from and x.resolved_at < p_to and (x.by_ai or x.agent_id is not null)
    group by 1, 2
  ),
  cs as (
    select case when c.handled_by_ai then 'ai' else 'agent' end as actor, case when c.handled_by_ai then null else c.agent_id end as agent_id,
      count(*) as n, round(avg(c.rating), 2) as avg_rating
    from public.csat_requests c
    where c.organization_id = v_org and c.status = 'answered' and c.answered_at >= p_from and c.answered_at < p_to
      and (c.handled_by_ai or c.agent_id is not null)
    group by 1, 2
  ),
  o as (
    select case when x.created_by_ai then 'ai' else 'agent' end as actor, case when x.created_by_ai then null else x.created_by end as agent_id,
      count(*) as n, sum(x.total) as total
    from public.orders x
    where x.organization_id = v_org and x.paid_at >= p_from and x.paid_at < p_to
      and x.status in ('paid', 'processing', 'shipped', 'completed') and (x.created_by_ai or x.created_by is not null)
    group by 1, 2
  ),
  keys as (
    select k.actor, k.agent_id from r k union select k.actor, k.agent_id from res k
    union select k.actor, k.agent_id from cs k union select k.actor, k.agent_id from o k
  )
  select k.actor, k.agent_id,
    coalesce(r.replies, 0), coalesce(r.chats, 0), round(r.median_s, 1), round(r.avg_s, 1), coalesce(r.sla, 0),
    coalesce(res.n, 0), round(res.median_m, 1),
    coalesce(cs.n, 0), cs.avg_rating,
    coalesce(o.n, 0), coalesce(o.total, 0)
  from keys k
  left join r on r.actor = k.actor and r.agent_id is not distinct from k.agent_id
  left join res on res.actor = k.actor and res.agent_id is not distinct from k.agent_id
  left join cs on cs.actor = k.actor and cs.agent_id is not distinct from k.agent_id
  left join o on o.actor = k.actor and o.agent_id is not distinct from k.agent_id;
end;
$$;
grant execute on function public.performance_report(timestamptz, timestamptz, integer) to authenticated;

-- Per day (organization time zone): chats started, replies, median response and SLA share.
create or replace function public.performance_daily(p_from timestamptz, p_to timestamptz, p_sla_minutes integer default 5)
returns table (day date, new_chats bigint, replies bigint, median_response_seconds numeric, within_sla bigint, resolved bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_tz text;
begin
  if public.current_role_name() not in ('admin', 'supervisor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select timezone into v_tz from public.organizations where id = v_org;
  return query
  with days as (
    select generate_series((p_from at time zone v_tz)::date, ((p_to - interval '1 second') at time zone v_tz)::date, interval '1 day')::date as d
  ),
  w as (
    select (x.replied_at at time zone v_tz)::date as d, x.wait_seconds from public.reply_waits(v_org, p_from, p_to) x
  ),
  c as (
    select (x.created_at at time zone v_tz)::date as d, count(*) as n from public.conversations x
    where x.organization_id = v_org and x.created_at >= p_from and x.created_at < p_to group by 1
  ),
  res as (
    select (x.resolved_at at time zone v_tz)::date as d, count(*) as n from public.conversation_resolutions x
    where x.organization_id = v_org and x.resolved_at >= p_from and x.resolved_at < p_to group by 1
  )
  select days.d,
    coalesce((select c.n from c where c.d = days.d), 0),
    (select count(*) from w where w.d = days.d),
    (select round(percentile_cont(0.5) within group (order by w.wait_seconds)::numeric, 1) from w where w.d = days.d),
    (select count(*) from w where w.d = days.d and w.wait_seconds <= p_sla_minutes * 60),
    coalesce((select res.n from res where res.d = days.d), 0)
  from days
  order by days.d;
end;
$$;
grant execute on function public.performance_daily(timestamptz, timestamptz, integer) to authenticated;
