-- Subscription plans for tenants, set by the Master Admin: how many users and
-- channels a tenant may have, how many AI replies and broadcast messages per
-- month, and until when the plan runs (trial or paid period). A tenant
-- without a plan has no limits (existing installations keep working).

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  price_monthly numeric(14, 2) not null default 0 check (price_monthly >= 0),
  -- null = unlimited
  max_users integer check (max_users > 0),
  max_channels integer check (max_channels > 0),
  ai_replies_per_month integer check (ai_replies_per_month >= 0),
  broadcast_per_month integer check (broadcast_per_month >= 0),
  -- New tenants get the default plan, free for trial_days.
  is_default boolean not null default false,
  trial_days integer not null default 0 check (trial_days between 0 and 365),
  created_at timestamptz not null default now()
);
create unique index plans_one_default on public.plans (is_default) where is_default;

alter table public.organizations
  add column plan_id uuid references public.plans (id) on delete set null,
  add column plan_expires_at timestamptz;

alter table public.plans enable row level security;
create policy "master admins manage plans" on public.plans
  for all to authenticated using (public.is_master_admin()) with check (public.is_master_admin());
create policy "members read their plan" on public.plans
  for select to authenticated
  using (id = (select o.plan_id from public.organizations o where o.id = public.current_org_id()));

-- Plan, expiry and suspension are the platform's to set: a tenant admin
-- editing the organization cannot change them.
create or replace function public.organizations_guard_platform_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.is_master_admin() then
    return new;
  end if;
  new.plan_id := old.plan_id;
  new.plan_expires_at := old.plan_expires_at;
  new.is_active := old.is_active;
  new.suspended_at := old.suspended_at;
  return new;
end;
$$;
create trigger organizations_guard_platform_fields before update on public.organizations
  for each row execute function public.organizations_guard_platform_fields();

-- New tenants start on the default plan (with its trial period).
create or replace function public.organizations_default_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
begin
  if new.plan_id is null then
    select * into v_plan from public.plans where is_default;
    if found then
      new.plan_id := v_plan.id;
      if v_plan.trial_days > 0 then
        new.plan_expires_at := now() + make_interval(days => v_plan.trial_days);
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger organizations_default_plan before insert on public.organizations
  for each row execute function public.organizations_default_plan();

-- ---------------------------------------------------------------------------
-- Usage per calendar month (organization time zone)
-- ---------------------------------------------------------------------------
create table public.usage_monthly (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  month date not null,
  ai_replies integer not null default 0,
  broadcast_messages integer not null default 0,
  primary key (organization_id, month)
);
alter table public.usage_monthly enable row level security;
create policy "members read usage" on public.usage_monthly
  for select to authenticated using (organization_id = public.current_org_id() or public.is_master_admin());

