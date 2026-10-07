-- Security fix: can_access_conversation returned NULL (not false) for an
-- agent looking at a chat assigned to someone else with no reply deadline
-- ("rotation_deadline < now()" is NULL). Row-level security treats NULL as
-- "no", but functions that check "if not can_access_conversation(...)" let the
-- call through, so an agent could e.g. change the status, labels or assignment
-- of a colleague's chat. The function now always answers true or false.
create or replace function public.can_access_conversation(conv_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  conv record;
  me record;
begin
  select organization_id, team_id, assignee_id, rotation_deadline into conv
  from public.conversations where id = conv_id;
  if not found then
    return false;
  end if;

  select p.id, p.organization_id, p.role into me
  from public.profiles p
  join public.organizations o on o.id = p.organization_id and o.is_active
  where p.id = auth.uid() and p.is_active;
  if not found or me.organization_id is distinct from conv.organization_id then
    return false;
  end if;

  if me.role = 'admin' then
    return true;
  end if;

  if conv.assignee_id = me.id then
    return true;
  end if;

  if exists (
    select 1 from public.notes n
    where n.conversation_id = conv_id and me.id = any (n.mentions)
  ) then
    return true;
  end if;

  if me.role = 'supervisor' then
    return coalesce(
      conv.team_id is null
      or conv.team_id in (select public.current_team_ids())
      or conv.assignee_id in (
        select tm.profile_id from public.team_members tm
        where tm.team_id in (select public.current_team_ids())
      ),
      false
    );
  end if;

  return coalesce(
    (conv.assignee_id is null or conv.rotation_deadline < now())
      and (conv.team_id is null or conv.team_id in (select public.current_team_ids())),
    false
  );
end;
$$;
