-- Members created with the default password (12345678) or whose password an
-- admin reset must choose their own password at their next sign-in.

alter table public.profiles add column must_change_password boolean not null default false;

-- Same guard as before, with must_change_password protected too: it is set
-- by admins (through the member-password function) and cleared only by the
-- function that actually changes the password.
create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is not distinct from old.organization_id
     and new.role = old.role
     and new.is_active = old.is_active
     and new.max_open_chats = old.max_open_chats
     and new.email = old.email
     and new.must_change_password = old.must_change_password then
    return new;
  end if;

  -- service role / database owner / trusted RPCs
  if auth.uid() is null or current_setting('balas.trusted', true) = 'on' then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id or new.email <> old.email then
    raise exception 'organization and email cannot be changed here' using errcode = '42501';
  end if;

  if new.id = auth.uid() then
    raise exception 'you cannot change your own role or access' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role = 'admin'
      and p.organization_id = old.organization_id
  ) then
    raise exception 'only an admin can change roles and access' using errcode = '42501';
  end if;

  return new;
end;
$$;
