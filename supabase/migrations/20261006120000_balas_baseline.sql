-- Balas.id baseline schema
-- Shared WhatsApp inbox + light CRM for customer service teams.
-- Multi-tenant: every row belongs to an organization; access is enforced with RLS.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'supervisor', 'agent');
create type public.agent_status as enum ('online', 'away', 'offline');
create type public.conversation_status as enum ('open', 'pending', 'resolved');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_status as enum ('received', 'sent', 'delivered', 'read', 'failed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  timezone text not null default 'Asia/Jakarta',
  retention_days integer not null default 180 check (retention_days between 30 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  email text not null,
  full_name text,
  avatar_url text,
  role public.app_role not null default 'agent',
  status public.agent_status not null default 'offline',
  max_open_chats integer not null default 20 check (max_open_chats between 1 and 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_organization_id_idx on public.profiles (organization_id);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);
create index team_members_profile_id_idx on public.team_members (profile_id);

-- One row per WhatsApp Business phone number. Access tokens are NOT stored here:
-- they live in the Edge Function environment (see deploy/README.md).
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  phone_number_id text not null unique,
  waba_id text,
  display_phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index channels_organization_id_idx on public.channels (organization_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  wa_id text not null,
  name text,
  profile_name text,
  email text,
  company text,
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, wa_id)
);

-- One conversation thread per contact per channel. A resolved thread is
-- re-opened when the customer writes again (opened_at marks the new episode).
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  assignee_id uuid references public.profiles (id) on delete set null,
  status public.conversation_status not null default 'open',
  unread_count integer not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  last_customer_message_at timestamptz,
  opened_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, contact_id)
);
create index conversations_org_last_message_idx on public.conversations (organization_id, last_message_at desc);
create index conversations_assignee_idx on public.conversations (assignee_id, status);
create index conversations_team_idx on public.conversations (team_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction public.message_direction not null,
  type text not null default 'text',
  body text,
  media_path text,
  media_mime text,
  media_filename text,
  wa_message_id text unique,
  reply_to_wa_id text,
  status public.message_status not null,
  error jsonb,
  sender_id uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index messages_org_created_idx on public.messages (organization_id, created_at);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 5000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index notes_conversation_idx on public.notes (conversation_id, created_at);

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  color text not null default '#2563EB',
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.conversation_labels (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  primary key (conversation_id, label_id)
);

create table public.contact_labels (
  contact_id uuid not null references public.contacts (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  primary key (contact_id, label_id)
);

-- owner_id null = shared with the whole organization.
create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete cascade,
  shortcut text not null check (shortcut ~ '^[a-z0-9_-]{1,32}$'),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quick_replies_org_idx on public.quick_replies (organization_id);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  name text not null,
  language text not null,
  category text,
  status text,
  components jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (channel_id, name, language)
);

create table public.assignment_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  from_assignee_id uuid references public.profiles (id) on delete set null,
  to_assignee_id uuid references public.profiles (id) on delete set null,
  from_team_id uuid references public.teams (id) on delete set null,
  to_team_id uuid references public.teams (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index assignment_logs_conversation_idx on public.assignment_logs (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger channels_updated_at before update on public.channels
  for each row execute function public.set_updated_at();
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();
create trigger quick_replies_updated_at before update on public.quick_replies
  for each row execute function public.set_updated_at();
create trigger templates_updated_at before update on public.templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.current_role_name()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.current_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select team_id from public.team_members where profile_id = auth.uid()
$$;

-- Admin: whole organization. Supervisor: unrouted chats, their teams' chats and
-- chats held by their teams' members. Agent: own chats + the unassigned queue
-- of their teams (or of no team).
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
  select organization_id, team_id, assignee_id into conv
  from public.conversations where id = conv_id;
  if not found then
    return false;
  end if;

  select id, organization_id, role into me
  from public.profiles where id = auth.uid() and is_active;
  if not found or me.organization_id is distinct from conv.organization_id then
    return false;
  end if;

  if me.role = 'admin' then
    return true;
  end if;

  if conv.assignee_id = me.id then
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

  return conv.assignee_id is null
    and (conv.team_id is null or conv.team_id in (select public.current_team_ids()));
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles: created on sign-up; org/role/active can only change through
-- trusted paths (service role, Balas.id RPCs, or an admin of the same org).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is not distinct from old.organization_id
     and new.role = old.role
     and new.is_active = old.is_active
     and new.max_open_chats = old.max_open_chats
     and new.email = old.email then
    return new;
  end if;

  -- service role / database owner / trusted RPCs
  if auth.uid() is null or current_setting('balas.trusted', true) = 'on' then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id or new.email <> old.email then
    raise exception 'organization and email cannot be changed here' using errcode = '42501';
  end if;

  if new.id = auth.uid() then
    raise exception 'you cannot change your own role or access' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role = 'admin'
      and p.organization_id = old.organization_id
  ) then
    raise exception 'only an admin can change roles and access' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_changes();

-- ---------------------------------------------------------------------------
-- RPCs used by the web app
-- ---------------------------------------------------------------------------

-- First-time setup: the signed-in user creates an organization and becomes its admin.
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

-- Agent takes an unassigned chat from the queue. Atomic: fails if someone else took it.
create or replace function public.claim_conversation(conv_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.conversations;
begin
  if not public.can_access_conversation(conv_id) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;

  update public.conversations
  set assignee_id = auth.uid(),
      status = case when status = 'resolved' then 'open'::public.conversation_status else status end
  where id = conv_id and assignee_id is null
  returning * into result;

  if result.id is null then
    raise exception 'conversation is already handled by another agent' using errcode = 'P0001';
  end if;

  insert into public.assignment_logs (organization_id, conversation_id, to_assignee_id, to_team_id, from_team_id, actor_id, note)
  values (result.organization_id, conv_id, auth.uid(), result.team_id, result.team_id, auth.uid(), 'claimed');

  return result;
end;
$$;

-- Assign / transfer to an agent and/or team (null assignee = back to the queue).
create or replace function public.assign_conversation(
  conv_id uuid,
  to_assignee uuid,
  to_team uuid default null,
  note text default null
)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.conversations;
  result public.conversations;
begin
  if not public.can_access_conversation(conv_id) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;

  select * into conv from public.conversations where id = conv_id for update;

  if to_assignee is not null and not exists (
    select 1 from public.profiles
    where id = to_assignee and organization_id = conv.organization_id and is_active
  ) then
    raise exception 'assignee is not an active member of this organization' using errcode = '22023';
  end if;

  if to_team is not null and not exists (
    select 1 from public.teams where id = to_team and organization_id = conv.organization_id
  ) then
    raise exception 'team does not belong to this organization' using errcode = '22023';
  end if;

  update public.conversations
  set assignee_id = to_assignee,
      team_id = coalesce(to_team, team_id)
  where id = conv_id
  returning * into result;

  insert into public.assignment_logs (
    organization_id, conversation_id, from_assignee_id, to_assignee_id,
    from_team_id, to_team_id, actor_id, note
  ) values (
    conv.organization_id, conv_id, conv.assignee_id, to_assignee,
    conv.team_id, result.team_id, auth.uid(), nullif(trim(note), '')
  );

  return result;
end;
$$;

create or replace function public.set_conversation_status(
  conv_id uuid,
  new_status public.conversation_status
)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.conversations;
begin
  if not public.can_access_conversation(conv_id) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;

  update public.conversations
  set status = new_status,
      resolved_at = case when new_status = 'resolved' then now() else null end,
      opened_at = case when status = 'resolved' and new_status <> 'resolved' then now() else opened_at end,
      first_response_at = case when status = 'resolved' and new_status <> 'resolved' then null else first_response_at end
  where id = conv_id
  returning * into result;

  return result;
end;
$$;

create or replace function public.mark_conversation_read(conv_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_access_conversation(conv_id) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;
  update public.conversations set unread_count = 0 where id = conv_id and unread_count <> 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ingestion helpers (called by Edge Functions with the service role only)
-- ---------------------------------------------------------------------------

-- Stores one inbound WhatsApp message. Idempotent on wa_message_id: a webhook
-- retry returns the existing row with inserted = false and changes nothing.
create or replace function public.ingest_inbound_message(
  p_phone_number_id text,
  p_wa_id text,
  p_profile_name text,
  p_wa_message_id text,
  p_type text,
  p_body text,
  p_reply_to_wa_id text,
  p_metadata jsonb,
  p_sent_at timestamptz
)
returns table (message_id uuid, conversation_id uuid, organization_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  ch public.channels;
  v_contact_id uuid;
  v_conv public.conversations;
  v_message_id uuid;
  v_existing_conv uuid;
  v_at timestamptz := coalesce(p_sent_at, now());
begin
  select * into ch from public.channels where phone_number_id = p_phone_number_id and is_active;
  if not found then
    raise exception 'unknown channel %', p_phone_number_id using errcode = 'P0002';
  end if;

  select m.id, m.conversation_id into v_message_id, v_existing_conv
  from public.messages m where m.wa_message_id = p_wa_message_id;
  if v_message_id is not null then
    return query select v_message_id, v_existing_conv, ch.organization_id, false;
    return;
  end if;

  insert into public.contacts (organization_id, wa_id, profile_name)
  values (ch.organization_id, p_wa_id, nullif(p_profile_name, ''))
  on conflict (organization_id, wa_id)
    do update set profile_name = coalesce(excluded.profile_name, public.contacts.profile_name)
  returning id into v_contact_id;

  insert into public.conversations (organization_id, channel_id, contact_id)
  values (ch.organization_id, ch.id, v_contact_id)
  on conflict (channel_id, contact_id) do nothing;

  select * into v_conv from public.conversations c
  where c.channel_id = ch.id and c.contact_id = v_contact_id
  for update;

  insert into public.messages (
    organization_id, conversation_id, direction, type, body,
    wa_message_id, reply_to_wa_id, status, metadata, created_at
  ) values (
    ch.organization_id, v_conv.id, 'inbound', coalesce(p_type, 'text'), p_body,
    p_wa_message_id, p_reply_to_wa_id, 'received', coalesce(p_metadata, '{}'::jsonb), v_at
  )
  on conflict (wa_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is null then
    -- lost a race with a concurrent retry of the same message
    select m.id into v_message_id from public.messages m where m.wa_message_id = p_wa_message_id;
    return query select v_message_id, v_conv.id, ch.organization_id, false;
    return;
  end if;

  update public.conversations c
  set unread_count = c.unread_count + 1,
      last_message_at = greatest(coalesce(c.last_message_at, v_at), v_at),
      last_message_preview = left(coalesce(p_body, '[' || coalesce(p_type, 'pesan') || ']'), 160),
      last_customer_message_at = greatest(coalesce(c.last_customer_message_at, v_at), v_at),
      status = case when c.status = 'resolved' then 'open'::public.conversation_status
                    when c.status = 'pending' then 'open'::public.conversation_status
                    else c.status end,
      opened_at = case when c.status = 'resolved' then now() else c.opened_at end,
      first_response_at = case when c.status = 'resolved' then null else c.first_response_at end,
      resolved_at = case when c.status = 'resolved' then null else c.resolved_at end
  where c.id = v_conv.id;

  return query select v_message_id, v_conv.id, ch.organization_id, true;
end;
$$;

-- Applies a delivery status from the webhook. Status only moves forward
-- (sent -> delivered -> read); failed always wins.
create or replace function public.apply_message_status(
  p_wa_message_id text,
  p_status public.message_status,
  p_error jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages
  set status = p_status,
      error = coalesce(p_error, error)
  where wa_message_id = p_wa_message_id
    and direction = 'outbound'
    and (
      p_status = 'failed'
      or (status = 'sent' and p_status in ('delivered', 'read'))
      or (status = 'delivered' and p_status = 'read')
    );
$$;

-- Records a message an agent sent through the Cloud API.
create or replace function public.record_outbound_message(
  p_conversation_id uuid,
  p_sender_id uuid,
  p_wa_message_id text,
  p_type text,
  p_body text,
  p_media_path text,
  p_media_mime text,
  p_media_filename text,
  p_reply_to_wa_id text,
  p_metadata jsonb
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.conversations;
  result public.messages;
begin
  select * into conv from public.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;

  insert into public.messages (
    organization_id, conversation_id, direction, type, body, media_path, media_mime,
    media_filename, wa_message_id, reply_to_wa_id, status, sender_id, metadata
  ) values (
    conv.organization_id, conv.id, 'outbound', p_type, p_body, p_media_path, p_media_mime,
    p_media_filename, p_wa_message_id, p_reply_to_wa_id, 'sent', p_sender_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into result;

  update public.conversations
  set last_message_at = result.created_at,
      last_message_preview = left(coalesce(p_body, '[' || p_type || ']'), 160),
      first_response_at = coalesce(first_response_at, result.created_at),
      unread_count = 0,
      assignee_id = coalesce(assignee_id, p_sender_id)
  where id = conv.id;

  return result;
end;
$$;

-- Deletes messages older than each organization's retention period (default 180 days).
-- Media files are removed by the retention job in deploy/scripts (storage API).
create or replace function public.purge_expired_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.messages m
  using public.organizations o
  where m.organization_id = o.id
    and m.created_at < now() - make_interval(days => o.retention_days);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- Only the service role may call ingestion / maintenance helpers.
revoke execute on function public.ingest_inbound_message(text, text, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.apply_message_status(text, public.message_status, jsonb) from public, anon, authenticated;
revoke execute on function public.record_outbound_message(uuid, uuid, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.purge_expired_messages() from public, anon, authenticated;
grant execute on function public.ingest_inbound_message(text, text, text, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.apply_message_status(text, public.message_status, jsonb) to service_role;
grant execute on function public.record_outbound_message(uuid, uuid, text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.purge_expired_messages() to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.channels enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.notes enable row level security;
alter table public.labels enable row level security;
alter table public.conversation_labels enable row level security;
alter table public.contact_labels enable row level security;
alter table public.quick_replies enable row level security;
alter table public.templates enable row level security;
alter table public.assignment_logs enable row level security;

-- organizations
create policy "members read their organization" on public.organizations
  for select to authenticated using (id = public.current_org_id());
create policy "admins update their organization" on public.organizations
  for update to authenticated
  using (id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (id = public.current_org_id());

-- profiles
create policy "read own profile and organization members" on public.profiles
  for select to authenticated
  using (id = auth.uid() or organization_id = public.current_org_id());
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "admins update organization members" on public.profiles
  for update to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (organization_id = public.current_org_id());

-- teams & members
create policy "members read teams" on public.teams
  for select to authenticated using (organization_id = public.current_org_id());
create policy "admins manage teams" on public.teams
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

create policy "members read team membership" on public.team_members
  for select to authenticated
  using (exists (select 1 from public.teams t where t.id = team_id and t.organization_id = public.current_org_id()));
create policy "admins manage team membership" on public.team_members
  for all to authenticated
  using (
    public.current_role_name() = 'admin'
    and exists (select 1 from public.teams t where t.id = team_id and t.organization_id = public.current_org_id())
  )
  with check (
    public.current_role_name() = 'admin'
    and exists (select 1 from public.teams t where t.id = team_id and t.organization_id = public.current_org_id())
    and exists (select 1 from public.profiles p where p.id = profile_id and p.organization_id = public.current_org_id())
  );

-- channels
create policy "members read channels" on public.channels
  for select to authenticated using (organization_id = public.current_org_id());
create policy "admins manage channels" on public.channels
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

-- contacts
create policy "members read contacts" on public.contacts
  for select to authenticated using (organization_id = public.current_org_id());
create policy "members create contacts" on public.contacts
  for insert to authenticated with check (organization_id = public.current_org_id());
create policy "members update contacts" on public.contacts
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
create policy "admins delete contacts" on public.contacts
  for delete to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

-- conversations: read by access rule; writes go through the RPCs above
create policy "read accessible conversations" on public.conversations
  for select to authenticated using (public.can_access_conversation(id));

-- messages: inserted by Edge Functions only
create policy "read messages of accessible conversations" on public.messages
  for select to authenticated using (public.can_access_conversation(conversation_id));

-- notes
create policy "read notes of accessible conversations" on public.notes
  for select to authenticated using (public.can_access_conversation(conversation_id));
create policy "write notes on accessible conversations" on public.notes
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and organization_id = public.current_org_id()
    and public.can_access_conversation(conversation_id)
  );
create policy "authors delete their notes" on public.notes
  for delete to authenticated using (author_id = auth.uid());

-- labels
create policy "members read labels" on public.labels
  for select to authenticated using (organization_id = public.current_org_id());
create policy "admins and supervisors manage labels" on public.labels
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'))
  with check (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

create policy "read labels of accessible conversations" on public.conversation_labels
  for select to authenticated using (public.can_access_conversation(conversation_id));
create policy "label accessible conversations" on public.conversation_labels
  for insert to authenticated
  with check (
    public.can_access_conversation(conversation_id)
    and exists (select 1 from public.labels l where l.id = label_id and l.organization_id = public.current_org_id())
  );
create policy "unlabel accessible conversations" on public.conversation_labels
  for delete to authenticated using (public.can_access_conversation(conversation_id));

create policy "members read contact labels" on public.contact_labels
  for select to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id and c.organization_id = public.current_org_id()));
create policy "members manage contact labels" on public.contact_labels
  for all to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id and c.organization_id = public.current_org_id()))
  with check (
    exists (select 1 from public.contacts c where c.id = contact_id and c.organization_id = public.current_org_id())
    and exists (select 1 from public.labels l where l.id = label_id and l.organization_id = public.current_org_id())
  );

-- quick replies: shared ones managed by admins/supervisors, personal ones by their owner
create policy "read shared and own quick replies" on public.quick_replies
  for select to authenticated
  using (organization_id = public.current_org_id() and (owner_id is null or owner_id = auth.uid()));
create policy "manage own or shared quick replies" on public.quick_replies
  for all to authenticated
  using (
    organization_id = public.current_org_id()
    and (owner_id = auth.uid() or (owner_id is null and public.current_role_name() in ('admin', 'supervisor')))
  )
  with check (
    organization_id = public.current_org_id()
    and (owner_id = auth.uid() or (owner_id is null and public.current_role_name() in ('admin', 'supervisor')))
  );

-- templates: synced from Meta by an Edge Function
create policy "members read templates" on public.templates
  for select to authenticated using (organization_id = public.current_org_id());

-- assignment logs
create policy "read assignment history of accessible conversations" on public.assignment_logs
  for select to authenticated using (public.can_access_conversation(conversation_id));

-- ---------------------------------------------------------------------------
-- Realtime: the inbox listens to these tables (RLS still applies)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.conversations, public.messages, public.notes;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for WhatsApp media, one folder per organization
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 104857600)
on conflict (id) do nothing;

create policy "members read their organization media" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = public.current_org_id()::text);

create policy "members upload outbound media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = 'outbound'
  );
