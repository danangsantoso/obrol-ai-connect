-- The agents' Android app.
--  - Profile photos: a public bucket, one folder per person; only the person
--    writes their own folder. profiles.avatar_url points at the file.
--  - Native push: the app registers its Firebase Cloud Messaging token as a
--    device next to the browsers' Web Push subscriptions.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "members see profile photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');
create policy "people upload their own photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "people replace their own photo" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "people delete their own photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Only a photo from the avatars bucket of this Supabase.
alter table public.profiles
  add constraint profiles_avatar_url_check check (avatar_url is null or (char_length(avatar_url) <= 500 and avatar_url ~ '/storage/v1/object/public/avatars/'));

alter table public.push_subscriptions
  add column kind text not null default 'web' check (kind in ('web', 'fcm')),
  alter column p256dh drop not null,
  alter column auth drop not null,
  drop constraint push_subscriptions_endpoint_check,
  add constraint push_subscriptions_endpoint_check check (
    char_length(endpoint) <= 1000
    and (kind = 'fcm' or (endpoint ~ '^https?://' and p256dh is not null and auth is not null))
  );

-- The app's FCM token for the signed-in person. A phone that someone else
-- used before moves to the new person.
create or replace function public.register_push_device(p_token text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) not between 20 and 1000 or p_token !~ '^[A-Za-z0-9_:.-]+$' then
    raise exception 'invalid device token' using errcode = '22023';
  end if;
  delete from public.push_subscriptions where endpoint = p_token and user_id <> auth.uid();
  insert into public.push_subscriptions (user_id, endpoint, kind, user_agent)
  values (auth.uid(), p_token, 'fcm', left(p_user_agent, 300))
  on conflict (endpoint) do update set user_agent = excluded.user_agent;
end;
$$;
revoke execute on function public.register_push_device(text, text) from public, anon;
grant execute on function public.register_push_device(text, text) to authenticated;
