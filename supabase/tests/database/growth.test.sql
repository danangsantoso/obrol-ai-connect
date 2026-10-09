-- Database tests (pgTAP) for the revenue features: CS rotator, platforms
-- (Google / TikTok), closings credited to agents and the leaderboard, repeat
-- order reminders and customer segments.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'gr-admin@test.local', '{"full_name":"Admin Tumbuh"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'gr-agent1@test.local', '{"full_name":"Agen Satu"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'gr-agent2@test.local', '{"full_name":"Agen Dua"}'),
  ('00000000-0000-0000-0000-0000000000c4', 'gr-other@test.local', '{"full_name":"Admin Lain"}');
insert into public.organizations (id, name) values
  ('10000000-0000-0000-0000-0000000000c1', 'Toko Tumbuh'),
  ('10000000-0000-0000-0000-0000000000c2', 'Toko Lain');
update public.profiles set organization_id = '10000000-0000-0000-0000-0000000000c1', role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set organization_id = '10000000-0000-0000-0000-0000000000c1', role = 'agent', status = 'online'
  where id in ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3');
update public.profiles set organization_id = '10000000-0000-0000-0000-0000000000c2', role = 'admin' where id = '00000000-0000-0000-0000-0000000000c4';
insert into public.channels (id, organization_id, name, provider, instance_name, display_phone, connection_status) values
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'Nomor 1', 'qr', 'gr-1', '+62 811 0000 0001', 'connected'),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c1', 'Nomor 2', 'qr', 'gr-2', '+62 811 0000 0002', 'connected');

create or replace function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select set_config('role', 'authenticated', true);
$$;

-- ---------------------------------------------------------------- rotator
insert into public.wa_links (id, organization_id, slug, name, channel_ids, agent_ids) values
  ('30000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'rotator-test', 'Rotator',
   array['20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c2']::uuid[],
   array['00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3']::uuid[]);
select is((select string_agg(phone, ',') from (select (public.wa_link_pick('30000000-0000-0000-0000-0000000000c1')).phone from generate_series(1, 4)) x),
  '6281100000002,6281100000001,6281100000002,6281100000001', 'numbers take turns');
update public.channels set connection_status = 'disconnected' where id = '20000000-0000-0000-0000-0000000000c2';
select is((select string_agg(phone, ',') from (select (public.wa_link_pick('30000000-0000-0000-0000-0000000000c1')).phone from generate_series(1, 2)) x),
  '6281100000001,6281100000001', 'a disconnected number is skipped');
update public.profiles set status = 'offline' where id = '00000000-0000-0000-0000-0000000000c3';
select is((select count(distinct agent_id) from (select (public.wa_link_pick('30000000-0000-0000-0000-0000000000c1')).agent_id from generate_series(1, 3)) x),
  1::bigint, 'an offline agent is skipped while another is online');
update public.profiles set status = 'online' where id = '00000000-0000-0000-0000-0000000000c3';

insert into public.ad_clicks (organization_id, link_id, code, platform, gclid, agent_id, channel_id) values
  ('10000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c1', 'G7K2', 'google', 'gclid-1',
   '00000000-0000-0000-0000-0000000000c3', '20000000-0000-0000-0000-0000000000c1');
select conversation_id as gconv from public.ingest_channel_message('20000000-0000-0000-0000-0000000000c1', 'inbound', '628120000001', 'Gita', 'gr-1', 'text', 'Halo (#G7K2)', null, null, null) \gset
select is((select assignee_id from public.conversations where id = :'gconv'), '00000000-0000-0000-0000-0000000000c3'::uuid, 'the new chat goes to the agent of the click');
select is((select platform || ':' || gclid from public.ad_leads where conversation_id = :'gconv'), 'google:gclid-1', 'the lead keeps the platform and click id');
select is((select count(*) from public.capi_events), 0::bigint, 'no Google event without a configured account');

insert into public.ad_settings (organization_id, google_customer_id, google_token_hint, google_lead_action_id, google_purchase_action_id, pixel_id, capi_token_hint)
values ('10000000-0000-0000-0000-0000000000c1', '1234567890', '…abcd', '11', '12', '111222333444', '…ABCD');
insert into public.ad_clicks (organization_id, link_id, code, platform, gclid) values
  ('10000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c1', 'G8K3', 'google', 'gclid-2'),
  ('10000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c1', 'T8K3', 'tiktok', null);
