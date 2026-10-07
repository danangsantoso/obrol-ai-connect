-- Connecting other systems (websites, CRMs, automation tools, AI assistants):
--  * API keys for the REST API (`api` function) and the MCP server (`mcp`)
--  * outgoing webhooks: events are queued in webhook_deliveries by triggers and
--    sent by the `webhook-dispatch` function, which pg_net wakes right away
--    (and the minute cron retries failures).

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- API keys. Only a SHA-256 hash is stored; the key is shown once on creation.
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  key_prefix text not null,
  key_hash text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_org_idx on public.api_keys (organization_id);
alter table public.api_keys enable row level security;
create policy "admins read api keys" on public.api_keys
  for select to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

-- Creates a key for the caller's organization (admins) and returns it once.
create or replace function public.create_api_key(key_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if public.current_role_name() is distinct from 'admin' then
    raise exception 'only an admin can create API keys' using errcode = '42501';
  end if;
  v_key := 'blsk_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_keys (organization_id, name, key_prefix, key_hash, created_by)
  values (public.current_org_id(), trim(key_name), left(v_key, 12),
          encode(extensions.digest(v_key, 'sha256'), 'hex'), auth.uid());
  return v_key;
end;
$$;

create or replace function public.revoke_api_key(key_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_role_name() is distinct from 'admin' then
    raise exception 'only an admin can revoke API keys' using errcode = '42501';
  end if;
  update public.api_keys set revoked_at = coalesce(revoked_at, now())
  where id = key_id and organization_id = public.current_org_id();
end;
$$;

-- ---------------------------------------------------------------------------
-- Outgoing webhooks
-- ---------------------------------------------------------------------------
create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  url text not null check (url ~ '^https?://' and char_length(url) <= 500),
  -- Signs every delivery (HMAC-SHA256); shown to admins so receivers can verify.
  secret text not null default 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex'),
  -- Empty = every event.
  events text[] not null default '{}',
  is_active boolean not null default true,
  description text check (char_length(description) <= 200),
  last_delivery_at timestamptz,
  last_status integer,
  last_error text,
  created_at timestamptz not null default now()
);
create index webhooks_org_idx on public.webhooks (organization_id) where is_active;
alter table public.webhooks enable row level security;
create policy "admins manage webhooks" on public.webhooks
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  webhook_id uuid not null references public.webhooks (id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  response_status integer,
  error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at) where status = 'pending';
create index webhook_deliveries_webhook_idx on public.webhook_deliveries (webhook_id, created_at desc);
alter table public.webhook_deliveries enable row level security;
create policy "admins read webhook deliveries" on public.webhook_deliveries
  for select to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

-- Where the database reaches the Edge Functions (the compose service name of
-- the API gateway). Service role only.
create table public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;
insert into public.app_config (key, value) values ('functions_url', 'http://api-gw:8000/functions/v1')
  on conflict (key) do nothing;

-- Wakes the dispatcher. It only drains the queue, so it needs no credentials.
create or replace function public.wake_webhook_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select value into v_url from public.app_config where key = 'functions_url';
  perform net.http_post(
    url := coalesce(v_url, 'http://api-gw:8000/functions/v1') || '/webhook-dispatch',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 5000
  );
exception when others then
  -- Never block the chat because of a webhook; the minute cron picks it up.
  raise warning 'webhook dispatch wake-up failed: %', sqlerrm;
end;
$$;

-- Queues one event for every active webhook of the organization that wants it.
create or replace function public.enqueue_webhook_event(p_org uuid, p_event text, p_data jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
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

-- Payload pieces shared by the events.
create or replace function public.webhook_conversation_json(p_conv uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'assignee', case when p.id is null then null else jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email) end,
    'team_id', c.team_id,
    'last_message_at', c.last_message_at,
    'contact', jsonb_build_object('id', ct.id, 'wa_id', ct.wa_id, 'name', coalesce(ct.name, ct.profile_name), 'email', ct.email, 'username', ct.username),
    'channel', jsonb_build_object('id', ch.id, 'provider', ch.provider, 'name', ch.name)
  )
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  join public.channels ch on ch.id = c.channel_id
  left join public.profiles p on p.id = c.assignee_id
  where c.id = p_conv
$$;

create or replace function public.webhook_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.webhooks w where w.organization_id = new.organization_id and w.is_active) then
    return null;
  end if;
  perform public.enqueue_webhook_event(
    new.organization_id,
    case when new.direction = 'inbound' then 'message.received' else 'message.sent' end,
    jsonb_build_object(
      'message', jsonb_build_object(
        'id', new.id, 'direction', new.direction, 'type', new.type, 'text', new.body,
        'has_media', new.media_path is not null, 'media_filename', new.media_filename,
        'status', new.status, 'sender_id', new.sender_id,
        'source', coalesce(new.metadata ->> 'source', case when new.direction = 'inbound' then 'customer' else 'agent' end),
        'created_at', new.created_at
      ),
      'conversation', public.webhook_conversation_json(new.conversation_id)
    )
  );
  return null;
