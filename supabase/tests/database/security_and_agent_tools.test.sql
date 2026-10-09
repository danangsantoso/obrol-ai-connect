-- Database tests (pgTAP), run by CI with `supabase test db`:
-- two-step verification gate, activity log, snoozed chats, scheduled
-- messages, merged contacts, broadcast opt-out and app error reports.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- Two tenants: admin + agent in A, admin in B.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local', '{"full_name":"Admin A"}'),
  ('00000000-0000-0000-0000-00000000000b', 'agent-a@test.local', '{"full_name":"Agen A"}'),
  ('00000000-0000-0000-0000-00000000000c', 'admin-b@test.local', '{"full_name":"Admin B"}');
insert into public.organizations (id, name) values
  ('10000000-0000-0000-0000-00000000000a', 'Toko A'),
  ('10000000-0000-0000-0000-00000000000b', 'Toko B');
update public.profiles set organization_id = '10000000-0000-0000-0000-00000000000a', role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set organization_id = '10000000-0000-0000-0000-00000000000a', role = 'agent' where id = '00000000-0000-0000-0000-00000000000b';
update public.profiles set organization_id = '10000000-0000-0000-0000-00000000000b', role = 'admin' where id = '00000000-0000-0000-0000-00000000000c';
insert into public.channels (id, organization_id, name, provider, instance_name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Nomor A', 'qr', 'test-a');

-- Two chats of one customer from two numbers.
select conversation_id as conv1 from public.ingest_channel_message('20000000-0000-0000-0000-00000000000a', 'inbound', '628111000001', 'Budi', 'wamid-1', 'text', 'halo', null, null, null) \gset
select conversation_id as conv2 from public.ingest_channel_message('20000000-0000-0000-0000-00000000000a', 'inbound', '628111000002', 'Budi 2', 'wamid-2', 'text', 'halo juga', null, null, null) \gset
select contact_id as c1 from public.conversations where id = :'conv1' \gset
select contact_id as c2 from public.conversations where id = :'conv2' \gset

create or replace function pg_temp.act_as(p_user uuid, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  select set_config('role', 'authenticated', true);
$$;

-- ---------------------------------------------------------------- 2FA
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select isnt(public.current_org_id(), null, 'admin without 2FA reaches the organization');
reset role;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'hp', 'totp', 'verified', now(), now(), 'secret');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', 'aal1');
select is(public.current_org_id(), null, 'with 2FA on, a password-only session has no organization');
select is((select count(*) from public.conversations), 0::bigint, 'password-only session sees no chats');
select is((select count(*) from public.contacts), 0::bigint, 'password-only session sees no contacts');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', 'aal2');
select is((select count(*) from public.conversations), 2::bigint, 'after the code, chats are visible');
reset role;

-- ---------------------------------------------------------------- activity log
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', 'aal2');
update public.channels set name = 'Nomor Utama' where id = '20000000-0000-0000-0000-00000000000a';
select is(
  (select changes -> 'name' ->> 'to' from public.audit_log where entity = 'channel' order by id desc limit 1),
  'Nomor Utama', 'renaming a number is logged with old and new value');
select is((select actor_name from public.audit_log order by id desc limit 1), 'Admin A', 'log names who did it');
select lives_ok($$ select public.log_activity('export', 'file', 'kontak.csv') $$, 'export can be logged');
select is((select count(*) from public.audit_log where action = 'export'), 1::bigint, 'export entry exists');
select throws_ok($$ insert into public.audit_log (organization_id, action, entity) values ('10000000-0000-0000-0000-00000000000a', 'create', 'x') $$,
  '42501', null, 'nobody writes the log directly');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*) from public.audit_log), 0::bigint, 'agents cannot read the activity log');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select is((select count(*) from public.audit_log), 0::bigint, 'other tenants cannot read it');
reset role;