create or replace function public.usage_month(p_org uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('month', now() at time zone o.timezone)::date from public.organizations o where o.id = p_org
$$;

-- Takes up to p_amount from this month's allowance and returns how much was
-- granted (0 when used up or the plan has expired). Service role only.
create or replace function public.use_quota(p_org uuid, p_kind text, p_amount integer default 1)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_expires timestamptz;
  v_limit integer;
  v_month date := public.usage_month(p_org);
  v_used integer;
  v_granted integer;
begin
  if p_kind not in ('ai_replies', 'broadcast_messages') or p_amount < 1 then
    raise exception 'invalid quota request' using errcode = '22023';
  end if;
  select o.plan_expires_at into v_expires from public.organizations o where o.id = p_org;
  select p.* into v_plan from public.plans p where p.id = (select o.plan_id from public.organizations o where o.id = p_org);
  insert into public.usage_monthly (organization_id, month) values (p_org, v_month) on conflict do nothing;
  if v_plan.id is not null and v_expires is not null and v_expires < now() then
    return 0;
  end if;
  v_limit := case p_kind when 'ai_replies' then v_plan.ai_replies_per_month else v_plan.broadcast_per_month end;
  execute format('select %I from public.usage_monthly where organization_id = $1 and month = $2 for update', p_kind)
    into v_used using p_org, v_month;
  v_granted := case when v_limit is null then p_amount else greatest(0, least(p_amount, v_limit - v_used)) end;
  if v_granted > 0 then
    execute format('update public.usage_monthly set %I = %I + $3 where organization_id = $1 and month = $2', p_kind, p_kind)
      using p_org, v_month, v_granted;
  end if;
  return v_granted;
end;
$$;
revoke execute on function public.use_quota(uuid, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Users and channels limits
-- ---------------------------------------------------------------------------
create or replace function public.enforce_user_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_count integer;
begin
  if new.organization_id is null or not new.is_active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.organization_id is not distinct from new.organization_id and old.is_active then
    return new;
  end if;
  select p.max_users into v_max from public.organizations o join public.plans p on p.id = o.plan_id where o.id = new.organization_id;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_count from public.profiles where organization_id = new.organization_id and is_active and id <> new.id;
  if v_count >= v_max then
    raise exception 'Kuota pengguna paket sudah penuh (% pengguna). Hubungi pengelola platform untuk menaikkan paket.', v_max
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger profiles_user_limit before insert or update of organization_id, is_active on public.profiles
  for each row execute function public.enforce_user_limit();

create or replace function public.enforce_channel_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_count integer;
begin
  select p.max_channels into v_max from public.organizations o join public.plans p on p.id = o.plan_id where o.id = new.organization_id;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_count from public.channels where organization_id = new.organization_id;
  if v_count >= v_max then
    raise exception 'Kuota kanal paket sudah penuh (% kanal). Hubungi pengelola platform untuk menaikkan paket.', v_max
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger channels_limit before insert on public.channels
  for each row execute function public.enforce_channel_limit();

-- ---------------------------------------------------------------------------
-- Overviews
-- ---------------------------------------------------------------------------
-- The tenant's own plan and usage.
create or replace function public.org_plan_usage()
returns table (
  plan_name text, price_monthly numeric, expires_at timestamptz, expired boolean,
  users bigint, max_users integer, channels bigint, max_channels integer,
  ai_replies integer, ai_replies_per_month integer, broadcast_messages integer, broadcast_per_month integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.name, p.price_monthly, o.plan_expires_at, coalesce(o.plan_expires_at < now(), false),
    (select count(*) from public.profiles x where x.organization_id = o.id and x.is_active), p.max_users,
    (select count(*) from public.channels c where c.organization_id = o.id), p.max_channels,
    coalesce(u.ai_replies, 0), p.ai_replies_per_month, coalesce(u.broadcast_messages, 0), p.broadcast_per_month
  from public.organizations o
  left join public.plans p on p.id = o.plan_id
  left join public.usage_monthly u on u.organization_id = o.id and u.month = public.usage_month(o.id)
  where o.id = public.current_org_id()
$$;
grant execute on function public.org_plan_usage() to authenticated;

drop function public.master_tenant_overview();
create function public.master_tenant_overview()
returns table (
  id uuid,
  name text,
  is_active boolean,
  created_at timestamptz,
  suspended_at timestamptz,
  members bigint,
  channels bigint,
  conversations bigint,
  superadmins jsonb,
  plan_id uuid,
  plan_name text,
  plan_expires_at timestamptz,
  ai_replies_month integer,
  broadcast_month integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_master_admin() then
    raise exception 'only a Master Admin can see tenants' using errcode = '42501';
  end if;
  return query
  select o.id, o.name, o.is_active, o.created_at, o.suspended_at,
         (select count(*) from public.profiles p where p.organization_id = o.id and p.is_active),
         (select count(*) from public.channels c where c.organization_id = o.id),
         (select count(*) from public.conversations c where c.organization_id = o.id),
         coalesce((
           select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email,
                                               'must_change_password', p.must_change_password) order by p.created_at)
           from public.profiles p where p.organization_id = o.id and p.role = 'admin' and p.is_active
         ), '[]'::jsonb),
         o.plan_id, pl.name, o.plan_expires_at,
         coalesce(u.ai_replies, 0), coalesce(u.broadcast_messages, 0)
  from public.organizations o
  left join public.plans pl on pl.id = o.plan_id
  left join public.usage_monthly u on u.organization_id = o.id and u.month = public.usage_month(o.id)
  order by o.created_at desc;
end;
$$;
grant execute on function public.master_tenant_overview() to authenticated;