end;
$$;

create trigger messages_webhook after insert on public.messages
  for each row execute function public.webhook_on_message();

create or replace function public.webhook_on_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.webhooks w where w.organization_id = new.organization_id and w.is_active) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.enqueue_webhook_event(new.organization_id, 'conversation.created', public.webhook_conversation_json(new.id));
    return null;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    perform public.enqueue_webhook_event(new.organization_id, 'conversation.assigned',
      public.webhook_conversation_json(new.id) || jsonb_build_object('previous_assignee_id', old.assignee_id));
  end if;
  if new.status is distinct from old.status then
    perform public.enqueue_webhook_event(new.organization_id,
      case when new.status = 'resolved' then 'conversation.resolved' else 'conversation.status_changed' end,
      public.webhook_conversation_json(new.id) || jsonb_build_object('previous_status', old.status));
  end if;
  return null;
end;
$$;

-- No column list: rotation sets assignee_id in a BEFORE trigger, which an
-- "update of" filter would not see.
create trigger conversations_webhook after insert or update on public.conversations
  for each row execute function public.webhook_on_conversation();

create or replace function public.webhook_on_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.webhooks w where w.organization_id = new.organization_id and w.is_active) then
    perform public.enqueue_webhook_event(new.organization_id, 'contact.created', jsonb_build_object(
      'contact', jsonb_build_object('id', new.id, 'wa_id', new.wa_id, 'name', coalesce(new.name, new.profile_name),
                                    'email', new.email, 'company', new.company, 'username', new.username)));
  end if;
  return null;
end;
$$;

create trigger contacts_webhook after insert on public.contacts
  for each row execute function public.webhook_on_contact();

-- Admin "send a test" button.
create or replace function public.test_webhook(webhook uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_role_name() is distinct from 'admin' then
    raise exception 'only an admin can test webhooks' using errcode = '42501';
  end if;
  insert into public.webhook_deliveries (organization_id, webhook_id, event, payload)
  select w.organization_id, w.id, 'ping',
         jsonb_build_object('event', 'ping', 'organization_id', w.organization_id, 'created_at', now(),
                            'data', jsonb_build_object('message', 'Tes webhook dari Balas.id'))
  from public.webhooks w
  where w.id = webhook and w.organization_id = public.current_org_id();
  if not found then
    raise exception 'webhook not found' using errcode = 'P0002';
  end if;
  perform public.wake_webhook_dispatch();
end;
$$;

-- Dispatcher: takes due deliveries with a 2-minute lease so parallel runs
-- never send the same delivery twice.
create or replace function public.claim_webhook_deliveries(p_limit integer default 50)
returns table (id uuid, webhook_id uuid, event text, payload jsonb, attempts integer, url text, secret text)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select d.id from public.webhook_deliveries d
    where d.status = 'pending' and d.next_attempt_at <= now()
    order by d.next_attempt_at
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.webhook_deliveries d
    set next_attempt_at = now() + interval '2 minutes', attempts = d.attempts + 1
    from due where d.id = due.id
    returning d.id, d.webhook_id, d.event, d.payload, d.attempts
  )
  select c.id, c.webhook_id, c.event, c.payload, c.attempts, w.url, w.secret
  from claimed c join public.webhooks w on w.id = c.webhook_id
$$;
revoke execute on function public.claim_webhook_deliveries(integer) from public, anon, authenticated;

-- Keeps the delivery log short: 14 days.
create or replace function public.purge_webhook_deliveries()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.webhook_deliveries where created_at < now() - interval '14 days';
$$;
revoke execute on function public.purge_webhook_deliveries() from public, anon, authenticated;

-- Internal helpers: triggers and the service role only.
revoke execute on function public.enqueue_webhook_event(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.wake_webhook_dispatch() from public, anon, authenticated;
revoke execute on function public.webhook_conversation_json(uuid) from public, anon, authenticated;
