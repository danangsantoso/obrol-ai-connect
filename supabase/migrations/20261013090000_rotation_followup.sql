-- Automatic rotation of new chats between agents, takeover of chats the
-- assigned agent leaves unanswered, and the follow-up alert for supervisors.
--
-- Rotation (organizations.auto_rotate): a customer message in a chat with no
-- agent (and no AI handling it) assigns the chat to the next agent in turn:
-- online before away before offline, least recently rotated first, skipping
-- agents at their open-chat limit. If that agent has not replied within
-- rotate_timeout_minutes, the chat shows in the other agents' queue and any of
-- them can take it; whoever takes it becomes the only agent who sees it.

alter table public.organizations
  add column auto_rotate boolean not null default false,
  add column rotate_timeout_minutes integer not null default 3
    check (rotate_timeout_minutes between 1 and 120),
  add column followup_alert_days integer not null default 7
    check (followup_alert_days between 1 and 90);

alter table public.profiles add column last_rotated_at timestamptz;

alter table public.conversations
  add column rotated_at timestamptz,
  -- Set while a rotated chat waits for its agent's first reply; once passed,
  -- other agents may take the chat. Cleared by any reply or reassignment.
  add column rotation_deadline timestamptz;
create index conversations_rotation_deadline_idx on public.conversations (rotation_deadline)
  where rotation_deadline is not null;
create index conversations_followup_idx on public.conversations (organization_id, last_message_at)
  where status <> 'resolved';

-- Next agent in turn for a chat, or null when nobody can take it.
create or replace function public.next_rotation_agent(p_org uuid, p_team uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.organization_id = p_org
    and p.is_active
    and p.role = 'agent'
    and (p_team is null or exists (
      select 1 from public.team_members tm where tm.team_id = p_team and tm.profile_id = p.id
    ))
    and (
      select count(*) from public.conversations c
      where c.assignee_id = p.id and c.status <> 'resolved'
    ) < p.max_open_chats
  order by case p.status when 'online' then 0 when 'away' then 1 else 2 end,
           p.last_rotated_at nulls first,
           p.created_at
  limit 1
$$;

revoke execute on function public.next_rotation_agent(uuid, uuid) from public, anon, authenticated;

create or replace function public.rotate_conversation_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_ai boolean;
  v_agent uuid;
  v_new_customer_message boolean;
  v_handed_off boolean;
begin
  -- A reply or a manual (re)assignment ends the waiting period.
  if tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id then
    new.rotation_deadline := null;
  end if;

  if new.assignee_id is not null or new.status = 'resolved' then
    return new;
  end if;

  v_new_customer_message := new.last_customer_message_at is not null and (
    tg_op = 'INSERT' or new.last_customer_message_at is distinct from old.last_customer_message_at
  );
  v_handed_off := tg_op = 'UPDATE' and old.ai_active and not new.ai_active;
  if not (v_new_customer_message or v_handed_off) then
    return new;
  end if;

  select * into v_org from public.organizations where id = new.organization_id;
  if not v_org.auto_rotate then
    return new;
  end if;

  -- While the AI agent answers this chat, it stays unassigned; rotation
  -- happens when the AI hands it over.
  select coalesce(s.enabled, false) and ch.ai_enabled and new.ai_active into v_ai
  from public.channels ch
  left join public.ai_settings s on s.organization_id = new.organization_id
  where ch.id = new.channel_id;
  if coalesce(v_ai, false) then
    return new;
  end if;

  v_agent := public.next_rotation_agent(new.organization_id, new.team_id);
  if v_agent is null then
    return new;
  end if;

  update public.profiles set last_rotated_at = clock_timestamp() where id = v_agent;
  new.assignee_id := v_agent;
  new.rotated_at := now();
  new.rotation_deadline := now() + make_interval(mins => v_org.rotate_timeout_minutes);
  return new;
end;
$$;

create trigger conversations_rotate before insert or update on public.conversations
  for each row execute function public.rotate_conversation_before();

-- Assignment history (and the assigned agent's notification) for each rotation.
create or replace function public.log_rotation_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rotated_at is not null and (tg_op = 'INSERT' or new.rotated_at is distinct from old.rotated_at) then
    insert into public.assignment_logs (
      organization_id, conversation_id, from_assignee_id, to_assignee_id,
      from_team_id, to_team_id, actor_id, note
    ) values (
      new.organization_id, new.id, null, new.assignee_id,
      new.team_id, new.team_id, null, 'Rotasi otomatis'
    );
  end if;
  return null;
end;
$$;

create trigger conversations_log_rotation after insert or update on public.conversations
  for each row execute function public.log_rotation_after();

-- Any reply in the chat (agent, AI, or the business phone) ends the waiting period.
create or replace function public.clear_rotation_on_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'outbound' then
    update public.conversations set rotation_deadline = null
    where id = new.conversation_id and rotation_deadline is not null;
  end if;
  return null;
end;
$$;

create trigger messages_clear_rotation after insert on public.messages
  for each row execute function public.clear_rotation_on_reply();

-- Same rules as before, plus: an agent also sees a rotated chat whose agent
-- missed the reply deadline (in their teams' queue), so they can take it.
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

  select id, organization_id, role into me
  from public.profiles where id = auth.uid() and is_active;
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
    return conv.team_id is null
      or conv.team_id in (select public.current_team_ids())
      or conv.assignee_id in (
        select tm.profile_id from public.team_members tm
        where tm.team_id in (select public.current_team_ids())
      );
  end if;

  return (conv.assignee_id is null or conv.rotation_deadline < now())
    and (conv.team_id is null or conv.team_id in (select public.current_team_ids()));
end;
$$;

-- Take a chat from the queue, or a rotated chat whose agent missed the reply
-- deadline. Atomic: fails if someone else took it first.
create or replace function public.claim_conversation(conv_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous uuid;
  result public.conversations;
begin
  if not public.can_access_conversation(conv_id) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;

  select assignee_id into previous from public.conversations where id = conv_id for update;

  update public.conversations
  set assignee_id = auth.uid(),
      rotation_deadline = null,
      status = case when status = 'resolved' then 'open'::public.conversation_status else status end
  where id = conv_id
    and (assignee_id is null or (rotation_deadline < now() and assignee_id <> auth.uid()))
  returning * into result;

  if result.id is null then
    raise exception 'conversation is already handled by another agent' using errcode = 'P0001';
  end if;

  insert into public.assignment_logs (
    organization_id, conversation_id, from_assignee_id, to_assignee_id, to_team_id, from_team_id, actor_id, note
  ) values (
    result.organization_id, conv_id, previous, auth.uid(), result.team_id, result.team_id, auth.uid(),
    case when previous is null then 'claimed' else 'Diambil alih: belum dibalas agen sebelumnya' end
  );

  return result;
end;
$$;
