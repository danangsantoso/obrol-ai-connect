-- Meta ad tracking: which chats came from which ad, which of them closed and
-- for how much, the ad spend, and CPL / ROAS from those.
--
-- A lead is the first chat of a customer that came from an ad, either
--  * straight from a click-to-WhatsApp/Messenger ad (the platform sends the ad
--    with the first message: metadata.referral), or
--  * through a landing page: the WhatsApp button there points to a Balas.id
--    link (wa_links) that records the click (ad_clicks) and opens WhatsApp
--    with a short code "(#K7P2)" at the end of the greeting.
-- A closing (ad_conversions) is a paid order or a value an agent enters. Both
-- are reported to Meta's Conversions API (capi_events, sent by the meta-ads
-- function) so Ads Manager sees leads and purchases, and Balas.id reports CPL
-- and ROAS against the spend fetched from the ad account (ad_spend).

-- ---------------------------------------------------------------------------
-- Settings (tokens live in ad_secrets, service role only)
-- ---------------------------------------------------------------------------
create table public.ad_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  pixel_id text check (pixel_id ~ '^[0-9]{6,20}$'),
  capi_token_hint text,
  test_event_code text check (char_length(test_event_code) <= 40),
  -- WhatsApp Business Account of the number the click-to-WhatsApp ads open.
  waba_id text check (waba_id ~ '^[0-9]{6,20}$'),
  ad_account_id text check (ad_account_id ~ '^act_[0-9]{5,20}$'),
  ads_token_hint text,
  send_lead boolean not null default true,
  send_purchase boolean not null default true,
  send_checkout boolean not null default false,
  attribution_days integer not null default 28 check (attribution_days between 1 and 90),
  last_spend_sync_at timestamptz,
  last_spend_error text,
  last_event_at timestamptz,
  last_event_error text,
  updated_at timestamptz not null default now()
);
alter table public.ad_settings enable row level security;
create policy "admins and supervisors read ad settings" on public.ad_settings
  for select to authenticated using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));
create policy "admins create ad settings" on public.ad_settings
  for insert to authenticated with check (organization_id = public.current_org_id() and public.current_role_name() = 'admin');
