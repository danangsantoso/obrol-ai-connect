-- Two-step verification (TOTP, Supabase Auth MFA) and an activity log.
--
-- 2FA: once someone has a verified authenticator, their session only reaches
-- data after they entered a code (aal2). Enforced here, in the helpers every
-- row-level policy goes through, so skipping the code screen does not help.
-- Admins can require 2FA for admins and supervisors of their organization.
--
-- Activity log: who changed what and when (settings, numbers, team, AI,
-- products, orders, broadcasts, integrations, deleted contacts, exports and
-- sign-ins). Only admins read it; nobody can change it.

alter table public.organizations add column require_mfa boolean not null default false;

create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;

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
  where p.id = auth.uid() and p.is_active and public.mfa_ok()
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
  where p.id = auth.uid() and p.is_active and public.mfa_ok()
$$;

create or replace function public.is_master_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid()) and public.mfa_ok()
$$;

-- Chat access is checked here rather than through current_org_id().
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
  where p.id = auth.uid() and p.is_active and public.mfa_ok();
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
    return coalesce(
      conv.team_id is null
      or conv.team_id in (select public.current_team_ids())
      or conv.assignee_id in (
        select tm.profile_id from public.team_members tm
        where tm.team_id in (select public.current_team_ids())
      ),
      false
    );
  end if;

  return coalesce(
    (conv.assignee_id is null or conv.rotation_deadline < now())
      and (conv.team_id is null or conv.team_id in (select public.current_team_ids())),
    false
  );
end;
$$;

-- Own devices and own profile: also only after the code.
alter policy "people manage their own devices" on public.push_subscriptions
  using (user_id = auth.uid() and public.mfa_ok()) with check (user_id = auth.uid() and public.mfa_ok());
alter policy "update own profile" on public.profiles
  using (id = auth.uid() and public.mfa_ok()) with check (id = auth.uid() and public.mfa_ok());

-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  -- Kept as text so the entry stays readable after the person is removed.
  actor_name text,
  action text not null,
  entity text not null,
  entity_id text,
  entity_name text,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_created_idx on public.audit_log (organization_id, created_at desc);
alter table public.audit_log enable row level security;
create policy "admins read the activity log" on public.audit_log
  for select to authenticated using (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

create or replace function public.audit_write(
  p_org uuid, p_actor uuid, p_action text, p_entity text, p_entity_id text, p_entity_name text, p_changes jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (organization_id, actor_id, actor_name, action, entity, entity_id, entity_name, changes)
  select p_org, p_actor,
         (select coalesce(nullif(full_name, ''), email) from public.profiles where id = p_actor),
         p_action, p_entity, p_entity_id, left(p_entity_name, 200), p_changes
$$;
revoke execute on function public.audit_write(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;

-- Changes made by people through the app (auth.uid() set). Background work
-- (webhooks, AI, schedules) is not logged; Edge Functions log their own
-- actions explicitly with audit_write.
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb;
  -- Timestamps, counters and connection state change on their own.
  v_skip text := '^(id|organization_id|created_at|updated_at|created_by|last_.*|connection_.*|char_count|content|status_changed_at|.*_count)$';
  -- Never copy secrets into the log.
  v_secret text := '(secret|_hash|token|password|ciphertext)$';
begin
  if auth.uid() is null then
    return null;
  end if;
  select jsonb_object_agg(k, case
           when k ~ v_secret then jsonb_build_object('from', '•••', 'to', '•••')
           else jsonb_build_object('from', short_o, 'to', short_n) end)
  into v_changes
  from (
    select k,
           case when jsonb_typeof(o) = 'string' and length(o #>> '{}') > 160 then to_jsonb(left(o #>> '{}', 160) || '…') else o end as short_o,
           case when jsonb_typeof(n) = 'string' and length(n #>> '{}') > 160 then to_jsonb(left(n #>> '{}', 160) || '…') else n end as short_n
    from (
      select key as k, v_old -> key as o, v_new -> key as n
      from jsonb_object_keys(coalesce(v_new, v_old)) as key
    ) pairs
    where k !~ v_skip and (o is distinct from n) and (tg_op = 'UPDATE' or (case when tg_op = 'INSERT' then n else o end) is not null)
  ) diff;
  if tg_op = 'UPDATE' and v_changes is null then
    return null;
  end if;
  perform public.audit_write(
    coalesce((v_row ->> 'organization_id')::uuid, case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end),
    auth.uid(),
    lower(case tg_op when 'INSERT' then 'create' else tg_op end),
    v_entity,
    coalesce(v_row ->> 'id', v_row ->> 'organization_id'),
    coalesce(v_row ->> 'name', v_row ->> 'full_name', v_row ->> 'title', v_row ->> 'number', v_row ->> 'email', v_row ->> 'wa_id'),
    case when tg_op = 'UPDATE' then v_changes end
  );
  return null;
end;
$$;

create trigger audit_organizations after update on public.organizations
  for each row execute function public.audit_row('organization');
create trigger audit_profiles after update of full_name, role, is_active, max_open_chats on public.profiles
  for each row execute function public.audit_row('member');
create trigger audit_channels after insert or update or delete on public.channels
  for each row execute function public.audit_row('channel');
create trigger audit_ai_settings after update on public.ai_settings
  for each row execute function public.audit_row('ai_settings');
create trigger audit_payment_settings after update on public.payment_settings
  for each row execute function public.audit_row('payment_settings');
create trigger audit_api_keys after insert or update or delete on public.api_keys
  for each row execute function public.audit_row('api_key');
create trigger audit_webhooks after insert or update or delete on public.webhooks
  for each row execute function public.audit_row('webhook');
create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.audit_row('product');
create trigger audit_orders after insert or update or delete on public.orders
  for each row execute function public.audit_row('order');
create trigger audit_broadcasts after insert or update of status, name or delete on public.broadcasts
  for each row execute function public.audit_row('broadcast');
create trigger audit_followup_sequences after insert or update or delete on public.followup_sequences
  for each row execute function public.audit_row('followup');
create trigger audit_teams after insert or update or delete on public.teams
  for each row execute function public.audit_row('team');
create trigger audit_knowledge_docs after insert or delete on public.knowledge_docs
  for each row execute function public.audit_row('knowledge');
create trigger audit_ai_media after insert or update or delete on public.ai_media
  for each row execute function public.audit_row('ai_media');
create trigger audit_contacts after delete on public.contacts
  for each row execute function public.audit_row('contact');

-- Events the app reports itself: signing in and exporting data.
create or replace function public.log_activity(p_action text, p_entity text, p_entity_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('login', 'export') or public.current_org_id() is null then
    return;
  end if;
  perform public.audit_write(public.current_org_id(), auth.uid(), p_action, left(p_entity, 40), null, p_entity_name, null);
end;
$$;
revoke execute on function public.log_activity(text, text, text) from public, anon;
grant execute on function public.log_activity(text, text, text) to authenticated;
