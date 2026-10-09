-- Server health for the platform owner (Master Admin -> Kesehatan sistem):
-- the daily backup and the watchdog record their last result here, problems
-- reach Master Admins as push notifications, and errors from the web app,
-- the Android app and the Edge Functions are collected in app_errors.

create table public.system_status (
  key text primary key check (key ~ '^[a-z_]{1,40}$'),
  ok boolean not null,
  detail jsonb not null default '{}',
  checked_at timestamptz not null default now(),
  -- When ok last flipped (the start of the current problem or recovery).
  changed_at timestamptz not null default now()
);
alter table public.system_status enable row level security;
create policy "master admins read system status" on public.system_status
  for select to authenticated using (public.is_master_admin());

-- Push notification to every Master Admin (called by the VPS scripts).
create or replace function public.system_alert(p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admins uuid[];
begin
  select array_agg(user_id) into v_admins from public.platform_admins;
  perform public.notify_users(coalesce(v_admins, '{}'), p_title, p_body, '/master', 'system');
end;
$$;
revoke execute on function public.system_alert(text, text) from public, anon, authenticated;

create table public.app_errors (
  id bigint generated always as identity primary key,
  -- Same error from the same place counts as one row with occurrences.
  fingerprint text not null unique,
  source text not null check (source in ('web', 'mobile', 'function')),
  message text not null,
  detail text,
  url text,
  user_agent text,
  organization_id uuid references public.organizations (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  occurrences integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz
);
create index app_errors_last_seen_idx on public.app_errors (last_seen desc);
alter table public.app_errors enable row level security;
create policy "master admins read app errors" on public.app_errors
  for select to authenticated using (public.is_master_admin());

-- Errors are written only through report_app_error. A resolved error that
-- comes back is reopened. Bounded so a broken client cannot flood the table.
create or replace function public.report_app_error(
  p_source text, p_message text, p_detail text default null, p_url text default null, p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message text := left(coalesce(nullif(trim(p_message), ''), 'Error'), 500);
  v_detail text := left(p_detail, 4000);
  -- First stack line locates the error; ids and numbers vary per occurrence.
  v_where text := regexp_replace(coalesce(split_part(coalesce(v_detail, ''), E'\n', 2), ''), '[0-9a-f-]{8,}|\d+', '#', 'g');
  v_fp text;
begin
  if p_source not in ('web', 'mobile', 'function') then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  if auth.role() <> 'service_role' and p_source = 'function' then
    raise exception 'invalid source' using errcode = '42501';
  end if;
  v_fp := md5(p_source || '|' || regexp_replace(v_message, '[0-9a-f-]{8,}|\d+', '#', 'g') || '|' || v_where);
  if not exists (select 1 from public.app_errors where fingerprint = v_fp)
     and (select count(*) from public.app_errors where first_seen > now() - interval '1 hour') >= 200 then
    return;
  end if;
  insert into public.app_errors (fingerprint, source, message, detail, url, user_agent, organization_id, user_id)
  values (v_fp, p_source, v_message, v_detail, left(p_url, 500), left(p_user_agent, 300),
          public.current_org_id(), auth.uid())
  on conflict (fingerprint) do update
    set occurrences = public.app_errors.occurrences + 1, last_seen = now(), resolved_at = null,
        detail = excluded.detail, url = excluded.url, user_agent = excluded.user_agent;
end;
$$;
revoke execute on function public.report_app_error(text, text, text, text, text) from public, anon;
grant execute on function public.report_app_error(text, text, text, text, text) to authenticated, service_role;

create or replace function public.resolve_app_error(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_master_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.app_errors set resolved_at = now() where id = p_id;
end;
$$;
revoke execute on function public.resolve_app_error(bigint) from public, anon;
grant execute on function public.resolve_app_error(bigint) to authenticated;
