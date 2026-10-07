-- Facebook Messenger and Instagram Direct channels, connected by an admin
-- logging in with Facebook (Meta OAuth) and picking Pages / Instagram accounts.

-- New enum values cannot be used in the transaction that adds them, so the
-- checks below compare provider as text.
alter type public.channel_provider add value if not exists 'messenger';
alter type public.channel_provider add value if not exists 'instagram';

-- Messenger: Facebook Page id. Instagram: Instagram professional account id.
alter table public.channels
  add column external_id text,
  add column external_username text,
  -- Page that carries the Instagram account (messages are sent through it).
  add column page_id text;

create unique index channels_provider_external_idx on public.channels (provider, external_id)
  where external_id is not null;

alter table public.channels drop constraint channels_provider_fields;
alter table public.channels add constraint channels_provider_fields check (
  (provider::text = 'cloud_api' and phone_number_id is not null)
  or (provider::text = 'qr' and instance_name is not null)
  or (provider::text in ('messenger', 'instagram') and external_id is not null and page_id is not null)
);

-- Page access tokens, encrypted by the Edge Functions. No client access.
create table public.channel_secrets (
  channel_id uuid primary key references public.channels (id) on delete cascade,
  access_token_encrypted text not null,
  updated_at timestamptz not null default now()
);
alter table public.channel_secrets enable row level security;

-- Short-lived state of a "Login with Facebook" round trip. Service role only.
create table public.oauth_states (
  state text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Pages found after login, with encrypted tokens; filled by the callback.
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;

-- Social profiles: @username and picture (WhatsApp contacts only have a number).
alter table public.contacts
  add column username text,
  add column avatar_url text;
