-- Broadcasts: one message (text or an approved WhatsApp template) sent to a
-- chosen group of contacts on one channel, at a controlled pace, with
-- sent / delivered / read / replied tracking per recipient.
--
-- Channels: WhatsApp API numbers (templates only, as Meta requires), QR-linked
-- WhatsApp numbers and Telegram bots (text). Messenger and Instagram are left
-- out: Meta does not allow promotional messages there outside the 24-hour window.
-- A customer who replies STOP (or BERHENTI) receives no more broadcasts.

alter table public.contacts add column broadcast_opt_out boolean not null default false;

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  channel_id uuid not null references public.channels (id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'template')),
  -- Text with {sapaan} {nama} {toko}; for templates, the values of {{1}}, {{2}}, ...
  body text not null default '' check (char_length(body) <= 4000),
  template_name text,
  template_language text,
  template_params text[] not null default '{}',
  add_opt_out boolean not null default true,
  -- Audience
  label_ids uuid[] not null default '{}',
  active_within_days integer check (active_within_days between 1 and 3650),
  only_opt_in boolean not null default false,
  -- Sending
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'completed', 'cancelled')),
  scheduled_at timestamptz,
  per_minute integer not null default 20 check (per_minute between 1 and 120),
  started_at timestamptz,
  finished_at timestamptz,
  total integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index broadcasts_org_idx on public.broadcasts (organization_id, created_at desc);
create index broadcasts_due_idx on public.broadcasts (scheduled_at) where status in ('scheduled', 'sending');
create trigger broadcasts_updated_at before update on public.broadcasts
  for each row execute function public.set_updated_at();

create table public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  replied_at timestamptz,
  unique (broadcast_id, contact_id)
);
create index broadcast_recipients_pending_idx on public.broadcast_recipients (broadcast_id) where status in ('pending', 'sending');
create index broadcast_recipients_conv_idx on public.broadcast_recipients (conversation_id) where status = 'sent' and replied_at is null;

-- Admins and supervisors run broadcasts.
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;
create policy "managers manage broadcasts" on public.broadcasts
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'))
  with check (
    organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor')
    and exists (select 1 from public.channels c where c.id = channel_id and c.organization_id = organization_id)
  );
create policy "managers read recipients" on public.broadcast_recipients
  for select to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

