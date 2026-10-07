-- Self sign-up (Google or email) on a multi-tenant platform: the new user asks
-- for a tenant and waits; a Master Admin approves (the tenant is created and
-- the user becomes its Superadmin) or rejects. Until then the user has no
-- tenant and sees no data.

create table public.tenant_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  company_name text not null check (char_length(company_name) between 2 and 120),
  phone text check (char_length(phone) <= 40),
  note text check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  organization_id uuid references public.organizations (id) on delete set null,
  reject_reason text check (char_length(reject_reason) <= 300),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tenant_requests_pending_idx on public.tenant_requests (created_at) where status = 'pending';
alter table public.tenant_requests enable row level security;
create policy "users read their own tenant request" on public.tenant_requests
  for select to authenticated using (user_id = auth.uid());

-- 'approval' once a Master Admin exists (multi-tenant), else 'self' (a fresh
-- single-company install where the first user creates the organization).
create or replace function public.registration_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from public.platform_admins) then 'approval' else 'self' end
$$;

-- The signed-in user asks for a tenant (again after a rejection).
create or replace function public.request_tenant(p_company text, p_phone text default null, p_note text default null)
returns public.tenant_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users;
  v_name text;
  result public.tenant_requests;
begin
  select * into v_user from auth.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = v_user.id and organization_id is not null)
     or public.is_master_admin() then
    raise exception 'Akun ini sudah punya akses' using errcode = '42501';
  end if;
  if exists (select 1 from public.tenant_requests where user_id = v_user.id and status = 'approved') then
    raise exception 'Permintaan ini sudah disetujui' using errcode = '42501';
  end if;
  v_name := coalesce(nullif(v_user.raw_user_meta_data ->> 'full_name', ''), nullif(v_user.raw_user_meta_data ->> 'name', ''));

  insert into public.tenant_requests (user_id, email, full_name, company_name, phone, note)
  values (v_user.id, v_user.email, v_name, trim(p_company), nullif(trim(p_phone), ''), nullif(trim(p_note), ''))
  on conflict (user_id) do update
    set company_name = excluded.company_name, phone = excluded.phone, note = excluded.note,
        full_name = coalesce(excluded.full_name, public.tenant_requests.full_name),
        status = 'pending', reject_reason = null, reviewed_by = null, reviewed_at = null, updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.master_tenant_requests()
returns setof public.tenant_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_master_admin() then
    raise exception 'only a Master Admin can see registration requests' using errcode = '42501';
  end if;
  return query
  select * from public.tenant_requests
  order by (status = 'pending') desc, created_at desc
  limit 200;
end;
$$;

-- Approve: create the tenant and make the requester its Superadmin.
create or replace function public.approve_tenant_request(request_id uuid, tenant_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.tenant_requests;
  new_org uuid;
begin
  if not public.is_master_admin() then
    raise exception 'only a Master Admin can approve' using errcode = '42501';
  end if;
  select * into req from public.tenant_requests where id = request_id for update;
  if req.id is null or req.status <> 'pending' then
    raise exception 'request is not pending' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles where id = req.user_id and organization_id is not null)
     or exists (select 1 from public.platform_admins where user_id = req.user_id) then
    raise exception 'this account already has access' using errcode = '42501';
  end if;

  insert into public.organizations (name) values (coalesce(nullif(trim(tenant_name), ''), req.company_name))
  returning id into new_org;
  perform set_config('balas.trusted', 'on', true);
  update public.profiles
  set organization_id = new_org, role = 'admin', full_name = coalesce(full_name, req.full_name)
  where id = req.user_id;
  perform set_config('balas.trusted', 'off', true);

  update public.tenant_requests
  set status = 'approved', organization_id = new_org, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = request_id;
  return new_org;
end;
$$;

create or replace function public.reject_tenant_request(request_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_master_admin() then
    raise exception 'only a Master Admin can reject' using errcode = '42501';
  end if;
  update public.tenant_requests
  set status = 'rejected', reject_reason = nullif(trim(reason), ''), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = request_id and status = 'pending';
  if not found then
    raise exception 'request is not pending' using errcode = 'P0002';
  end if;
end;
$$;