-- ---------------------------------------------------------------- snooze
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', 'aal2');
select lives_ok(format($$ select public.snooze_conversation(%L, now() + interval '1 hour') $$, :'conv1'), 'snooze a chat');
select isnt((select snoozed_until from public.conversations where id = :'conv1'), null, 'chat is snoozed');
select throws_ok(format($$ select public.snooze_conversation(%L, now() + interval '200 days') $$, :'conv1'), '22023', null, 'too far ahead is refused');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select throws_ok(format($$ select public.snooze_conversation(%L, now() + interval '1 hour') $$, :'conv1'), 'P0002', null, 'other tenants cannot snooze it');
reset role;
select public.ingest_channel_message('20000000-0000-0000-0000-00000000000a', 'inbound', '628111000001', 'Budi', 'wamid-3', 'text', 'masih ada?', null, null, null);
select is((select snoozed_until from public.conversations where id = :'conv1'), null, 'a new customer message ends the snooze');
update public.conversations set snoozed_until = now() - interval '1 second', snoozed_by = '00000000-0000-0000-0000-00000000000a' where id = :'conv2';
select is(public.wake_due_snoozes(), 1, 'due snoozes are woken');

-- ---------------------------------------------------------------- scheduled messages
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(format($$ insert into public.scheduled_messages (organization_id, conversation_id, created_by, body, send_at)
  values ('10000000-0000-0000-0000-00000000000a', %L, '00000000-0000-0000-0000-00000000000a', 'x', now() + interval '1 hour') $$, :'conv1'),
  '42501', null, 'cannot schedule in someone else''s name');
select lives_ok(format($$ insert into public.scheduled_messages (organization_id, conversation_id, created_by, body, send_at)
  values ('10000000-0000-0000-0000-00000000000a', %L, '00000000-0000-0000-0000-00000000000b', 'Halo, jadi pesan?', now() + interval '1 hour') $$, :'conv1'),
  'agent schedules a message');
reset role;
update public.scheduled_messages set send_at = now() - interval '1 minute';
select is((select count(*) from public.claim_scheduled_messages(10)), 1::bigint, 'due message is claimed once');
select is((select count(*) from public.claim_scheduled_messages(10)), 0::bigint, 'and not claimed twice');

-- ---------------------------------------------------------------- merged contacts & opt-out
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(format($$ select public.merge_contacts(%L, %L) $$, :'c1', :'c2'), '42501', null, 'agents cannot merge contacts');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', 'aal2');
select lives_ok(format($$ select public.merge_contacts(%L, %L) $$, :'c1', :'c2'), 'admin merges two numbers of one customer');
reset role;
select is((select merged_into from public.contacts where id = :'c2'), :'c1'::uuid, 'second number points to the main contact');
select is((select contact_id from public.conversations where id = :'conv2'), :'c2'::uuid, 'its chat stays with its own number');
select is((select count(*) from public.broadcast_audience('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '{}', null, false)),
  1::bigint, 'broadcast reaches the person once');
select public.ingest_channel_message('20000000-0000-0000-0000-00000000000a', 'inbound', '628111000002', 'Budi 2', 'wamid-4', 'text', 'STOP', null, null, null);
select is((select count(*) from public.contacts where id in (:'c1', :'c2') and broadcast_opt_out), 2::bigint, 'STOP from either number stops promos for the person');
select public.ingest_channel_message('20000000-0000-0000-0000-00000000000a', 'inbound', '628111000001', 'Budi', 'wamid-5', 'text', 'mulai', null, null, null);
select is((select count(*) from public.contacts where id in (:'c1', :'c2') and broadcast_opt_out), 0::bigint, 'MULAI subscribes again');

-- ---------------------------------------------------------------- app errors
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.report_app_error('function', 'x') $$, '42501', null, 'browsers cannot report as the server');
select public.report_app_error('web', 'Cannot read properties of undefined (reading ''id'') at 123', 'Error\n at Inbox (app.js:10:5)', '/inbox', 'test');
select public.report_app_error('web', 'Cannot read properties of undefined (reading ''id'') at 456', 'Error\n at Inbox (app.js:10:5)', '/inbox', 'test');
reset role;
select is((select occurrences from public.app_errors where source = 'web'), 2, 'the same error is counted, not duplicated');

select * from finish();
rollback;
