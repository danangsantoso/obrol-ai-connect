-- Orders taken in chat, payment links (bank transfer, Xendit or Midtrans) and
-- shipping rates (Biteship). An order is created by an agent from the chat or
-- by the AI once the customer has confirmed; prices always come from the
-- product catalog. Payment providers report back to the payment-webhook
-- function, which marks the order paid and tells the customer.

alter table public.products
  add column weight_grams integer not null default 1000 check (weight_grams between 1 and 100000);

create table public.payment_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  provider text not null default 'manual' check (provider in ('manual', 'xendit', 'midtrans')),
  -- [{ "bank": "BCA", "number": "1234567890", "holder": "PT Toko" }]
  bank_accounts jsonb not null default '[]'::jsonb,
  payment_note text not null default '' check (char_length(payment_note) <= 1000),
  midtrans_production boolean not null default false,
  invoice_hours integer not null default 24 check (invoice_hours between 1 and 168),
  -- Shipping
  shipping_mode text not null default 'none' check (shipping_mode in ('none', 'flat', 'biteship')),
  flat_shipping_cost numeric(14, 2) not null default 0 check (flat_shipping_cost >= 0),
  origin_postal_code text check (origin_postal_code ~ '^[0-9]{5}$'),
  couriers text not null default 'jne,sicepat,jnt,anteraja' check (couriers ~ '^[a-z0-9_,]{1,200}$'),
  -- The AI may create orders and send the payment link itself.
  ai_create_orders boolean not null default false,
  -- Hints shown in settings (the keys themselves are in payment_secrets).
  xendit_key_hint text,
  midtrans_key_hint text,
  biteship_key_hint text,
  updated_at timestamptz not null default now()
);
alter table public.payment_settings enable row level security;
create policy "members read payment settings" on public.payment_settings
  for select to authenticated using (organization_id = public.current_org_id());
create policy "admins edit payment settings" on public.payment_settings
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (organization_id = public.current_org_id() and public.current_role_name() = 'admin');
-- Key hints are written by the payments function (service role) only.
create or replace function public.payment_settings_keep_hints()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.xendit_key_hint := null;
      new.midtrans_key_hint := null;
      new.biteship_key_hint := null;
    else
      new.xendit_key_hint := old.xendit_key_hint;
      new.midtrans_key_hint := old.midtrans_key_hint;
      new.biteship_key_hint := old.biteship_key_hint;
    end if;
  end if;
  return new;
end;
$$;
create trigger payment_settings_keep_hints before insert or update on public.payment_settings
  for each row execute function public.payment_settings_keep_hints();
create trigger payment_settings_updated_at before update on public.payment_settings
  for each row execute function public.set_updated_at();

-- Provider keys, encrypted by the Edge Functions. No client access.
create table public.payment_secrets (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  xendit_secret_key text,
  xendit_callback_token text,
  midtrans_server_key text,
  biteship_api_key text,
  updated_at timestamptz not null default now()
);
alter table public.payment_secrets enable row level security;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  conversation_id uuid references public.conversations (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_ai boolean not null default false,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'paid', 'processing', 'shipped', 'completed', 'cancelled', 'expired')),
  -- [{ "product_id": uuid|null, "name": text, "qty": int, "price": number, "weight_grams": int }]
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(14, 2) not null default 0,
  shipping_cost numeric(14, 2) not null default 0,
  discount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  currency text not null default 'IDR',
  customer_name text,
  phone text,
  address text,
  city text,
  postal_code text,
  courier text,
  courier_service text,
  tracking_number text,
  notes text,
  payment_provider text not null default 'manual',
  payment_ref text,
  payment_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  shipped_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index orders_org_created_idx on public.orders (organization_id, created_at desc);
create index orders_conversation_idx on public.orders (conversation_id, created_at desc);
create index orders_contact_idx on public.orders (contact_id);
create index orders_expiry_idx on public.orders (expires_at) where status = 'awaiting_payment';
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  event text not null,
  note text,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

-- Admins and supervisors see every order; agents see orders of chats they
-- can access and the ones they created. Writes go through the orders function.
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
create policy "members read orders" on public.orders
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role_name() in ('admin', 'supervisor')
      or created_by = auth.uid()
      or (conversation_id is not null and public.can_access_conversation(conversation_id))
    )
  );
create policy "members read order events" on public.order_events
  for select to authenticated
  using (organization_id = public.current_org_id() and exists (select 1 from public.orders o where o.id = order_id));

-- INV/20261024/0001: numbered per organization per day (organization time zone).
create table public.order_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  last_number integer not null default 0,
  primary key (organization_id, day)
);
alter table public.order_counters enable row level security;

create or replace function public.next_order_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
  v_n integer;
begin
  select (now() at time zone o.timezone)::date into v_day from public.organizations o where o.id = p_org;
  insert into public.order_counters (organization_id, day, last_number) values (p_org, v_day, 1)
  on conflict (organization_id, day) do update set last_number = public.order_counters.last_number + 1
  returning last_number into v_n;
  return 'INV/' || to_char(v_day, 'YYYYMMDD') || '/' || lpad(v_n::text, 4, '0');
end;
$$;
revoke execute on function public.next_order_number(uuid) from public, anon, authenticated;

-- Order events for outgoing webhooks, and a paid order ends the chat's follow-up.
create or replace function public.order_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb;
begin
  v_data := jsonb_build_object(
    'id', new.id, 'number', new.number, 'status', new.status, 'total', new.total, 'currency', new.currency,
    'items', new.items, 'customer_name', new.customer_name, 'phone', new.phone, 'conversation_id', new.conversation_id,
    'payment_provider', new.payment_provider, 'payment_url', new.payment_url, 'paid_at', new.paid_at,
    'tracking_number', new.tracking_number, 'courier', new.courier
  );
  if tg_op = 'INSERT' then
    perform public.enqueue_webhook_event(new.organization_id, 'order.created', v_data);
  elsif new.status is distinct from old.status then
    perform public.enqueue_webhook_event(new.organization_id,
      case when new.status = 'paid' then 'order.paid' else 'order.status_changed' end, v_data);
    if new.status = 'paid' and new.conversation_id is not null then
      update public.followup_enrollments
      set status = 'stopped', stop_reason = 'Pelanggan sudah membayar', ended_at = now(), next_send_at = null
      where conversation_id = new.conversation_id and status = 'active';
    end if;
  end if;
  return null;
end;
$$;
create trigger orders_after_change after insert or update on public.orders
  for each row execute function public.order_after_change();

-- Unpaid orders past their payment deadline (called by the minute sweep).
create or replace function public.expire_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.orders set status = 'expired'
    where status = 'awaiting_payment' and expires_at < now()
    returning id, organization_id
  )
  insert into public.order_events (organization_id, order_id, event, note)
  select organization_id, id, 'expired', 'Batas waktu pembayaran lewat' from expired;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.expire_orders() from public, anon, authenticated;

alter publication supabase_realtime add table public.orders;
