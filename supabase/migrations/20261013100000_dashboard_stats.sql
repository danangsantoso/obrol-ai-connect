-- Messages per day for the dashboard chart, in the organization's time zone.
-- Runs as the caller, so it counts only messages of chats they may see.
create or replace function public.dashboard_daily_messages(p_days integer default 14)
returns table (day date, inbound bigint, outbound bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with org as (
    select coalesce(o.timezone, 'Asia/Jakarta') as tz
    from public.organizations o
    where o.id = public.current_org_id()
  ),
  days as (
    select generate_series(
      (now() at time zone (select tz from org))::date - (least(greatest(p_days, 1), 90) - 1),
      (now() at time zone (select tz from org))::date,
      interval '1 day'
    )::date as day
  ),
  counted as (
    select (m.created_at at time zone (select tz from org))::date as day,
           count(*) filter (where m.direction = 'inbound') as inbound,
           count(*) filter (where m.direction = 'outbound') as outbound
    from public.messages m
    where m.organization_id = public.current_org_id()
      and m.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90) + 1)
    group by 1
  )
  select d.day, coalesce(c.inbound, 0), coalesce(c.outbound, 0)
  from days d left join counted c on c.day = d.day
  order by d.day
$$;
