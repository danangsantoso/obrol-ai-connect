-- Files the AI agent may send in a chat: product photos, a catalog or price
-- list (PDF). Admins and supervisors upload them with a note on when to send
-- them; the AI picks the right ones and sends them after its reply.
-- Stored in the private media bucket under <org>/ai-media/.
create table public.ai_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  -- When the AI should send it, in the admin's words.
  description text not null default '' check (char_length(description) <= 500),
  file_path text not null unique,
  file_name text not null check (char_length(file_name) <= 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 16777216),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ai_media_path_in_org check (file_path like organization_id::text || '/ai-media/%')
);
create index ai_media_org_idx on public.ai_media (organization_id) where is_active;
alter table public.ai_media enable row level security;

create policy "members read AI files" on public.ai_media
  for select to authenticated
  using (organization_id = public.current_org_id());
create policy "admins and supervisors manage AI files" on public.ai_media
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'))
  with check (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

create policy "admins and supervisors upload AI files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = 'ai-media'
    and public.current_role_name() in ('admin', 'supervisor')
  );
create policy "admins and supervisors delete AI files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = 'ai-media'
    and public.current_role_name() in ('admin', 'supervisor')
  );