create policy "admins change ad settings" on public.ad_settings
  for update to authenticated using (organization_id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (organization_id = public.current_org_id());
-- Hints and sync state are written by the meta-ads function only.
revoke insert, update on public.ad_settings from authenticated;
grant insert (organization_id, pixel_id, test_event_code, waba_id, ad_account_id, send_lead, send_purchase, send_checkout, attribution_days, updated_at)
  on public.ad_settings to authenticated;
grant update (organization_id, pixel_id, test_event_code, waba_id, ad_account_id, send_lead, send_purchase, send_checkout, attribution_days, updated_at)
  on public.ad_settings to authenticated;

create table public.ad_secrets (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  capi_token_encrypted text,
  ads_token_encrypted text,
  updated_at timestamptz not null default now()
);
alter table public.ad_secrets enable row level security;

-- ---------------------------------------------------------------------------
-- Landing page links and their clicks
-- ---------------------------------------------------------------------------
create table public.wa_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Public: https://<api>/functions/v1/wa/<slug>
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  channel_id uuid references public.channels (id) on delete set null,
  message text not null default 'Halo kak, saya mau tanya' check (char_length(message) between 1 and 500),
  -- Reported under this campaign when the ad does not pass its own name.
  campaign_name text check (char_length(campaign_name) <= 120),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.wa_links enable row level security;
create policy "admins and supervisors manage links" on public.wa_links
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'))
  with check (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

create table public.ad_clicks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  link_id uuid references public.wa_links (id) on delete set null,
  code text not null check (code ~ '^[A-Z2-9]{4}$'),
  fbclid text,
  fbc text,
  fbp text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  utm jsonb not null default '{}',
  landing_url text,
  ip text,
  user_agent text,
  matched_conversation_id uuid references public.conversations (id) on delete set null,
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index ad_clicks_org_created_idx on public.ad_clicks (organization_id, created_at desc);
alter table public.ad_clicks enable row level security;
create policy "admins and supervisors read clicks" on public.ad_clicks
  for select to authenticated using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

-- ---------------------------------------------------------------------------
-- Leads, closings, events, spend
-- ---------------------------------------------------------------------------
create table public.ad_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null unique references public.conversations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  source text not null check (source in ('ctwa', 'link')),
  channel_provider text,
  click_id uuid references public.ad_clicks (id) on delete set null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  headline text,
  ad_body text,
  source_url text,
  media_url text,
  ctwa_clid text,
  created_at timestamptz not null default now()
);
create index ad_leads_org_created_idx on public.ad_leads (organization_id, created_at desc);
create index ad_leads_contact_idx on public.ad_leads (contact_id, created_at);
alter table public.ad_leads enable row level security;
create policy "members read leads of their chats" on public.ad_leads
  for select to authenticated using (
    organization_id = public.current_org_id()
    and (public.current_role_name() in ('admin', 'supervisor') or public.can_access_conversation(conversation_id))
  );

create table public.ad_conversions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  lead_id uuid references public.ad_leads (id) on delete set null,
  order_id uuid unique references public.orders (id) on delete cascade,
  kind text not null check (kind in ('order', 'manual')),
  value numeric(14, 2) not null check (value >= 0),
  currency text not null default 'IDR',
  note text check (char_length(note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  occurred_at timestamptz not null default now(),
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index ad_conversions_org_occurred_idx on public.ad_conversions (organization_id, occurred_at desc);
create index ad_conversions_conversation_idx on public.ad_conversions (conversation_id);
alter table public.ad_conversions enable row level security;
create policy "members read closings of their chats" on public.ad_conversions
  for select to authenticated using (
    organization_id = public.current_org_id()
    and (public.current_role_name() in ('admin', 'supervisor') or (conversation_id is not null and public.can_access_conversation(conversation_id)))
  );

create table public.capi_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_name text not null check (event_name in ('Lead', 'Purchase', 'InitiateCheckout')),
  -- Same id on a retry, so Meta counts the event once.
  event_id text not null unique,
  lead_id uuid references public.ad_leads (id) on delete cascade,
  conversion_id uuid references public.ad_conversions (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index capi_events_due_idx on public.capi_events (next_attempt_at) where status = 'pending';
create index capi_events_org_idx on public.capi_events (organization_id, created_at desc);
alter table public.capi_events enable row level security;
create policy "admins and supervisors read events" on public.capi_events
  for select to authenticated using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

create table public.ad_spend (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  date date not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  spend numeric(14, 2) not null default 0 check (spend >= 0),
  impressions integer not null default 0,
  clicks integer not null default 0,
  -- Entered by hand (no ad account connected): one row per campaign per day.
  manual boolean not null default false,
  ad_key text generated always as (coalesce(ad_id, 'name:' || lower(coalesce(ad_name, campaign_name, '')))) stored,
  updated_at timestamptz not null default now(),
  unique (organization_id, date, ad_key)
);
alter table public.ad_spend enable row level security;
create policy "admins and supervisors read spend" on public.ad_spend
  for select to authenticated using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));
create policy "admins enter spend by hand" on public.ad_spend
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin' and manual)
  with check (organization_id = public.current_org_id() and public.current_role_name() = 'admin' and manual and ad_id is null);

-- ---------------------------------------------------------------------------
-- Attribution
-- ---------------------------------------------------------------------------

-- The ad lead a closing in this chat belongs to: the customer's (or a merged
-- contact's) FIRST ad chat within the attribution window.
create or replace function public.ad_lead_for(p_conversation uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  join public.contacts grp on coalesce(grp.merged_into, grp.id) = coalesce(ct.merged_into, ct.id)
  join public.ad_leads l on l.contact_id = grp.id
  left join public.ad_settings s on s.organization_id = c.organization_id
  where c.id = p_conversation
    and l.created_at > now() - make_interval(days => coalesce(s.attribution_days, 28))
  order by l.created_at
  limit 1
$$;
revoke execute on function public.ad_lead_for(uuid) from public, anon, authenticated;

create or replace function public.enqueue_capi(p_org uuid, p_event text, p_event_id text, p_lead uuid, p_conversion uuid, p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ad_settings;
begin
  select * into s from public.ad_settings where organization_id = p_org;
  if s.pixel_id is null or s.capi_token_hint is null
     or (p_event = 'Lead' and not s.send_lead)
     or (p_event = 'Purchase' and not s.send_purchase)
     or (p_event = 'InitiateCheckout' and not s.send_checkout) then
    return;
  end if;
  insert into public.capi_events (organization_id, event_name, event_id, lead_id, conversion_id, order_id)
  values (p_org, p_event, p_event_id, p_lead, p_conversion, p_order)
  on conflict (event_id) do nothing;
end;
$$;
revoke execute on function public.enqueue_capi(uuid, text, text, uuid, uuid, uuid) from public, anon, authenticated;

-- Inbound messages: a referral from an ad or a landing page code makes the
-- chat an ad lead (once per customer per attribution window). The code is
-- taken out of the message so agents and the AI read the customer's words.
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
begin
  if new.direction <> 'inbound' then
    return new;
  end if;
  v_code := substring(coalesce(new.body, '') from '\(#([A-Z2-9]{4})\)\s*$');
  if v_ref is null and v_code is null then
    return new;
  end if;

  select c.organization_id, c.contact_id, ch.provider into v_conv
  from public.conversations c join public.channels ch on ch.id = c.channel_id
  where c.id = new.conversation_id;

  if v_code is not null then
    select * into v_click from public.ad_clicks
    where organization_id = v_conv.organization_id and code = v_code and created_at > now() - interval '14 days';
    if v_click.id is not null then
      new.body := nullif(btrim(regexp_replace(new.body, '\s*\(#[A-Z2-9]{4}\)\s*$', '')), '');
      new.metadata := coalesce(new.metadata, '{}') || jsonb_build_object('ad_click_code', v_code);
      update public.ad_clicks set matched_conversation_id = new.conversation_id, matched_at = now()
      where id = v_click.id and matched_at is null;
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
    insert into public.ad_leads (organization_id, conversation_id, contact_id, source, channel_provider, click_id,
      campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, source_url)
    values (v_conv.organization_id, new.conversation_id, v_conv.contact_id, 'link', v_conv.provider, v_click.id,
      v_click.campaign_id,
      coalesce(v_click.campaign_name, (select campaign_name from public.wa_links where id = v_click.link_id),
               (select name from public.wa_links where id = v_click.link_id)),
      v_click.adset_id, v_click.adset_name, v_click.ad_id, v_click.ad_name, v_click.landing_url)
    on conflict (conversation_id) do nothing
    returning id into v_lead;
  else
    -- Names of the ad, when its spend has been fetched already.
    select * into v_spend from public.ad_spend
    where organization_id = v_conv.organization_id and ad_id = v_ref ->> 'source_id'
    order by date desc limit 1;
    insert into public.ad_leads (organization_id, conversation_id, contact_id, source, channel_provider,
      campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, headline, ad_body, source_url, media_url, ctwa_clid)
    values (v_conv.organization_id, new.conversation_id, v_conv.contact_id, 'ctwa', v_conv.provider,
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
create trigger messages_ad_attribution before insert on public.messages
  for each row execute function public.ad_attribute_message();

-- Paid orders are closings; cancelled ones stop counting.
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
    insert into public.ad_conversions (organization_id, conversation_id, contact_id, lead_id, order_id, kind, value, currency, occurred_at)
    values (new.organization_id, new.conversation_id, new.contact_id, v_lead, new.id, 'order', new.total, new.currency, coalesce(new.paid_at, now()))
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
create trigger orders_ad_closing after insert or update of status on public.orders
  for each row execute function public.ad_order_closing();

-- "Tandai closing": a sale outside the order menu (transfer, COD, shop).
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
  insert into public.ad_conversions (organization_id, conversation_id, contact_id, lead_id, kind, value, note, created_by)
  values (v_conv.organization_id, p_conversation, v_conv.contact_id, v_lead, 'manual', round(p_value, 2), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  if v_lead is not null and p_send then
    perform public.enqueue_capi(v_conv.organization_id, 'Purchase', 'purchase-' || v_id, v_lead, v_id, null);
  end if;
  perform public.audit_write(v_conv.organization_id, auth.uid(), 'create', 'closing', v_id::text,
    coalesce(public.contact_label(p_conversation), 'chat') || ' · Rp' || to_char(round(p_value), 'FM999G999G999G990'), null);
  return v_id;
end;
$$;
revoke execute on function public.mark_closing(uuid, numeric, text, boolean) from public, anon;
grant execute on function public.mark_closing(uuid, numeric, text, boolean) to authenticated;

create or replace function public.cancel_closing(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ad_conversions
  set cancelled_at = now()
  where id = p_id and kind = 'manual' and cancelled_at is null and organization_id = public.current_org_id()
    and (created_by = auth.uid() or public.current_role_name() in ('admin', 'supervisor'));
  if not found then
    raise exception 'Closing tidak ditemukan' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.cancel_closing(uuid) from public, anon;
grant execute on function public.cancel_closing(uuid) to authenticated;

-- Events for the meta-ads function. "sending" for 10 minutes = the function
-- died mid-send: retried (same event_id, so Meta still counts it once).
create or replace function public.capi_claim(p_limit integer)
returns setof public.capi_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.capi_events set status = 'pending'
  where status = 'sending' and next_attempt_at < now() - interval '10 minutes';
  return query
  update public.capi_events e
  set status = 'sending', attempts = e.attempts + 1, next_attempt_at = now()
  from (
    select id from public.capi_events
    where status = 'pending' and next_attempt_at <= now()
    order by next_attempt_at limit p_limit
    for update skip locked
  ) due
  where e.id = due.id
  returning e.*;
end;
$$;
revoke execute on function public.capi_claim(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create or replace function public.ads_check_access()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_role_name() not in ('admin', 'supervisor') then
    raise exception 'Laporan iklan untuk Admin dan Supervisor' using errcode = '42501';
  end if;
  return public.current_org_id();
end;
$$;
revoke execute on function public.ads_check_access() from public, anon;

-- One row per campaign / ad set / ad: spend, leads, closings, revenue.
create or replace function public.ads_report(p_from date, p_to date, p_level text)
returns table (key text, name text, parent text, path text, spend numeric, leads bigint, closings bigint, revenue numeric)
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
    select
      case p_level
        when 'campaign' then coalesce(x.campaign_id, 'name:' || lower(coalesce(x.campaign_name, '')))
        when 'adset' then coalesce(x.adset_id, 'name:' || lower(coalesce(x.adset_name, x.campaign_name, '')))
        else coalesce(x.ad_id, 'name:' || lower(coalesce(x.ad_name, x.campaign_name, '')))
      end as k,
      max(case p_level when 'campaign' then x.campaign_name when 'adset' then coalesce(x.adset_name, x.campaign_name) else coalesce(x.ad_name, x.campaign_name) end) as n,
      max(case p_level when 'campaign' then null when 'adset' then x.campaign_name else coalesce(x.adset_name, x.campaign_name) end) as p,
      sum(x.spend) as total
    from public.ad_spend x
    where x.organization_id = v_org and x.date between p_from and p_to
    group by 1
  ),
  l as (
    select
      case p_level
        when 'campaign' then coalesce(y.campaign_id, 'name:' || lower(coalesce(y.campaign_name, '')))
        when 'adset' then coalesce(y.adset_id, 'name:' || lower(coalesce(y.adset_name, y.campaign_name, '')))
        else coalesce(y.ad_id, 'name:' || lower(coalesce(y.ad_name, y.campaign_name, '')))
      end as k,
      y.*
    from public.ad_leads y
    where y.organization_id = v_org
  ),
  ll as (
    select l.k,
      max(case p_level when 'campaign' then l.campaign_name when 'adset' then coalesce(l.adset_name, l.campaign_name) else coalesce(l.ad_name, l.headline, l.campaign_name) end) as n,
      max(case p_level when 'campaign' then null when 'adset' then l.campaign_name else coalesce(l.adset_name, l.campaign_name) end) as p,
      count(*) filter (where (l.created_at at time zone v_tz)::date between p_from and p_to) as lead_count,
      count(*) filter (where l.source = 'link') as via_link,
      count(*) as all_leads
    from l group by l.k
  ),
  cc as (
    select l.k, count(*) as n, sum(c.value) as total
    from public.ad_conversions c join l on l.id = c.lead_id
    where c.organization_id = v_org and c.cancelled_at is null
      and (c.occurred_at at time zone v_tz)::date between p_from and p_to
    group by l.k
  )
  select
    coalesce(s.k, ll.k, cc.k),
    coalesce(s.n, ll.n, 'Tanpa nama kampanye'),
    coalesce(s.p, ll.p),
    case when ll.k is null then null when ll.via_link * 2 > ll.all_leads then 'link' else 'ctwa' end,
    coalesce(s.total, 0)::numeric,
    coalesce(ll.lead_count, 0)::bigint,
    coalesce(cc.n, 0)::bigint,
    coalesce(cc.total, 0)::numeric
  from s
  full join ll on ll.k = s.k
  full join cc on cc.k = coalesce(s.k, ll.k)
  where coalesce(s.total, 0) > 0 or coalesce(ll.lead_count, 0) > 0 or coalesce(cc.n, 0) > 0
  order by coalesce(s.total, 0) desc, coalesce(ll.lead_count, 0) desc;
end;
$$;
revoke execute on function public.ads_report(date, date, text) from public, anon;
grant execute on function public.ads_report(date, date, text) to authenticated;

-- Totals, sources, funnel, per-day spend and revenue, and event delivery.
create or replace function public.ads_summary(p_from date, p_to date)
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
  ),
  conv as (
    select c.* from public.ad_conversions c
    where c.organization_id = v_org and c.cancelled_at is null and c.lead_id is not null
      and (c.occurred_at at time zone v_tz)::date between p_from and p_to
  ),
  days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  )
  select jsonb_build_object(
    'spend', (select coalesce(sum(spend), 0) from public.ad_spend where organization_id = v_org and date between p_from and p_to),
    'ad_clicks', (select coalesce(sum(clicks), 0) from public.ad_spend where organization_id = v_org and date between p_from and p_to),
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
    'link_clicks', (select count(*) from public.ad_clicks where organization_id = v_org and (created_at at time zone v_tz)::date between p_from and p_to),
    'events_sent', (select count(*) from public.capi_events where organization_id = v_org and status = 'sent' and (created_at at time zone v_tz)::date between p_from and p_to),
    'events_failed', (select count(*) from public.capi_events where organization_id = v_org and status = 'failed' and (created_at at time zone v_tz)::date between p_from and p_to),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day,
        'spend', (select coalesce(sum(spend), 0) from public.ad_spend where organization_id = v_org and date = d.day),
        'revenue', (select coalesce(sum(value), 0) from conv where (occurred_at at time zone v_tz)::date = d.day),
        'leads', (select count(*) from leads where (created_at at time zone v_tz)::date = d.day)
      ) order by d.day), '[]') from days d)
  ) into v;
  return v;
end;
$$;
revoke execute on function public.ads_summary(date, date) from public, anon;
grant execute on function public.ads_summary(date, date) to authenticated;

-- Per landing page link: clicks, chats, closings, revenue.
create or replace function public.wa_link_stats(p_from date, p_to date)
returns table (link_id uuid, clicks bigint, chats bigint, closings bigint, revenue numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select k.link_id,
    count(distinct k.id),
    count(distinct l.id),
    count(distinct c.id),
    coalesce(sum(c.value), 0)
  from public.ad_clicks k
  left join public.ad_leads l on l.click_id = k.id
  left join public.ad_conversions c on c.lead_id = l.id and c.cancelled_at is null
  where k.organization_id = public.ads_check_access()
    and k.link_id is not null
    and k.created_at >= p_from and k.created_at < p_to + 1
  group by k.link_id
$$;
revoke execute on function public.wa_link_stats(date, date) from public, anon;
grant execute on function public.wa_link_stats(date, date) to authenticated;

-- Unmatched clicks are useless after two weeks; keep the rest with their leads.
create or replace function public.purge_ad_clicks()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.ad_clicks k
    where k.created_at < now() - interval '30 days' and k.matched_at is null
      and not exists (select 1 from public.ad_leads l where l.click_id = k.id)
    returning 1
  )
  select count(*)::integer from gone
$$;
revoke execute on function public.purge_ad_clicks() from public, anon, authenticated;

-- Activity log for the settings (tokens are never logged).
create trigger audit_ad_settings after update on public.ad_settings
  for each row execute function public.audit_row('ad_settings');
create trigger audit_wa_links after insert or update or delete on public.wa_links
  for each row execute function public.audit_row('wa_link');

-- After the spend sync: leads that only knew the ad id get its names.
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
      select distinct on (ad_id) ad_id, campaign_id, campaign_name, adset_id, adset_name, ad_name
      from public.ad_spend where organization_id = p_org and ad_id is not null
      order by ad_id, date desc
    ) s
    where l.organization_id = p_org and l.ad_id = s.ad_id
      and (l.campaign_name is null or l.ad_name is null or l.adset_name is null)
    returning 1
  )
  select count(*)::integer from named
$$;
revoke execute on function public.ad_backfill_names(uuid) from public, anon, authenticated;