-- Who a broadcast reaches.
create or replace function public.broadcast_audience(
  p_org uuid, p_channel uuid, p_label_ids uuid[], p_active_days integer, p_only_opt_in boolean
)
returns table (contact_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select ct.id
  from public.contacts ct
  join public.channels ch on ch.id = p_channel and ch.organization_id = p_org
  where ct.organization_id = p_org
    and not ct.broadcast_opt_out
    and (not p_only_opt_in or ct.opt_in)
    and (
      -- WhatsApp numbers reach any contact with a phone number; Telegram only its own chats.
      (ch.provider in ('cloud_api', 'qr') and ct.wa_id ~ '^[0-9]{8,15}$')
      or (ch.provider = 'telegram' and exists (
        select 1 from public.conversations c where c.contact_id = ct.id and c.channel_id = ch.id
      ))
    )
    and (cardinality(p_label_ids) = 0
      or exists (select 1 from public.contact_labels cl where cl.contact_id = ct.id and cl.label_id = any (p_label_ids))
      or exists (
        select 1 from public.conversation_labels vl join public.conversations c on c.id = vl.conversation_id
        where c.contact_id = ct.id and vl.label_id = any (p_label_ids)
      ))
    and (p_active_days is null or exists (
      select 1 from public.conversations c
      where c.contact_id = ct.id and c.last_customer_message_at > now() - make_interval(days => p_active_days)
    ))
$$;
revoke execute on function public.broadcast_audience(uuid, uuid, uuid[], integer, boolean) from public, anon, authenticated;

-- Audience size for the form (admins and supervisors of the organization).
create or replace function public.broadcast_audience_count(
  p_channel uuid, p_label_ids uuid[], p_active_days integer, p_only_opt_in boolean
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_role_name() not in ('admin', 'supervisor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (select count(*) from public.broadcast_audience(public.current_org_id(), p_channel, coalesce(p_label_ids, '{}'), p_active_days, coalesce(p_only_opt_in, false)));
end;
$$;
grant execute on function public.broadcast_audience_count(uuid, uuid[], integer, boolean) to authenticated;

-- Freezes the audience of a due broadcast and starts sending (service role).
create or replace function public.broadcast_prepare(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.broadcasts;
  v_count integer;
begin
  select * into v_b from public.broadcasts where id = p_id and status = 'scheduled' for update;
  if not found then
    return 0;
  end if;
  insert into public.broadcast_recipients (organization_id, broadcast_id, contact_id)
  select v_b.organization_id, v_b.id, a.contact_id
  from public.broadcast_audience(v_b.organization_id, v_b.channel_id, v_b.label_ids, v_b.active_within_days, v_b.only_opt_in) a
  on conflict do nothing;
  get diagnostics v_count = row_count;
  update public.broadcasts set status = 'sending', started_at = now(), total = v_count where id = p_id;
  return v_count;
end;
$$;
revoke execute on function public.broadcast_prepare(uuid) from public, anon, authenticated;

-- The next recipients of a sending broadcast. Claimed rows are "sending" so a
-- parallel sweep skips them; rows left "sending" by a crashed sweep are
-- retried after 10 minutes.
create or replace function public.broadcast_claim(p_id uuid, p_limit integer)
returns setof public.broadcast_recipients
language sql
security definer
set search_path = ''
as $$
  update public.broadcast_recipients r
  set status = 'sending', claimed_at = now()
  where r.id in (
    select id from public.broadcast_recipients
    where broadcast_id = p_id
      and (status = 'pending' or (status = 'sending' and claimed_at < now() - interval '10 minutes'))
    order by id
    limit p_limit
    for update skip locked
  )
  returning r.*
$$;
revoke execute on function public.broadcast_claim(uuid, integer) from public, anon, authenticated;

-- The chat a broadcast message goes into: the contact's existing chat on the
-- channel, or a new one kept out of the queues (resolved) until they reply.
create or replace function public.broadcast_conversation(p_channel uuid, p_contact uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid;
begin
  select id into v_id from public.conversations where channel_id = p_channel and contact_id = p_contact;
  if v_id is not null then
    return v_id;
  end if;
  select organization_id into v_org from public.channels where id = p_channel;
  insert into public.conversations (organization_id, channel_id, contact_id, status, resolved_at)
  values (v_org, p_channel, p_contact, 'resolved', now())
  on conflict (channel_id, contact_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.conversations where channel_id = p_channel and contact_id = p_contact;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.broadcast_conversation(uuid, uuid) from public, anon, authenticated;

-- Results per broadcast: sent, failed, delivered, read and replied.
create or replace function public.broadcast_stats(p_ids uuid[])
returns table (broadcast_id uuid, pending bigint, sent bigint, failed bigint, delivered bigint, read bigint, replied bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.broadcast_id,
    count(*) filter (where r.status in ('pending', 'sending')),
    count(*) filter (where r.status = 'sent'),
    count(*) filter (where r.status = 'failed'),
    count(*) filter (where m.status in ('delivered', 'read')),
    count(*) filter (where m.status = 'read'),
    count(*) filter (where r.replied_at is not null)
  from public.broadcast_recipients r
  left join public.messages m on m.id = r.message_id
  where r.broadcast_id = any (p_ids)
  group by r.broadcast_id
$$;
grant execute on function public.broadcast_stats(uuid[]) to authenticated;

-- A reply counts for the broadcasts sent to that chat in the last 7 days;
-- STOP / BERHENTI ends broadcasts for the contact.
create or replace function public.broadcast_on_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction <> 'inbound' then
    return null;
  end if;
  update public.broadcast_recipients
  set replied_at = new.created_at
  where conversation_id = new.conversation_id and status = 'sent' and replied_at is null
    and sent_at > new.created_at - interval '7 days';
  if upper(trim(coalesce(new.body, ''))) in ('STOP', 'BERHENTI', 'UNSUBSCRIBE', 'STOP PROMO') then
    update public.contacts set broadcast_opt_out = true
    where id = (select contact_id from public.conversations where id = new.conversation_id);
  end if;
  return null;
end;
$$;
create trigger messages_broadcast_reply after insert on public.messages
  for each row execute function public.broadcast_on_reply();
