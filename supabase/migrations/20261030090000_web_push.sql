-- Push notifications to agents' phones and computers (Web Push; the app is
-- installable as a PWA). Database triggers queue a notification and wake the
-- push function, which encrypts and sends it to each of the person's devices.
--
-- Notified: a customer message in a chat assigned to you, a chat assigned to
-- you, a chat the AI hands to the team (agents and supervisors who are
-- online or away), and a mention in an internal note.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Only the browsers' push services are ever called (checked again by the push function).
  endpoint text not null unique check (char_length(endpoint) <= 1000 and endpoint ~ '^https?://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "people manage their own devices" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The platform's VAPID key pair, created by the push function on first use. No client access.
create table public.push_config (
  id integer primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_config enable row level security;

create table public.push_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  url text not null default '/inbox',
  -- Notifications with the same tag replace each other on the device.
  tag text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index push_queue_pending_idx on public.push_queue (created_at) where sent_at is null;
alter table public.push_queue enable row level security;

-- Hands queued notifications to one dispatcher (service role).
create or replace function public.push_claim(p_limit integer default 100)
returns setof public.push_queue
language sql
security definer
set search_path = ''
as $$
  update public.push_queue q set sent_at = now()
  where q.id in (
    select id from public.push_queue where sent_at is null order by created_at limit p_limit for update skip locked
  )
  returning q.*
$$;
revoke execute on function public.push_claim(integer) from public, anon, authenticated;

create or replace function public.wake_push()
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
    url := coalesce(v_url, 'http://api-gw:8000/functions/v1') || '/push',
    body := '{"action":"dispatch"}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'push wake-up failed: %', sqlerrm;
end;
$$;

-- Queues a notification for people who have a device registered.
create or replace function public.notify_users(p_users uuid[], p_title text, p_body text, p_url text, p_tag text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.push_queue (user_id, title, body, url, tag)
  select distinct u, left(p_title, 120), left(coalesce(nullif(p_body, ''), '…'), 240), p_url, p_tag
  from unnest(p_users) u
  where u is not null and exists (select 1 from public.push_subscriptions s where s.user_id = u);
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.wake_push();
  end if;
end;
$$;
revoke execute on function public.notify_users(uuid[], text, text, text, text) from public, anon, authenticated;

create or replace function public.contact_label(p_conversation uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(ct.name, ''), nullif(ct.profile_name, ''), ct.wa_id)
  from public.conversations c join public.contacts ct on ct.id = c.contact_id
  where c.id = p_conversation
$$;

-- Customer message in a chat that someone is handling.
create or replace function public.push_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignee uuid;
begin
  if new.direction <> 'inbound' or new.type = 'reaction' then
    return null;
  end if;
  select assignee_id into v_assignee from public.conversations where id = new.conversation_id;
  if v_assignee is not null then
    perform public.notify_users(
      array[v_assignee], public.contact_label(new.conversation_id),
      coalesce(nullif(new.body, ''), '[' || new.type || ']'),
      '/inbox/' || new.conversation_id, 'chat-' || new.conversation_id
    );
  end if;
  return null;
end;
$$;
create trigger messages_push after insert on public.messages
  for each row execute function public.push_on_message();

-- A chat assigned to you (rotation, transfer, takeover), and AI hand-overs.
create or replace function public.push_on_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid[];
begin
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id
     and new.assignee_id is distinct from auth.uid() then
    perform public.notify_users(
      array[new.assignee_id], 'Chat untuk Anda: ' || public.contact_label(new.id),
      coalesce(new.last_message_preview, 'Chat baru di Inbox'), '/inbox/' || new.id, 'chat-' || new.id
    );
  end if;
  if new.ai_handoff_at is not null and old.ai_handoff_at is null and new.assignee_id is null then
    select array_agg(p.id) into v_team
    from public.profiles p
    where p.organization_id = new.organization_id and p.is_active and p.status in ('online', 'away')
      and p.role in ('agent', 'supervisor')
      and (new.team_id is null or p.role = 'supervisor' or exists (
        select 1 from public.team_members tm where tm.team_id = new.team_id and tm.profile_id = p.id
      ));
    perform public.notify_users(
      coalesce(v_team, '{}'), 'AI butuh bantuan: ' || public.contact_label(new.id),
      coalesce(new.ai_handoff_reason, 'Chat diserahkan ke tim'), '/inbox/' || new.id, 'chat-' || new.id
    );
  end if;
  return null;
end;
$$;
create trigger conversations_push after update on public.conversations
  for each row execute function public.push_on_conversation();

-- Mentioned in an internal note.
create or replace function public.push_on_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if cardinality(new.mentions) > 0 then
    perform public.notify_users(
      array(select m from unnest(new.mentions) m where m is distinct from new.author_id),
      'Anda disebut di catatan: ' || public.contact_label(new.conversation_id),
      new.body, '/inbox/' || new.conversation_id, 'note-' || new.id
    );
  end if;
  return null;
end;
$$;
create trigger notes_push after insert on public.notes
  for each row execute function public.push_on_note();
