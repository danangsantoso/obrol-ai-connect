-- Features that grow revenue:
--  1. CS rotator: a landing page link spreads chats over several WhatsApp
--     numbers and/or agents (online ones first).
--  2. Sales targets and commissions per agent: every closing (paid order or
--     "Tandai closing") is credited to an agent; monthly leaderboard.
--  3. Repeat orders: products with a usual repurchase period get a reminder
--     to the customer before they run out; customer segments (new, regular,
--     dormant, prospect) for broadcasts.
--  4. Shipment tracking: shipped orders are tracked (Biteship) and the
--     customer hears when the parcel arrives; the AI knows the order status.
--  5. Google Ads and TikTok Ads next to Meta: click ids from landing pages,
--     conversions sent back to each platform, spend per platform.

-- ===========================================================================
-- 5. Platforms (first: the other features build on the columns)
-- ===========================================================================
alter table public.ad_clicks
  add column platform text not null default 'meta' check (platform in ('meta', 'google', 'tiktok', 'other')),
  add column gclid text,
  add column ttclid text,
  add column channel_id uuid references public.channels (id) on delete set null,
  add column agent_id uuid references public.profiles (id) on delete set null;

alter table public.ad_leads
  add column platform text not null default 'meta' check (platform in ('meta', 'google', 'tiktok', 'other')),
  add column gclid text,
  add column ttclid text;

alter table public.ad_spend add column platform text not null default 'meta' check (platform in ('meta', 'google', 'tiktok', 'other'));
alter table public.ad_spend drop constraint ad_spend_organization_id_date_ad_key_key;
alter table public.ad_spend add constraint ad_spend_org_platform_date_key unique (organization_id, platform, date, ad_key);

alter table public.capi_events add column platform text not null default 'meta' check (platform in ('meta', 'google', 'tiktok'));
alter table public.capi_events drop constraint capi_events_event_id_key;
alter table public.capi_events add constraint capi_events_platform_event_key unique (platform, event_id);
alter table public.capi_events drop constraint capi_events_event_name_check;
alter table public.capi_events add constraint capi_events_event_name_check check (event_name in ('Lead', 'Purchase', 'InitiateCheckout'));

alter table public.ad_settings
  -- Google Ads: account (10 digits), optional manager account, conversion actions.
  add column google_customer_id text check (google_customer_id ~ '^[0-9]{10}$'),
  add column google_login_customer_id text check (google_login_customer_id ~ '^[0-9]{10}$'),
  add column google_lead_action_id text check (google_lead_action_id ~ '^[0-9]{1,20}$'),
  add column google_purchase_action_id text check (google_purchase_action_id ~ '^[0-9]{1,20}$'),
  add column google_client_id text check (char_length(google_client_id) <= 200),
  add column google_token_hint text,
  add column google_developer_hint text,
  add column google_secret_hint text,
  add column google_spend_sync_at timestamptz,
  add column google_spend_error text,
  add column google_event_error text,
  -- TikTok: pixel for the Events API, advertiser for spend.
  add column tiktok_pixel_code text check (tiktok_pixel_code ~ '^[A-Z0-9]{10,40}$'),
  add column tiktok_advertiser_id text check (tiktok_advertiser_id ~ '^[0-9]{6,25}$'),
  add column tiktok_token_hint text,
  add column tiktok_spend_sync_at timestamptz,
  add column tiktok_spend_error text,
  add column tiktok_event_error text;
grant insert (google_customer_id, google_login_customer_id, google_lead_action_id, google_purchase_action_id, google_client_id,
  tiktok_pixel_code, tiktok_advertiser_id) on public.ad_settings to authenticated;
grant update (google_customer_id, google_login_customer_id, google_lead_action_id, google_purchase_action_id, google_client_id,
  tiktok_pixel_code, tiktok_advertiser_id) on public.ad_settings to authenticated;

alter table public.ad_secrets
  add column google_developer_token_encrypted text,
  add column google_client_secret_encrypted text,
  add column google_refresh_token_encrypted text,
  add column tiktok_token_encrypted text;

-- ===========================================================================
-- 1. CS rotator
-- ===========================================================================
alter table public.wa_links
  -- Empty: the link's own number (channel_id) or the first one.
  add column channel_ids uuid[] not null default '{}',
  -- Empty: chats are not assigned by the link (auto-rotation may still apply).
  add column agent_ids uuid[] not null default '{}',
  add column rotation_counter bigint not null default 0;

