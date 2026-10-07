-- Multi-tenant platform: every organization is a tenant, isolated by RLS.
-- A Master Admin (platform owner) sits outside all tenants: creates tenants
-- with their first Superadmin (the tenant's admin), suspends/reactivates them
-- and resets Superadmin passwords. Master Admins see tenant counts only, never
-- chat data, and tenants never see each other.

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Service role only.
alter table public.platform_admins enable row level security;

create or replace function public.is_master_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

alter table public.organizations
  add column is_active boolean not null default true,
  add column suspended_at timestamptz;

-- A suspended tenant's members lose all access (their logins are also banned
-- by the master-admin function).
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  join public.organizations o on o.id = p.organization_id and o.is_active
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.current_role_name()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  join public.organizations o on o.id = p.organization_id and o.is_active
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.can_access_conversation(conv_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  conv record;
  me record;
begin
  select organization_id, team_id, assignee_id, rotation_deadline into conv
  from public.conversations where id = conv_id;
  if not found then
    return false;
  end if;

  select p.id, p.organization_id, p.role into me
  from public.profiles p
  join public.organizations o on o.id = p.organization_id and o.is_active
  where p.id = auth.uid() and p.is_active;
  if not found or me.organization_id is distinct from conv.organization_id then
    return false;
  end if;

  if me.role = 'admin' then
    return true;
  end if;

  if conv.assignee_id = me.id then
    return true;
  end if;

  if exists (
    select 1 from public.notes n
    where n.conversation_id = conv_id and me.id = any (n.mentions)
  ) then
    return true;
  end if;

  if me.role = 'supervisor' then
    return conv.team_id is null
      or conv.team_id in (select public.current_team_ids())
      or conv.assignee_id in (
        select tm.profile_id from public.team_members tm
        where tm.team_id in (select public.current_team_ids())
      );
  end if;

  return (conv.assignee_id is null or conv.rotation_deadline < now())
    and (conv.team_id is null or conv.team_id in (select public.current_team_ids()));
end;
$$;

-- Self-service tenant creation is only for a fresh single-tenant install.
-- Once a Master Admin exists, tenants are created from the Master Admin console.
create or replace function public.create_organization(org_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_admins) then
    raise exception 'Organisasi baru dibuat oleh Master Admin. Hubungi pengelola Balas.id.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and organization_id is not null) then
    raise exception 'you already belong to an organization' using errcode = '42501';
  end if;

  insert into public.organizations (name) values (trim(org_name)) returning id into new_org;

  perform set_config('balas.trusted', 'on', true);
  update public.profiles set organization_id = new_org, role = 'admin' where id = auth.uid();
  perform set_config('balas.trusted', 'off', true);

  return new_org;
end;
$$;

-- Master Admin console: one row per tenant with counts only.
create or replace function public.master_tenant_overview()
returns table (
  id uuid,
  name text,
  is_active boolean,
  created_at timestamptz,
  suspended_at timestamptz,
  members bigint,
  channels bigint,
  conversations bigint,
  superadmins jsonb
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
         ), '[]'::jsonb)
  from public.organizations o
  order by o.created_at desc;
end;
$$;

-- Suspended tenants send no webhooks (AI replies are skipped in the functions).
create or replace function public.enqueue_webhook_event(p_org uuid, p_event text, p_data jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Suspended tenants send no webhooks.
  if not exists (select 1 from public.organizations o where o.id = p_org and o.is_active) then
    return 0;
  end if;
  insert into public.webhook_deliveries (organization_id, webhook_id, event, payload)
  select w.organization_id, w.id, p_event,
         jsonb_build_object('event', p_event, 'organization_id', p_org, 'created_at', now(), 'data', p_data)
  from public.webhooks w
  where w.organization_id = p_org and w.is_active
    and (cardinality(w.events) = 0 or p_event = any (w.events) or p_event = 'ping');
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.wake_webhook_dispatch();
  end if;
  return v_count;
end;
$$;
revoke execute on function public.enqueue_webhook_event(uuid, text, jsonb) from public, anon, authenticated;