select conversation_id as g2 from public.ingest_channel_message('20000000-0000-0000-0000-0000000000c1', 'inbound', '628120000002', 'Hana', 'gr-2', 'text', 'Halo (#G8K3)', null, null, null) \gset
select is((select platform from public.capi_events where lead_id = (select id from public.ad_leads where conversation_id = :'g2')), 'google', 'a Google lead goes to Google');
select public.ingest_channel_message('20000000-0000-0000-0000-0000000000c1', 'inbound', '628120000003', 'Tika', 'gr-3', 'text', 'Halo (#T8K3)', null, null, null);
select is((select count(*) from public.capi_events where platform = 'tiktok'), 0::bigint, 'no TikTok event without a TikTok pixel');

-- ---------------------------------------------------------------- closings, leaderboard
insert into public.sales_targets (organization_id, month, profile_id, revenue_target, closing_target)
values ('10000000-0000-0000-0000-0000000000c1', date_trunc('month', now())::date, '00000000-0000-0000-0000-0000000000c3', 1000000, 4);
insert into public.commission_rules (organization_id, profile_id, percent, per_closing)
values ('10000000-0000-0000-0000-0000000000c1', null, 10, 5000);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select isnt(public.mark_closing(:'gconv', 200000), null, 'the admin marks a closing');
reset role;
select is((select agent_id from public.ad_conversions where conversation_id = :'gconv'), '00000000-0000-0000-0000-0000000000c3'::uuid,
  'a closing entered by the admin goes to the agent handling the chat');
select is((select count(*) from public.capi_events where event_name = 'Purchase' and platform = 'google'), 1::bigint, 'the Purchase goes to Google');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select is((select closings || '/' || revenue::text || '/' || revenue_target::text || '/' || commission::text
  from public.sales_leaderboard(now()::date) where profile_id = '00000000-0000-0000-0000-0000000000c3'),
  '1/200000.00/1000000.00/25000.00', 'leaderboard row with target and own commission');
select is((select commission from public.sales_leaderboard(now()::date) where profile_id = '00000000-0000-0000-0000-0000000000c2'), null,
  'agents do not see the commission of others');
select throws_ok($$ insert into public.commission_rules (organization_id, percent) values ('10000000-0000-0000-0000-0000000000c1', 50) $$,
  '42501', null, 'agents cannot change commission rules');
select throws_ok($$ select public.set_closing_agent(gen_random_uuid(), null) $$, '42501', null, 'agents cannot move closings');
reset role;

-- ---------------------------------------------------------------- repeat orders, segments
insert into public.products (id, organization_id, name, price, repurchase_days) values
  ('50000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'Kopi 250g', 75000, 30);
insert into public.orders (id, organization_id, number, conversation_id, contact_id, total, items, status, paid_at)
select '40000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'INV-G1', :'g2', contact_id, 75000,
  '[{"product_id":"50000000-0000-0000-0000-0000000000c1","name":"Kopi 250g","qty":1,"price":75000}]', 'paid', now()
from public.conversations where id = :'g2';
select is((select products || ' / ' || round(extract(epoch from due_at - now()) / 86400)::text from public.repeat_reminders),
  'Kopi 250g / 27', 'a paid order plans a reminder before the product runs out');
update public.repeat_reminders set due_at = now() - interval '1 minute';
select is((select count(*) from public.repeat_claim(10)), 1::bigint, 'the due reminder is claimed once');
select is((select count(*) from public.repeat_claim(10)), 0::bigint, 'and not twice');
update public.repeat_reminders set status = 'sent', sent_at = now();
insert into public.orders (organization_id, number, conversation_id, contact_id, total, items, status, paid_at)
select '10000000-0000-0000-0000-0000000000c1', 'INV-G2', :'g2', contact_id, 75000, '[{"product_id":"not-a-uuid","name":"x"}]', 'paid', now()
from public.conversations where id = :'g2';
select is((select converted_order_id is not null from public.repeat_reminders where order_id = '40000000-0000-0000-0000-0000000000c1'), true,
  'the next order is credited to the reminder');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select is((select contacts from public.segment_counts() where segment = 'langganan'), 1::bigint, 'two orders: a regular customer');
select is((select count(*) from public.segment_contacts('prospek')), 2::bigint, 'chats without orders: prospects');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c4');
select is((select count(*) from public.segment_counts()), 0::bigint, 'other tenants see no segments');
reset role;

select * from finish();
rollback;