-- The number to open and the agent to give the chat to, in turn. Numbers
-- that are disconnected and agents who are offline are skipped while others
-- are available.
create or replace function public.wa_link_pick(p_link uuid)
returns table (channel_id uuid, phone text, agent_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.wa_links;
  v_channels uuid[];
  v_agents uuid[];
  v_channel uuid;
begin
  update public.wa_links set rotation_counter = rotation_counter + 1 where id = p_link returning * into l;
  if l.id is null then
    return;
  end if;

  -- Several numbers: the connected ones in turn.
  if cardinality(l.channel_ids) > 0 then
    select array_agg(c.id order by array_position(l.channel_ids, c.id)) into v_channels
    from public.channels c
    where c.id = any (l.channel_ids) and c.organization_id = l.organization_id and c.is_active
      and c.provider in ('cloud_api', 'qr') and c.display_phone is not null
      and (c.provider = 'cloud_api' or c.connection_status = 'connected');
  end if;
  -- One number, or none of them connected: the link's number, else the first WhatsApp number.
  if v_channels is null then
    select array[c.id] into v_channels
    from public.channels c
    where c.organization_id = l.organization_id and c.is_active and c.provider in ('cloud_api', 'qr') and c.display_phone is not null
    order by (c.id = l.channel_id) desc nulls last, (c.id = any (l.channel_ids)) desc, c.created_at
    limit 1;
  end if;
  if v_channels is not null then
    v_channel := v_channels[1 + (l.rotation_counter % cardinality(v_channels))::integer];
  end if;

  if cardinality(l.agent_ids) > 0 then
    select array_agg(p.id order by array_position(l.agent_ids, p.id)) into v_agents
    from public.profiles p
    where p.id = any (l.agent_ids) and p.organization_id = l.organization_id and p.is_active and p.status = 'online';
    if v_agents is null then
      select array_agg(p.id order by array_position(l.agent_ids, p.id)) into v_agents
      from public.profiles p
      where p.id = any (l.agent_ids) and p.organization_id = l.organization_id and p.is_active;
    end if;
  end if;

  return query
  select v_channel,
    (select regexp_replace(c.display_phone, '\D', '', 'g') from public.channels c where c.id = v_channel),
    case when v_agents is null then null else v_agents[1 + (l.rotation_counter % cardinality(v_agents))::integer] end;
end;
$$;
revoke execute on function public.wa_link_pick(uuid) from public, anon, authenticated;

-- Lead detection (replaces the version of 20261107): records the platform
-- and click ids, and gives a brand-new chat from a rotator link to its agent.
create or replace function public.ad_attribute_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref jsonb := new.metadata -> 'referral';
  v_code text;
  v_conv record;
  v_click public.ad_clicks;
  v_spend public.ad_spend;
  v_lead uuid;
  v_first boolean;
begin
  if new.direction <> 'inbound' then
    return new;
  end if;
  v_code := substring(coalesce(new.body, '') from '\(#([A-Z2-9]{4})\)\s*$');
  if v_ref is null and v_code is null then
    return new;
  end if;

  select c.organization_id, c.contact_id, c.assignee_id, ch.provider into v_conv
  from public.conversations c join public.channels ch on ch.id = c.channel_id
  where c.id = new.conversation_id;
  v_first := not exists (select 1 from public.messages m where m.conversation_id = new.conversation_id);

  if v_code is not null then
    select * into v_click from public.ad_clicks
    where organization_id = v_conv.organization_id and code = v_code and created_at > now() - interval '14 days';
    if v_click.id is not null then
      new.body := nullif(btrim(regexp_replace(new.body, '\s*\(#[A-Z2-9]{4}\)\s*$', '')), '');
      new.metadata := coalesce(new.metadata, '{}') || jsonb_build_object('ad_click_code', v_code);
      update public.ad_clicks set matched_conversation_id = new.conversation_id, matched_at = now()
      where id = v_click.id and matched_at is null;
      -- Rotator: a new chat goes to the agent whose turn it was (over auto-rotation).
      if v_click.agent_id is not null and v_first then
        update public.conversations
        set assignee_id = v_click.agent_id, rotated_at = now(),
            rotation_deadline = now() + make_interval(mins => coalesce((select rotate_timeout_minutes from public.organizations where id = v_conv.organization_id), 5))
        where id = new.conversation_id and assignee_id is distinct from v_click.agent_id;
      end if;
    end if;
  end if;
  if v_click.id is null and (v_ref is null or coalesce(v_ref ->> 'source_type', 'ad') <> 'ad') then
    return new;
  end if;

  -- First touch wins: a customer who already came from an ad recently stays with that ad.
  if exists (
    select 1 from public.contacts ct
    join public.contacts grp on coalesce(grp.merged_into, grp.id) = coalesce(ct.merged_into, ct.id)
    join public.ad_leads l on l.contact_id = grp.id
    left join public.ad_settings s on s.organization_id = v_conv.organization_id
    where ct.id = v_conv.contact_id and l.created_at > now() - make_interval(days => coalesce(s.attribution_days, 28))
  ) then
    return new;
  end if;

  if v_click.id is not null then
    insert into public.ad_leads (organization_id, conversation_id, contact_id, source, platform, channel_provider, click_id,
      campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, source_url, gclid, ttclid)
    values (v_conv.organization_id, new.conversation_id, v_conv.contact_id, 'link', v_click.platform, v_conv.provider, v_click.id,
      v_click.campaign_id,
      coalesce(v_click.campaign_name, (select campaign_name from public.wa_links where id = v_click.link_id),
               (select name from public.wa_links where id = v_click.link_id)),
      v_click.adset_id, v_click.adset_name, v_click.ad_id, v_click.ad_name, v_click.landing_url, v_click.gclid, v_click.ttclid)
    on conflict (conversation_id) do nothing
    returning id into v_lead;
  else
    select * into v_spend from public.ad_spend
    where organization_id = v_conv.organization_id and platform = 'meta' and ad_id = v_ref ->> 'source_id'
    order by date desc limit 1;
    insert into public.ad_leads (organization_id, conversation_id, contact_id, source, platform, channel_provider,
      campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, headline, ad_body, source_url, media_url, ctwa_clid)
    values (v_conv.organization_id, new.conversation_id, v_conv.contact_id, 'ctwa', 'meta', v_conv.provider,
      v_spend.campaign_id, v_spend.campaign_name, v_spend.adset_id, v_spend.adset_name,
      nullif(v_ref ->> 'source_id', ''), v_spend.ad_name,
      left(v_ref ->> 'headline', 300), left(v_ref ->> 'body', 500), left(v_ref ->> 'source_url', 500),
      left(v_ref ->> 'media_url', 500), nullif(v_ref ->> 'ctwa_clid', ''))
    on conflict (conversation_id) do nothing
    returning id into v_lead;
  end if;

  if v_lead is not null then
    perform public.enqueue_capi(v_conv.organization_id, 'Lead', 'lead-' || v_lead, v_lead, null, null);
  end if;
  return new;
end;
$$;

-- Conversions go back to the platform the customer came from (replaces 20261107).
create or replace function public.enqueue_capi(p_org uuid, p_event text, p_event_id text, p_lead uuid, p_conversion uuid, p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ad_settings;
  l public.ad_leads;
  v_platform text;
begin
  select * into s from public.ad_settings where organization_id = p_org;
  select * into l from public.ad_leads where id = p_lead;
  if s.organization_id is null or l.id is null
     or (p_event = 'Lead' and not s.send_lead)
     or (p_event = 'Purchase' and not s.send_purchase)
     or (p_event = 'InitiateCheckout' and not s.send_checkout) then
    return;
  end if;
  v_platform := case when l.platform in ('google', 'tiktok') then l.platform else 'meta' end;
  if v_platform = 'meta' and (s.pixel_id is null or s.capi_token_hint is null) then
    return;
  end if;
  if v_platform = 'google' and (s.google_customer_id is null or s.google_token_hint is null or l.gclid is null
     or (case p_event when 'Lead' then s.google_lead_action_id when 'Purchase' then s.google_purchase_action_id end) is null) then
    return;
  end if;
  if v_platform = 'tiktok' and (s.tiktok_pixel_code is null or s.tiktok_token_hint is null) then
    return;
  end if;
  insert into public.capi_events (organization_id, platform, event_name, event_id, lead_id, conversion_id, order_id)
  values (p_org, v_platform, p_event, p_event_id, p_lead, p_conversion, p_order)
  on conflict (platform, event_id) do nothing;
end;
$$;
revoke execute on function public.enqueue_capi(uuid, text, text, uuid, uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. Targets and commissions
-- ===========================================================================
alter table public.ad_conversions add column agent_id uuid references public.profiles (id) on delete set null;
create index ad_conversions_agent_idx on public.ad_conversions (organization_id, agent_id, occurred_at);
update public.ad_conversions c
set agent_id = coalesce(c.created_by, o.created_by, v.assignee_id)
from public.ad_conversions x
left join public.orders o on o.id = x.order_id
left join public.conversations v on v.id = x.conversation_id
where x.id = c.id;

create table public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  -- null: the whole team.
  profile_id uuid references public.profiles (id) on delete cascade,
  revenue_target numeric(14, 2) not null default 0 check (revenue_target >= 0),
  closing_target integer not null default 0 check (closing_target >= 0),
  updated_at timestamptz not null default now()
);
create unique index sales_targets_unique on public.sales_targets (organization_id, month, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'));
alter table public.sales_targets enable row level security;
create policy "members read targets" on public.sales_targets
  for select to authenticated using (organization_id = public.current_org_id());
create policy "admins and supervisors set targets" on public.sales_targets
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'))
  with check (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- null: everyone without their own rule.
  profile_id uuid references public.profiles (id) on delete cascade,
  percent numeric(5, 2) not null default 0 check (percent between 0 and 100),
  per_closing numeric(14, 2) not null default 0 check (per_closing >= 0),
  updated_at timestamptz not null default now()
);
create unique index commission_rules_unique on public.commission_rules (organization_id, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'));
alter table public.commission_rules enable row level security;
create policy "admins manage commission" on public.commission_rules
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (organization_id = public.current_org_id() and public.current_role_name() = 'admin');
create policy "people read their own commission rule" on public.commission_rules
  for select to authenticated using (organization_id = public.current_org_id() and (profile_id = auth.uid() or profile_id is null));

create trigger audit_sales_targets after insert or update or delete on public.sales_targets
  for each row execute function public.audit_row('sales_target');
create trigger audit_commission_rules after insert or update or delete on public.commission_rules
  for each row execute function public.audit_row('commission');

-- Closings get their agent (replaces 20261107): an order's maker, else the
-- agent handling the chat; a closing entered by hand goes to the agent
-- handling the chat, else to whoever entered it.
create or replace function public.ad_order_closing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid boolean := new.status in ('paid', 'processing', 'shipped', 'completed');
  v_was_paid boolean := tg_op = 'UPDATE' and old.status in ('paid', 'processing', 'shipped', 'completed');
  v_lead uuid;
  v_conversion uuid;
  v_agent uuid;
begin
  if new.conversation_id is null then
    return null;
  end if;
  if tg_op = 'INSERT' and not v_paid then
    v_lead := public.ad_lead_for(new.conversation_id);
    if v_lead is not null then
      perform public.enqueue_capi(new.organization_id, 'InitiateCheckout', 'checkout-' || new.id, v_lead, null, new.id);
    end if;
  end if;
  if v_paid and not v_was_paid then
    v_lead := public.ad_lead_for(new.conversation_id);
    v_agent := coalesce(new.created_by, (select assignee_id from public.conversations where id = new.conversation_id));
    insert into public.ad_conversions (organization_id, conversation_id, contact_id, lead_id, order_id, kind, value, currency, occurred_at, agent_id)
    values (new.organization_id, new.conversation_id, new.contact_id, v_lead, new.id, 'order', new.total, new.currency, coalesce(new.paid_at, now()), v_agent)
    on conflict (order_id) do update set cancelled_at = null
    returning id into v_conversion;
    if v_lead is not null then
      perform public.enqueue_capi(new.organization_id, 'Purchase', 'purchase-' || v_conversion, v_lead, v_conversion, new.id);
    end if;
  elsif new.status = 'cancelled' and v_was_paid then
    update public.ad_conversions set cancelled_at = now() where order_id = new.id;
  end if;
  return null;
end;
$$;

create or replace function public.mark_closing(p_conversation uuid, p_value numeric, p_note text default null, p_send boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations;
  v_lead uuid;
  v_id uuid;
begin
  if not public.can_access_conversation(p_conversation) then
    raise exception 'Chat tidak ditemukan' using errcode = 'P0002';
  end if;
  if p_value is null or p_value <= 0 or p_value > 10000000000 then
    raise exception 'Isi nilai closing yang benar' using errcode = '22023';
  end if;
  select * into v_conv from public.conversations where id = p_conversation;
  v_lead := public.ad_lead_for(p_conversation);
  insert into public.ad_conversions (organization_id, conversation_id, contact_id, lead_id, kind, value, note, created_by, agent_id)
  values (v_conv.organization_id, p_conversation, v_conv.contact_id, v_lead, 'manual', round(p_value, 2), nullif(btrim(p_note), ''), auth.uid(),
    coalesce(v_conv.assignee_id, auth.uid()))
  returning id into v_id;
  if v_lead is not null and p_send then
    perform public.enqueue_capi(v_conv.organization_id, 'Purchase', 'purchase-' || v_id, v_lead, v_id, null);
  end if;
  perform public.audit_write(v_conv.organization_id, auth.uid(), 'create', 'closing', v_id::text,
    coalesce(public.contact_label(p_conversation), 'chat') || ' · Rp' || to_char(round(p_value), 'FM999G999G999G990'), null);
  return v_id;
end;
$$;

-- Monthly leaderboard. Everyone sees ranks, chats, closings and revenue;
-- commissions only their own (admins and supervisors: all).
create or replace function public.sales_leaderboard(p_month date)
returns table (profile_id uuid, name text, avatar_url text, role text, chats bigint, closings bigint, revenue numeric,
  revenue_target numeric, closing_target integer, commission numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_all boolean := public.current_role_name() in ('admin', 'supervisor');
begin
  if v_org is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(timezone, 'Asia/Jakarta') into v_tz from public.organizations where id = v_org;
  v_from := (date_trunc('month', p_month)::date)::timestamp at time zone v_tz;
  v_to := ((date_trunc('month', p_month) + interval '1 month')::date)::timestamp at time zone v_tz;
  return query
  with c as (
    select x.agent_id, count(*) as n, sum(x.value) as total
    from public.ad_conversions x
    where x.organization_id = v_org and x.cancelled_at is null and x.occurred_at >= v_from and x.occurred_at < v_to
    group by x.agent_id
  ),
  m as (
    select msg.sender_id, count(distinct msg.conversation_id) as n
    from public.messages msg
    where msg.organization_id = v_org and msg.direction = 'outbound' and msg.sender_id is not null
      and msg.created_at >= v_from and msg.created_at < v_to
    group by msg.sender_id
  ),
  people as (
    select p.id, coalesce(nullif(p.full_name, ''), p.email) as nm, p.avatar_url as av, p.role::text as rl
    from public.profiles p
    where p.organization_id = v_org and (p.is_active or exists (select 1 from c where c.agent_id = p.id))
  )
  select pe.id, pe.nm, pe.av, pe.rl, coalesce(m.n, 0)::bigint, coalesce(c.n, 0)::bigint, coalesce(c.total, 0)::numeric,
    coalesce(t.revenue_target, 0)::numeric, coalesce(t.closing_target, 0)::integer,
    case when v_all or pe.id = auth.uid() then
      round(coalesce(c.total, 0) * coalesce(r.percent, d.percent, 0) / 100 + coalesce(c.n, 0) * coalesce(r.per_closing, d.per_closing, 0), 2)
    end
  from people pe
  left join c on c.agent_id = pe.id
  left join m on m.sender_id = pe.id
  left join public.sales_targets t on t.organization_id = v_org and t.month = date_trunc('month', p_month)::date and t.profile_id = pe.id
  left join public.commission_rules r on r.organization_id = v_org and r.profile_id = pe.id
  left join public.commission_rules d on d.organization_id = v_org and d.profile_id is null
  union all
  -- Closings nobody is credited for (the AI made the order, chat unassigned).
  select null, 'AI / tanpa agen', null, null, 0::bigint, c.n::bigint, c.total::numeric, 0::numeric, 0, null::numeric
  from c where c.agent_id is null
  order by 7 desc, 6 desc, 5 desc;
end;
$$;
revoke execute on function public.sales_leaderboard(date) from public, anon;
grant execute on function public.sales_leaderboard(date) to authenticated;

-- Hand a closing to another agent (wrong credit).
create or replace function public.set_closing_agent(p_id uuid, p_agent uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_role_name() not in ('admin', 'supervisor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_agent is not null and not exists (select 1 from public.profiles where id = p_agent and organization_id = public.current_org_id()) then
    raise exception 'Agen tidak ditemukan' using errcode = 'P0002';
  end if;
  update public.ad_conversions set agent_id = p_agent where id = p_id and organization_id = public.current_org_id();
end;
$$;
revoke execute on function public.set_closing_agent(uuid, uuid) from public, anon;
grant execute on function public.set_closing_agent(uuid, uuid) to authenticated;

-- ===========================================================================
-- 3. Repeat orders and customer segments
-- ===========================================================================
alter table public.products add column repurchase_days integer check (repurchase_days between 1 and 365);

create table public.repeat_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  -- The reminder goes this many days before the product usually runs out.
  days_before integer not null default 3 check (days_before between 0 and 60),
  message text not null default 'Halo kak {nama} 😊 {produk} kakak sepertinya sebentar lagi habis ya. Mau kami siapkan lagi? Balas pesan ini saja, nanti kami bantu.'
    check (char_length(message) between 10 and 1000),
  -- Official numbers outside the 24-hour window need an approved template.
  template_name text,
  template_language text not null default 'id',
  -- After this many days without an order a customer counts as dormant.
  dormant_days integer not null default 60 check (dormant_days between 14 and 365),
  updated_at timestamptz not null default now()
);
alter table public.repeat_settings enable row level security;
create policy "members read repeat settings" on public.repeat_settings
  for select to authenticated using (organization_id = public.current_org_id());
create policy "admins change repeat settings" on public.repeat_settings
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

create table public.repeat_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  products text not null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'cancelled')),
  reason text,
  message_id uuid references public.messages (id) on delete set null,
  sent_at timestamptz,
  -- The order that followed the reminder (within 14 days).
  converted_order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index repeat_reminders_due_idx on public.repeat_reminders (due_at) where status = 'pending';
create index repeat_reminders_contact_idx on public.repeat_reminders (contact_id, status);
alter table public.repeat_reminders enable row level security;
create policy "admins and supervisors read reminders" on public.repeat_reminders
  for select to authenticated using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

-- A paid order: earlier reminders of the customer are done (and credited
-- when one was sent shortly before), and a new one is planned from the
-- shortest repurchase period of its products.
create or replace function public.repeat_on_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid boolean := new.status in ('paid', 'processing', 'shipped', 'completed');
  v_was_paid boolean := tg_op = 'UPDATE' and old.status in ('paid', 'processing', 'shipped', 'completed');
  v_days integer;
  v_names text;
  v_before integer;
  v_at timestamptz := coalesce(new.paid_at, now());
begin
  if not v_paid or v_was_paid or new.contact_id is null or new.conversation_id is null then
    return null;
  end if;
  update public.repeat_reminders r
  set converted_order_id = new.id
  where r.contact_id = new.contact_id and r.status = 'sent' and r.converted_order_id is null
    and r.sent_at > v_at - interval '14 days';
  update public.repeat_reminders
  set status = 'cancelled', reason = 'Pelanggan sudah pesan lagi'
  where contact_id = new.contact_id and status = 'pending';

  select min(p.repurchase_days), string_agg(distinct p.name, ', ')
  into v_days, v_names
  from jsonb_array_elements(coalesce(new.items, '[]')) i
  join public.products p on (i ->> 'product_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and p.id = (i ->> 'product_id')::uuid and p.organization_id = new.organization_id
  where p.repurchase_days is not null;
  if v_days is null then
    return null;
  end if;
  select coalesce((select days_before from public.repeat_settings where organization_id = new.organization_id), 3) into v_before;
  insert into public.repeat_reminders (organization_id, contact_id, conversation_id, order_id, products, due_at)
  values (new.organization_id, new.contact_id, new.conversation_id, new.id, v_names,
    v_at + make_interval(days => greatest(v_days - v_before, 1)));
  return null;
end;
$$;
create trigger orders_repeat after insert or update of status on public.orders
  for each row execute function public.repeat_on_order();

create or replace function public.repeat_claim(p_limit integer)
returns setof public.repeat_reminders
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.repeat_reminders set status = 'pending'
  where status = 'sending' and due_at < now() - interval '15 minutes';
  return query
  update public.repeat_reminders r set status = 'sending'
  from (
    select id from public.repeat_reminders
    where status = 'pending' and due_at <= now()
    order by due_at limit p_limit
    for update skip locked
  ) due
  where r.id = due.id
  returning r.*;
end;
$$;
revoke execute on function public.repeat_claim(integer) from public, anon, authenticated;

-- Segments look up a customer's chats.
create index if not exists conversations_contact_idx on public.conversations (contact_id);

-- baru: one order, recent · langganan: 2+ orders, recent · tidur: no order
-- for dormant_days · prospek: chatted in the last 30 days, never ordered.
create or replace function public.contact_segment(p_contact uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with grp as (
    select g.id, g.organization_id from public.contacts c
    join public.contacts g on coalesce(g.merged_into, g.id) = coalesce(c.merged_into, c.id)
    where c.id = p_contact
  ),
  o as (
    select count(*) as n, max(coalesce(o.paid_at, o.created_at)) as last
    from public.orders o where o.contact_id in (select id from grp)
      and o.status in ('paid', 'processing', 'shipped', 'completed')
  ),
  s as (
    select coalesce((select dormant_days from public.repeat_settings r where r.organization_id = (select organization_id from grp limit 1)), 60) as dormant
  )
  select case
    when o.n >= 2 and o.last > now() - make_interval(days => s.dormant) then 'langganan'
    when o.n = 1 and o.last > now() - make_interval(days => s.dormant) then 'baru'
    when o.n >= 1 then 'tidur'
    when exists (select 1 from public.conversations v where v.contact_id in (select id from grp) and v.last_customer_message_at > now() - interval '30 days') then 'prospek'
  end
  from o, s
$$;
revoke execute on function public.contact_segment(uuid) from public, anon;

create or replace function public.segment_counts()
returns table (segment text, contacts bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select seg, count(*) from (
    select public.contact_segment(c.id) as seg
    from public.contacts c
    where c.organization_id = public.current_org_id() and c.merged_into is null
  ) x where seg is not null group by seg
$$;
revoke execute on function public.segment_counts() from public, anon;
grant execute on function public.segment_counts() to authenticated;

create or replace function public.segment_contacts(p_segment text, p_limit integer default 500)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.contacts c
  where c.organization_id = public.current_org_id() and c.merged_into is null
    and public.contact_segment(c.id) = p_segment
  order by c.updated_at desc
  limit least(p_limit, 2000)
$$;
revoke execute on function public.segment_contacts(text, integer) from public, anon;
grant execute on function public.segment_contacts(text, integer) to authenticated;

-- Broadcasts can target a segment.
alter table public.broadcasts add column segment text check (segment in ('baru', 'langganan', 'tidur', 'prospek'));

drop function public.broadcast_audience_count(uuid, uuid[], integer, boolean);
create function public.broadcast_audience_count(
  p_channel uuid, p_label_ids uuid[], p_active_days integer, p_only_opt_in boolean, p_segment text default null
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
  return (select count(*) from public.broadcast_audience(public.current_org_id(), p_channel, coalesce(p_label_ids, '{}'), p_active_days, coalesce(p_only_opt_in, false)) a
          where p_segment is null or public.contact_segment(a.contact_id) = p_segment);
end;
$$;
revoke execute on function public.broadcast_audience_count(uuid, uuid[], integer, boolean, text) from public, anon;
grant execute on function public.broadcast_audience_count(uuid, uuid[], integer, boolean, text) to authenticated;

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
  where v_b.segment is null or public.contact_segment(a.contact_id) = v_b.segment
  on conflict do nothing;
  get diagnostics v_count = row_count;
  update public.broadcasts set status = 'sending', started_at = now(), total = v_count where id = p_id;
  return v_count;
end;
$$;
revoke execute on function public.broadcast_prepare(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 4. Shipment tracking
-- ===========================================================================
alter table public.orders
  add column tracking_status text,
  add column tracking_checked_at timestamptz,
  add column delivered_at timestamptz;
create index orders_tracking_idx on public.orders (tracking_checked_at nulls first)
  where status = 'shipped' and tracking_number is not null;

-- ===========================================================================
-- 5. Reports per platform (replace 20261107)
-- ===========================================================================
drop function public.ads_report(date, date, text);
create function public.ads_report(p_from date, p_to date, p_level text, p_platform text default null)
returns table (key text, name text, parent text, path text, platform text, spend numeric, leads bigint, closings bigint, revenue numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.ads_check_access();
  v_tz text;
begin
  if p_level not in ('campaign', 'adset', 'ad') then
    raise exception 'invalid level' using errcode = '22023';
  end if;
  select coalesce(timezone, 'Asia/Jakarta') into v_tz from public.organizations where id = v_org;
  return query
  with s as (
    select x.platform as pf,
      case p_level
        when 'campaign' then coalesce(x.campaign_id, 'name:' || lower(coalesce(x.campaign_name, '')))
        when 'adset' then coalesce(x.adset_id, 'name:' || lower(coalesce(x.adset_name, x.campaign_name, '')))
        else coalesce(x.ad_id, 'name:' || lower(coalesce(x.ad_name, x.campaign_name, '')))
      end as k,
      max(case p_level when 'campaign' then x.campaign_name when 'adset' then coalesce(x.adset_name, x.campaign_name) else coalesce(x.ad_name, x.campaign_name) end) as n,
      max(case p_level when 'campaign' then null when 'adset' then x.campaign_name else coalesce(x.adset_name, x.campaign_name) end) as p,
      sum(x.spend) as total
    from public.ad_spend x
    where x.organization_id = v_org and x.date between p_from and p_to and (p_platform is null or x.platform = p_platform)
    group by 1, 2
  ),
  l as (
    select y.platform as pf,
      case p_level
        when 'campaign' then coalesce(y.campaign_id, 'name:' || lower(coalesce(y.campaign_name, '')))
        when 'adset' then coalesce(y.adset_id, 'name:' || lower(coalesce(y.adset_name, y.campaign_name, '')))
        else coalesce(y.ad_id, 'name:' || lower(coalesce(y.ad_name, y.campaign_name, '')))
      end as k,
      y.*
    from public.ad_leads y
    where y.organization_id = v_org and (p_platform is null or y.platform = p_platform)
  ),
  ll as (
    select l.pf, l.k,
      max(case p_level when 'campaign' then l.campaign_name when 'adset' then coalesce(l.adset_name, l.campaign_name) else coalesce(l.ad_name, l.headline, l.campaign_name) end) as n,
      max(case p_level when 'campaign' then null when 'adset' then l.campaign_name else coalesce(l.adset_name, l.campaign_name) end) as p,
      count(*) filter (where (l.created_at at time zone v_tz)::date between p_from and p_to) as lead_count,
      count(*) filter (where l.source = 'link') as via_link,
      count(*) as all_leads
    from l group by l.pf, l.k
  ),
  cc as (
    select l.pf, l.k, count(*) as n, sum(c.value) as total
    from public.ad_conversions c join l on l.id = c.lead_id
    where c.organization_id = v_org and c.cancelled_at is null
      and (c.occurred_at at time zone v_tz)::date between p_from and p_to
    group by l.pf, l.k
  )
  select
    coalesce(s.k, ll.k, cc.k),
    coalesce(s.n, ll.n, 'Tanpa nama kampanye'),
    coalesce(s.p, ll.p),
    case when ll.k is null then null when ll.via_link * 2 > ll.all_leads then 'link' else 'ctwa' end,
    coalesce(s.pf, ll.pf, cc.pf),
    coalesce(s.total, 0)::numeric,
    coalesce(ll.lead_count, 0)::bigint,
    coalesce(cc.n, 0)::bigint,
    coalesce(cc.total, 0)::numeric
  from s
  full join ll on ll.k = s.k and ll.pf = s.pf
  full join cc on cc.k = coalesce(s.k, ll.k) and cc.pf = coalesce(s.pf, ll.pf)
  where coalesce(s.total, 0) > 0 or coalesce(ll.lead_count, 0) > 0 or coalesce(cc.n, 0) > 0
  order by coalesce(s.total, 0) desc, coalesce(ll.lead_count, 0) desc;
end;
$$;
revoke execute on function public.ads_report(date, date, text, text) from public, anon;
grant execute on function public.ads_report(date, date, text, text) to authenticated;

drop function public.ads_summary(date, date);
create function public.ads_summary(p_from date, p_to date, p_platform text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.ads_check_access();
  v_tz text;
  v jsonb;
begin
  select coalesce(timezone, 'Asia/Jakarta') into v_tz from public.organizations where id = v_org;
  with leads as (
    select * from public.ad_leads
    where organization_id = v_org and (created_at at time zone v_tz)::date between p_from and p_to
      and (p_platform is null or platform = p_platform)
  ),
  all_leads as (
    select * from public.ad_leads
    where organization_id = v_org and (p_platform is null or platform = p_platform)
  ),
  conv as (
    select c.*, l.platform as pf from public.ad_conversions c join all_leads l on l.id = c.lead_id
    where c.organization_id = v_org and c.cancelled_at is null
      and (c.occurred_at at time zone v_tz)::date between p_from and p_to
  ),
  spend as (
    select * from public.ad_spend
    where organization_id = v_org and date between p_from and p_to and (p_platform is null or platform = p_platform)
  ),
  days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  )
  select jsonb_build_object(
    'spend', (select coalesce(sum(spend), 0) from spend),
    'ad_clicks', (select coalesce(sum(clicks), 0) from spend),
    'leads', (select count(*) from leads),
    'leads_ctwa', (select count(*) from leads where source = 'ctwa'),
    'leads_link', (select count(*) from leads where source = 'link'),
    'replied', (select count(*) from leads l where exists (
        select 1 from public.messages m where m.conversation_id = l.conversation_id and m.direction = 'outbound' and m.created_at >= l.created_at)),
    'orders', (select count(distinct o.id) from leads l join public.orders o on o.conversation_id = l.conversation_id and o.created_at >= l.created_at),
    'closings', (select count(*) from conv),
    'revenue', (select coalesce(sum(value), 0) from conv),
    'organic', (select count(*) from public.conversations c
        where c.organization_id = v_org and (c.created_at at time zone v_tz)::date between p_from and p_to
          and not exists (select 1 from public.ad_leads l where l.conversation_id = c.id)),
    'link_clicks', (select count(*) from public.ad_clicks where organization_id = v_org and (created_at at time zone v_tz)::date between p_from and p_to
        and (p_platform is null or platform = p_platform)),
    'events_sent', (select count(*) from public.capi_events where organization_id = v_org and status = 'sent' and (created_at at time zone v_tz)::date between p_from and p_to
        and (p_platform is null or platform = p_platform)),
    'events_failed', (select count(*) from public.capi_events where organization_id = v_org and status = 'failed' and (created_at at time zone v_tz)::date between p_from and p_to
        and (p_platform is null or platform = p_platform)),
    'platforms', (select coalesce(jsonb_agg(jsonb_build_object(
        'platform', pf.p,
        'spend', (select coalesce(sum(spend), 0) from spend where platform = pf.p),
        'leads', (select count(*) from leads where platform = pf.p),
        'closings', (select count(*) from conv where conv.pf = pf.p),
        'revenue', (select coalesce(sum(value), 0) from conv where conv.pf = pf.p)
      ) order by pf.p), '[]') from (values ('meta'), ('google'), ('tiktok'), ('other')) pf (p)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day,
        'spend', (select coalesce(sum(spend), 0) from spend where date = d.day),
        'revenue', (select coalesce(sum(value), 0) from conv where (occurred_at at time zone v_tz)::date = d.day),
        'leads', (select count(*) from leads where (created_at at time zone v_tz)::date = d.day)
      ) order by d.day), '[]') from days d)
  ) into v;
  return v;
end;
$$;
revoke execute on function public.ads_summary(date, date, text) from public, anon;
grant execute on function public.ads_summary(date, date, text) to authenticated;

-- Spend of one platform fills names of that platform's leads.
create or replace function public.ad_backfill_names(p_org uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  with named as (
    update public.ad_leads l
    set campaign_id = coalesce(l.campaign_id, s.campaign_id),
        campaign_name = coalesce(l.campaign_name, s.campaign_name),
        adset_id = coalesce(l.adset_id, s.adset_id),
        adset_name = coalesce(l.adset_name, s.adset_name),
        ad_name = coalesce(l.ad_name, s.ad_name)
    from (
      select distinct on (platform, ad_id) platform, ad_id, campaign_id, campaign_name, adset_id, adset_name, ad_name
      from public.ad_spend where organization_id = p_org and ad_id is not null
      order by platform, ad_id, date desc
    ) s
    where l.organization_id = p_org and l.ad_id = s.ad_id and l.platform = s.platform
      and (l.campaign_name is null or l.ad_name is null or l.adset_name is null)
    returning 1
  )
  select count(*)::integer from named
$$;
revoke execute on function public.ad_backfill_names(uuid) from public, anon, authenticated;

-- Link statistics by the organization's calendar days (replaces 20261107,
-- which counted UTC days).
create or replace function public.wa_link_stats(p_from date, p_to date)
returns table (link_id uuid, clicks bigint, chats bigint, closings bigint, revenue numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.ads_check_access();
  v_tz text;
begin
  select coalesce(timezone, 'Asia/Jakarta') into v_tz from public.organizations where id = v_org;
  return query
  select k.link_id, count(distinct k.id), count(distinct l.id), count(distinct c.id), coalesce(sum(c.value), 0)
  from public.ad_clicks k
  left join public.ad_leads l on l.click_id = k.id
  left join public.ad_conversions c on c.lead_id = l.id and c.cancelled_at is null
  where k.organization_id = v_org and k.link_id is not null
    and k.created_at >= p_from::timestamp at time zone v_tz and k.created_at < (p_to + 1)::timestamp at time zone v_tz
  group by k.link_id;
end;
$$;

-- Rotator: clicks, chats and closings per number and agent of one link.
create or replace function public.wa_link_rotation_stats(p_link uuid, p_from date, p_to date)
returns table (channel_id uuid, agent_id uuid, clicks bigint, chats bigint, closings bigint, revenue numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.ads_check_access();
  v_tz text;
begin
  select coalesce(timezone, 'Asia/Jakarta') into v_tz from public.organizations where id = v_org;
  return query
  select k.channel_id, k.agent_id, count(distinct k.id), count(distinct l.id), count(distinct c.id), coalesce(sum(c.value), 0)
  from public.ad_clicks k
  left join public.ad_leads l on l.click_id = k.id
  left join public.ad_conversions c on c.lead_id = l.id and c.cancelled_at is null
  where k.organization_id = v_org and k.link_id = p_link
    and k.created_at >= p_from::timestamp at time zone v_tz and k.created_at < (p_to + 1)::timestamp at time zone v_tz
  group by k.channel_id, k.agent_id;
end;
$$;
revoke execute on function public.wa_link_rotation_stats(uuid, date, date) from public, anon;
grant execute on function public.wa_link_rotation_stats(uuid, date, date) to authenticated;
