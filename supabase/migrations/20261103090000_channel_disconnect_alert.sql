-- A QR-linked WhatsApp number that drops (logged out from the phone, phone
-- offline for weeks, banned) stops receiving chats without anyone noticing.
-- Admins and supervisors now get a push notification when that happens; the
-- Inbox shows a banner from channels.connection_status as well.
create or replace function public.push_on_channel_disconnect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid[];
begin
  if new.provider = 'qr' and new.is_active
     and old.connection_status = 'connected' and new.connection_status = 'disconnected' then
    select array_agg(p.id) into v_team
    from public.profiles p
    where p.organization_id = new.organization_id and p.is_active and p.role in ('admin', 'supervisor');
    perform public.notify_users(
      coalesce(v_team, '{}'),
      'Nomor WhatsApp terputus: ' || new.name,
      'Chat dari nomor ini tidak masuk sampai di-scan ulang di Pengaturan → Kanal.',
      '/settings',
      'channel-' || new.id
    );
  end if;
  return null;
end;
$$;
create trigger channels_disconnect_push after update of connection_status on public.channels
  for each row execute function public.push_on_channel_disconnect();
