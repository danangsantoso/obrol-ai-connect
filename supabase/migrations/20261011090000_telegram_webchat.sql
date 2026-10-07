-- Telegram bots and the website live chat widget as channels.

alter type public.channel_provider add value if not exists 'telegram';
alter type public.channel_provider add value if not exists 'webchat';

-- Per-channel options. Live chat: title, greeting, color, allowed_origins.
alter table public.channels add column config jsonb not null default '{}'::jsonb;

-- Telegram: bot id. Live chat: the public widget key (generated).
create or replace function public.set_webchat_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.provider::text = 'webchat' and new.external_id is null then
    new.external_id := replace(gen_random_uuid()::text, '-', '');
  end if;
  return new;
end;
$$;

create trigger channels_webchat_key before insert on public.channels
  for each row execute function public.set_webchat_key();

alter table public.channels drop constraint channels_provider_fields;
alter table public.channels add constraint channels_provider_fields check (
  (provider::text = 'cloud_api' and phone_number_id is not null)
  or (provider::text = 'qr' and instance_name is not null)
  or (provider::text in ('messenger', 'instagram') and external_id is not null and page_id is not null)
  or (provider::text in ('telegram', 'webchat') and external_id is not null)
);

-- Telegram sends this back in a header with every webhook call.
alter table public.channel_secrets add column webhook_secret text;
alter table public.channel_secrets alter column access_token_encrypted drop not null;

-- Website visitors. The widget proves who it is with a random secret kept in
-- the visitor's browser; only its hash is stored. Service role only.
create table public.webchat_visitors (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  secret_hash text not null,
  page_url text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index webchat_visitors_channel_idx on public.webchat_visitors (channel_id);
alter table public.webchat_visitors enable row level security;
