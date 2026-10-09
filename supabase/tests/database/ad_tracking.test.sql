-- Database tests (pgTAP) for Meta ad tracking: leads from ad referrals and
-- landing page codes, first-touch attribution, closings from orders and by
-- hand, the Conversions API queue, reports and tenant isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'ads-admin@test.local', '{"full_name":"Admin Iklan"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'ads-agent@test.local', '{"full_name":"Agen Iklan"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'ads-other@test.local', '{"full_name":"Admin Lain"}');
insert into public.organizations (id, name) values
  ('10000000-0000-0000-0000-0000000000a1', 'Toko Iklan'),
  ('10000000-0000-0000-0000-0000000000a2', 'Toko Lain');
update public.profiles set organization_id = '10000000-0000-0000-0000-0000000000a1', role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set organization_id = '10000000-0000-0000-0000-0000000000a1', role = 'agent' where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set organization_id = '10000000-0000-0000-0000-0000000000a2', role = 'admin' where id = '00000000-0000-0000-0000-0000000000a3';
insert into public.channels (id, organization_id, name, provider, instance_name, display_phone) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'Nomor Iklan', 'qr', 'ads-test', '+62 811 0000 1234');
insert into public.ad_settings (organization_id, pixel_id, capi_token_hint) values ('10000000-0000-0000-0000-0000000000a1', '111222333444', '…ABCD');
insert into public.ad_spend (organization_id, date, campaign_id, campaign_name, ad_id, ad_name, spend) values
  ('10000000-0000-0000-0000-0000000000a1', (now() at time zone 'Asia/Jakarta')::date, '900', 'Promo Gayo', '902', 'Video', 100000);

create or replace function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select set_config('role', 'authenticated', true);
$$;

-- ---------------------------------------------------------------- click-to-WhatsApp
select conversation_id as ctwa from public.ingest_channel_message('20000000-0000-0000-0000-0000000000a1', 'inbound', '628111000101', 'Sinta', 'ads-1', 'text', 'halo',
  null, '{"referral":{"source_type":"ad","source_id":"902","headline":"Diskon","ctwa_clid":"clid-1"}}', null) \gset
select is((select source from public.ad_leads where conversation_id = :'ctwa'), 'ctwa', 'a referral makes the chat an ad lead');
select is((select campaign_name from public.ad_leads where conversation_id = :'ctwa'), 'Promo Gayo', 'campaign name comes from the fetched spend');
select is((select count(*) from public.capi_events where event_name = 'Lead'), 1::bigint, 'a Lead event is queued');
select public.ingest_channel_message('20000000-0000-0000-0000-0000000000a1', 'inbound', '628111000101', 'Sinta', 'ads-2', 'text', 'halo lagi',
  null, '{"referral":{"source_type":"ad","source_id":"903"}}', null);
select is((select count(*) from public.ad_leads), 1::bigint, 'the same customer is not a second lead (first touch)');
select conversation_id as plain from public.ingest_channel_message('20000000-0000-0000-0000-0000000000a1', 'inbound', '628111000102', 'Rahmat', 'ads-3', 'text', 'pesan biasa (#ZZZZ)', null, null, null) \gset
select is((select count(*) from public.ad_leads where conversation_id = :'plain'), 0::bigint, 'an unknown code is not a lead');
select is((select body from public.messages where wa_message_id = 'ads-3'), 'pesan biasa (#ZZZZ)', 'an unknown code stays in the message');

-- ---------------------------------------------------------------- landing page code
insert into public.wa_links (id, organization_id, slug, name, campaign_name) values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'kopi-test', 'Landing Kopi', 'Retarget');
insert into public.ad_clicks (organization_id, link_id, code, fbc, ad_id) values
  ('10000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', 'K7P2', 'fb.1.1.abc', '777');
select conversation_id as lp from public.ingest_channel_message('20000000-0000-0000-0000-0000000000a1', 'inbound', '628111000103', 'Budi', 'ads-4', 'text', 'Halo kak (#K7P2)', null, null, null) \gset
select is((select body from public.messages where wa_message_id = 'ads-4'), 'Halo kak', 'the code is taken out of the message');
select is((select source || ':' || campaign_name || ':' || ad_id from public.ad_leads where conversation_id = :'lp'), 'link:Retarget:777', 'landing page lead with campaign and ad');
select is((select matched_conversation_id from public.ad_clicks where code = 'K7P2'), :'lp'::uuid, 'the click is matched to the chat');

-- ---------------------------------------------------------------- closings
insert into public.orders (id, organization_id, number, conversation_id, contact_id, total)
select '40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'INV-1', :'lp', contact_id, 200000 from public.conversations where id = :'lp';
select is((select count(*) from public.ad_conversions), 0::bigint, 'an unpaid order is not a closing');
update public.orders set status = 'paid' where id = '40000000-0000-0000-0000-0000000000a1';
select is((select value from public.ad_conversions where order_id = '40000000-0000-0000-0000-0000000000a1'), 200000.00, 'a paid order is a closing');
select is((select count(*) from public.capi_events where event_name = 'Purchase'), 1::bigint, 'a Purchase event is queued');
update public.orders set status = 'shipped' where id = '40000000-0000-0000-0000-0000000000a1';
select is((select count(*) from public.ad_conversions), 1::bigint, 'shipping does not count it twice');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok(format($$ select public.mark_closing(%L, 0) $$, :'ctwa'), '22023', null, 'a closing needs a value');
select isnt(public.mark_closing(:'ctwa', 150000, 'transfer'), null, 'an agent marks a closing by hand');
select is((select count(*) from public.ad_leads), 2::bigint, 'agents see the leads of their chats');
select throws_ok($$ select public.ads_report(current_date, current_date, 'campaign') $$, '42501', null, 'agents cannot open the ad report');
select throws_ok($$ select public.ad_lead_for(gen_random_uuid()) $$, '42501', null, 'the attribution helper is internal');
reset role;

-- ---------------------------------------------------------------- report & isolation
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is((select spend::text || '/' || leads || '/' || closings || '/' || revenue::text from public.ads_report((now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date, 'campaign') where name = 'Promo Gayo'),
  '100000.00/1/1/150000.00', 'campaign row: spend, leads, closings, revenue');
select is((select (s ->> 'leads')::int + (s ->> 'closings')::int from public.ads_summary((now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date) s), 4, 'summary counts leads and closings');
select throws_ok($$ update public.ad_settings set capi_token_hint = 'x' $$, '42501', null, 'token hints are written by the server only');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select is((select count(*) from public.ad_leads) + (select count(*) from public.ad_clicks) + (select count(*) from public.wa_links), 0::bigint, 'other tenants see nothing');
select is((select count(*) from public.ads_report(current_date - 30, current_date, 'campaign')), 0::bigint, 'and their report is empty');
reset role;
select is(public.purge_ad_clicks(), 0, 'matched clicks are kept');

select * from finish();
rollback;
