-- WhatsApp numbers linked by scanning a QR code (WhatsApp Web protocol through a
-- self-hosted Evolution API gateway), next to numbers on the official Cloud API.

create type public.channel_provider as enum ('cloud_api', 'qr');

alter table public.channels
  add column provider public.channel_provider not null default 'cloud_api',
  add column instance_name text unique,
  add column connection_status text not null default 'disconnected'
    check (connection_status in ('disconnected', 'connecting', 'connected')),
  add column connection_updated_at timestamptz;

alter table public.channels alter column phone_number_id drop not null;

-- Every QR channel gets a stable gateway instance name derived from its id.
create or replace function public.set_channel_instance_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.provider = 'qr' then
    new.instance_name := 'balas-' || replace(new.id::text, '-', '');
    new.phone_number_id := null;
  else
    new.instance_name := null;
  end if;
  return new;
end;
$$;

create trigger channels_instance_name before insert or update of provider, instance_name, phone_number_id
  on public.channels for each row execute function public.set_channel_instance_name();

alter table public.channels add constraint channels_provider_fields check (
  (provider = 'cloud_api' and phone_number_id is not null)
  or (provider = 'qr' and instance_name is not null)
);

-- Stores one message of a channel. Inbound messages come from customers;
-- outbound ones were sent from the linked phone itself (QR channels), so they
-- have no sender. Idempotent on wa_message_id: a retry or the echo of a message
-- sent from Balas.id returns the existing row with inserted = false.
create or replace function public.ingest_channel_message(
  p_channel_id uuid,
  p_direction public.message_direction,
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
  v_inbound boolean := p_direction = 'inbound';
  v_preview text := left(coalesce(p_body, '[' || coalesce(p_type, 'pesan') || ']'), 160);
begin
  select * into ch from public.channels where id = p_channel_id and is_active;
  if not found then
    raise exception 'unknown channel %', p_channel_id using errcode = 'P0002';
  end if;

  select m.id, m.conversation_id into v_message_id, v_existing_conv
  from public.messages m where m.wa_message_id = p_wa_message_id;
  if v_message_id is not null then
    return query select v_message_id, v_existing_conv, ch.organization_id, false;
    return;
  end if;

  insert into public.contacts (organization_id, wa_id, profile_name)
  values (ch.organization_id, p_wa_id, case when v_inbound then nullif(p_profile_name, '') end)
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
    ch.organization_id, v_conv.id, p_direction, coalesce(p_type, 'text'), p_body,
    p_wa_message_id, p_reply_to_wa_id,
    case when v_inbound then 'received' else 'sent' end::public.message_status,
    coalesce(p_metadata, '{}'::jsonb), v_at
  )
  on conflict (wa_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is null then
    -- lost a race with a concurrent retry of the same message
    select m.id into v_message_id from public.messages m where m.wa_message_id = p_wa_message_id;
    return query select v_message_id, v_conv.id, ch.organization_id, false;
    return;
  end if;

  if v_inbound then
    update public.conversations c
    set unread_count = c.unread_count + 1,
        last_message_at = greatest(coalesce(c.last_message_at, v_at), v_at),
        last_message_preview = v_preview,
        last_customer_message_at = greatest(coalesce(c.last_customer_message_at, v_at), v_at),
        status = case when c.status = 'resolved' then 'open'::public.conversation_status
                      when c.status = 'pending' then 'open'::public.conversation_status
                      else c.status end,
        opened_at = case when c.status = 'resolved' then now() else c.opened_at end,
        first_response_at = case when c.status = 'resolved' then null else c.first_response_at end,
        resolved_at = case when c.status = 'resolved' then null else c.resolved_at end
    where c.id = v_conv.id;
  else
    update public.conversations c
    set unread_count = 0,
        last_message_at = greatest(coalesce(c.last_message_at, v_at), v_at),
        last_message_preview = v_preview,
        first_response_at = coalesce(c.first_response_at, v_at)
    where c.id = v_conv.id;
  end if;

  return query select v_message_id, v_conv.id, ch.organization_id, true;
end;
$$;

-- Cloud API webhook entry point, now a thin wrapper keyed by phone_number_id.
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
declare
  v_channel_id uuid;
begin
  select id into v_channel_id from public.channels
  where phone_number_id = p_phone_number_id and is_active;
  if not found then
    raise exception 'unknown channel %', p_phone_number_id using errcode = 'P0002';
  end if;

  return query select * from public.ingest_channel_message(
    v_channel_id, 'inbound', p_wa_id, p_profile_name, p_wa_message_id, p_type, p_body,
    p_reply_to_wa_id, p_metadata, p_sent_at
  );
end;
$$;

-- Records a message an agent sent. On a QR channel the gateway may echo the
-- message back before this runs; the echoed row is then claimed instead.
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
  on conflict (wa_message_id) do update
    set sender_id = excluded.sender_id,
        type = excluded.type,
        body = excluded.body,
        media_path = excluded.media_path,
        media_mime = excluded.media_mime,
        media_filename = excluded.media_filename,
        reply_to_wa_id = excluded.reply_to_wa_id,
        metadata = excluded.metadata
    where public.messages.conversation_id = excluded.conversation_id
      and public.messages.direction = 'outbound'
  returning * into result;

  if result.id is null then
    raise exception 'message id % already used', p_wa_message_id using errcode = '23505';
  end if;

  update public.conversations
  set last_message_at = greatest(coalesce(last_message_at, result.created_at), result.created_at),
      last_message_preview = left(coalesce(p_body, '[' || p_type || ']'), 160),
      first_response_at = coalesce(first_response_at, result.created_at),
      unread_count = 0,
      assignee_id = coalesce(assignee_id, p_sender_id)
  where id = conv.id;

  return result;
end;
$$;

-- Gateway connection state, written by the wa-qr functions.
create or replace function public.set_channel_connection(
  p_instance_name text,
  p_status text,
  p_display_phone text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.channels
  set connection_status = p_status,
      connection_updated_at = now(),
      display_phone = coalesce(nullif(p_display_phone, ''), display_phone)
  where instance_name = p_instance_name
    and (connection_status is distinct from p_status
         or (nullif(p_display_phone, '') is not null and display_phone is distinct from p_display_phone));
$$;

revoke execute on function public.ingest_channel_message(uuid, public.message_direction, text, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.set_channel_connection(text, text, text) from public, anon, authenticated;
revoke execute on function public.ingest_inbound_message(text, text, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.record_outbound_message(uuid, uuid, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_channel_message(uuid, public.message_direction, text, text, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.set_channel_connection(text, text, text) to service_role;
grant execute on function public.ingest_inbound_message(text, text, text, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.record_outbound_message(uuid, uuid, text, text, text, text, text, text, text, jsonb) to service_role;

-- Settings shows the live connection state of QR numbers.
alter publication supabase_realtime add table public.channels;
