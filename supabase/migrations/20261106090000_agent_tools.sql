-- Tools for the daily work of agents:
--  * snooze a chat ("remind me tomorrow at 10"): it leaves the lists until
--    then, comes back with a push notification, or earlier when the customer
--    writes again
--  * scheduled messages: written now, sent later by the minute sweep
--  * merged contacts: one person who chats from several numbers or accounts.
--    Every number keeps its own chats (replies must reach the same number), the
--    extra ones point to the main contact with merged_into and are hidden from
--    the contact list and from broadcasts
--  * broadcast opt-out: MULAI / START subscribes again; STOP covers merged contacts

-- ---------------------------------------------------------------------------
-- Snooze
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column snoozed_until timestamptz,
  add column snoozed_by uuid references public.profiles (id) on delete set null;
create index conversations_snoozed_idx on public.conversations (snoozed_until) where snoozed_until is not null;

create or replace function public.snooze_conversation(p_conversation uuid, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_access_conversation(p_conversation) then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if p_until is not null and (p_until < now() + interval '1 minute' or p_until > now() + interval '90 days') then
    raise exception 'Pilih waktu antara 1 menit dan 90 hari dari sekarang' using errcode = '22023';
  end if;
  update public.conversations
  set snoozed_until = p_until, snoozed_by = case when p_until is null then null else auth.uid() end
  where id = p_conversation;
end;
$$;
revoke execute on function public.snooze_conversation(uuid, timestamptz) from public, anon;
grant execute on function public.snooze_conversation(uuid, timestamptz) to authenticated;

-- The customer wrote again: the chat is back now.
create or replace function public.unsnooze_on_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'inbound' then
    update public.conversations set snoozed_until = null, snoozed_by = null
    where id = new.conversation_id and snoozed_until is not null;
  end if;
  return null;
end;
$$;
create trigger messages_unsnooze after insert on public.messages
  for each row execute function public.unsnooze_on_reply();

-- Called by the minute sweep: snoozed chats whose time has come.
create or replace function public.wake_due_snoozes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    update public.conversations c
    set snoozed_until = null, snoozed_by = null
    from (select id, snoozed_by from public.conversations where snoozed_until <= now() for update skip locked) due
    where c.id = due.id
    returning c.id, c.assignee_id, due.snoozed_by
  loop
    perform public.notify_users(
      array[coalesce(r.snoozed_by, r.assignee_id)],
      'Pengingat: ' || coalesce(public.contact_label(r.id), 'chat'),
      'Chat yang Anda tunda sudah waktunya ditindaklanjuti.',
      '/inbox/' || r.id,
      'snooze-' || r.id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.wake_due_snoozes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Scheduled messages
-- ---------------------------------------------------------------------------
create table public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  type text not null default 'text' check (type in ('text', 'image', 'video', 'audio', 'document')),
  body text,
  media_path text,
  media_filename text,
  send_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  error text,
  message_id uuid references public.messages (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  check (type = 'text' and char_length(btrim(coalesce(body, ''))) between 1 and 4096 or type <> 'text' and media_path is not null),
  check (media_path is null or (media_path like organization_id::text || '/outbound/%' and media_path not like '%..%'))
);
create index scheduled_messages_due_idx on public.scheduled_messages (send_at) where status = 'pending';
create index scheduled_messages_conversation_idx on public.scheduled_messages (conversation_id, send_at);
alter table public.scheduled_messages enable row level security;
create policy "members read scheduled messages of their chats" on public.scheduled_messages
  for select to authenticated using (organization_id = public.current_org_id() and public.can_access_conversation(conversation_id));
create policy "members schedule messages in their chats" on public.scheduled_messages
  for insert to authenticated with check (
    organization_id = public.current_org_id()
    and created_by = auth.uid()
    and status = 'pending'
    and send_at > now() and send_at < now() + interval '90 days'
    and public.can_access_conversation(conversation_id)
  );

create or replace function public.cancel_scheduled_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.scheduled_messages s
  set status = 'cancelled'
  where s.id = p_id and s.status = 'pending' and s.organization_id = public.current_org_id()
    and (s.created_by = auth.uid() or public.current_role_name() in ('admin', 'supervisor'));
  if not found then
    raise exception 'Pesan terjadwal tidak ditemukan atau sudah terkirim' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.cancel_scheduled_message(uuid) from public, anon;
grant execute on function public.cancel_scheduled_message(uuid) to authenticated;

-- Due messages for the sweep. One that has been "sending" for 10 minutes
-- (the function restarted mid-send) is not sent twice but reported as failed.
create or replace function public.claim_scheduled_messages(p_limit integer)
returns setof public.scheduled_messages
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.scheduled_messages
  set status = 'failed', error = 'Pengiriman terputus; cek apakah pesan sudah sampai lalu kirim ulang bila perlu'
  where status = 'sending' and claimed_at < now() - interval '10 minutes';
  return query
  update public.scheduled_messages s
  set status = 'sending', claimed_at = now()
  from (
    select id from public.scheduled_messages
    where status = 'pending' and send_at <= now()
    order by send_at
    limit p_limit
    for update skip locked
  ) due
  where s.id = due.id
  returning s.*;
end;
$$;
revoke execute on function public.claim_scheduled_messages(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Merged contacts
-- ---------------------------------------------------------------------------
alter table public.contacts add column merged_into uuid references public.contacts (id) on delete cascade;
create index contacts_merged_into_idx on public.contacts (merged_into) where merged_into is not null;

create or replace function public.merge_contacts(p_keep uuid, p_merge uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep public.contacts;
  other public.contacts;
begin
  if public.current_role_name() not in ('admin', 'supervisor') then
    raise exception 'Hanya Admin dan Supervisor yang bisa menggabungkan kontak' using errcode = '42501';
  end if;
  select * into keep from public.contacts where id = p_keep and organization_id = public.current_org_id() for update;
  select * into other from public.contacts where id = p_merge and organization_id = public.current_org_id() for update;
  if keep.id is null or other.id is null then
    raise exception 'Kontak tidak ditemukan' using errcode = 'P0002';
  end if;
  if keep.id = other.id or keep.merged_into is not null or other.merged_into is not null then
    raise exception 'Kontak ini tidak bisa digabungkan' using errcode = '22023';
  end if;

  -- Fill what the main contact is missing.
  update public.contacts set
    name = coalesce(nullif(keep.name, ''), other.name),
    email = coalesce(nullif(keep.email, ''), other.email),
    company = coalesce(nullif(keep.company, ''), other.company),
    notes = nullif(concat_ws(E'\n', nullif(keep.notes, ''), nullif(other.notes, '')), ''),
    custom_fields = coalesce(other.custom_fields, '{}') || coalesce(keep.custom_fields, '{}'),
    opt_in = keep.opt_in or other.opt_in,
    broadcast_opt_out = keep.broadcast_opt_out or other.broadcast_opt_out,
    avatar_url = coalesce(keep.avatar_url, other.avatar_url)
  where id = keep.id;

  insert into public.contact_labels (contact_id, label_id)
  select keep.id, label_id from public.contact_labels where contact_id = other.id
  on conflict do nothing;
  delete from public.contact_labels where contact_id = other.id;
  update public.orders set contact_id = keep.id where contact_id = other.id;

  -- The merged contact keeps its number and chats, under the main name.
  update public.contacts
  set merged_into = keep.id, name = coalesce(nullif(keep.name, ''), other.name)
  where id = other.id or merged_into = other.id;

  perform public.audit_write(keep.organization_id, auth.uid(), 'merge', 'contact', keep.id::text,
    coalesce(nullif(keep.name, ''), keep.profile_name, keep.wa_id) || ' + ' || coalesce(nullif(other.name, ''), other.profile_name, other.wa_id), null);
end;
$$;
revoke execute on function public.merge_contacts(uuid, uuid) from public, anon;
grant execute on function public.merge_contacts(uuid, uuid) to authenticated;

-- Separates a merged number again.
create or replace function public.unmerge_contact(p_contact uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_role_name() not in ('admin', 'supervisor') then
    raise exception 'Hanya Admin dan Supervisor yang bisa memisahkan kontak' using errcode = '42501';
  end if;
  update public.contacts set merged_into = null
  where id = p_contact and organization_id = public.current_org_id() and merged_into is not null;
end;
$$;
revoke execute on function public.unmerge_contact(uuid) from public, anon;
grant execute on function public.unmerge_contact(uuid) to authenticated;

-- A renamed main contact renames its merged numbers too, so every chat of the
-- person shows the same name.
create or replace function public.contacts_sync_merged_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contacts set name = new.name where merged_into = new.id and name is distinct from new.name;
  return null;
end;
$$;
create trigger contacts_sync_merged_name after update of name on public.contacts
  for each row when (new.merged_into is null) execute function public.contacts_sync_merged_name();

create or replace function public.broadcast_audience(p_org uuid, p_channel uuid, p_label_ids uuid[], p_active_days integer, p_only_opt_in boolean)
returns table(contact_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select ct.id
  from public.contacts ct
  join public.channels ch on ch.id = p_channel and ch.organization_id = p_org
  where ct.organization_id = p_org
    and ct.merged_into is null
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

-- ---------------------------------------------------------------------------
-- Broadcast opt-out keywords
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_on_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_word text := upper(trim(coalesce(new.body, '')));
  v_contact uuid;
begin
  if new.direction <> 'inbound' then
    return null;
  end if;
  update public.broadcast_recipients
  set replied_at = new.created_at
  where conversation_id = new.conversation_id and status = 'sent' and replied_at is null
    and sent_at > new.created_at - interval '7 days';
  if v_word in ('STOP', 'BERHENTI', 'UNSUBSCRIBE', 'STOP PROMO', 'MULAI', 'START', 'MULAI PROMO') then
    select coalesce(ct.merged_into, ct.id) into v_contact
    from public.conversations c join public.contacts ct on ct.id = c.contact_id
    where c.id = new.conversation_id;
    update public.contacts set broadcast_opt_out = v_word not in ('MULAI', 'START', 'MULAI PROMO')
    where id = v_contact or merged_into = v_contact;
  end if;
  return null;
end;
$$;

-- Push to the agent whose scheduled message could not be sent.
create or replace function public.notify_scheduled_failed(p_user uuid, p_conversation uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.notify_users(
    array[p_user],
    'Pesan terjadwal gagal: ' || coalesce(public.contact_label(p_conversation), 'chat'),
    p_reason,
    '/inbox/' || p_conversation,
    'scheduled-' || p_conversation
  )
$$;
revoke execute on function public.notify_scheduled_failed(uuid, uuid, text) from public, anon, authenticated;
