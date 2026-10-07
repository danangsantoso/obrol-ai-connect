-- AI waits for people first, then takes over and stays until an agent takes the chat.
--  * ai_settings.agent_wait_minutes (default 3; 0 = answer at once): a customer
--    message nobody has answered for that long is taken over by the AI, also
--    when a rotated agent did not reply.
--  * conversations.ai_engaged: the AI has taken over this chat and answers every
--    new message (after reply_delay_seconds) until an agent takes the chat.
--  * When the AI hands over (does not know the answer, reply limit, error) it no
--    longer switches itself off: the chat goes back to people and, if nobody
--    answers within agent_wait_minutes, the AI serves again. Agents can still
--    switch the AI off for one chat (ai_active).

alter table public.ai_settings
  add column agent_wait_minutes integer not null default 3 check (agent_wait_minutes between 0 and 120);

alter table public.conversations
  add column ai_engaged boolean not null default false,
  -- When the waiting AI turn is due (lets the minute sweep skip chats still waiting).
  add column ai_due_at timestamptz;

-- Chats the AI was already answering keep going; chats the AI had handed over
-- get the AI back (it waits for people first).
update public.conversations
set ai_engaged = true
where ai_active and assignee_id is null and ai_last_reply_at is not null and ai_handoff_at is null
  and status <> 'resolved';
update public.conversations set ai_active = true where not ai_active and ai_handoff_at is not null;

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
  -- Back to people: the AI handed over, or was switched off for this chat.
  v_handed_off := tg_op = 'UPDATE' and (
    (old.ai_active and not new.ai_active) or (old.ai_engaged and not new.ai_engaged)
  );
  if not (v_new_customer_message or v_handed_off) then
    return new;
  end if;

  select * into v_org from public.organizations where id = new.organization_id;
  if not v_org.auto_rotate then
    return new;
  end if;

  -- While the AI agent answers this chat it stays unassigned. When the AI
  -- waits for people first (agent_wait_minutes > 0), the chat is rotated to an
  -- agent and the AI only steps in if that agent does not answer in time.
  select coalesce(s.enabled, false) and ch.ai_enabled and new.ai_active
         and (new.ai_engaged or coalesce(s.agent_wait_minutes, 0) = 0) into v_ai
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

-- Takes the AI turn of a chat if it is due.
-- outcome: 'claimed' (message_id set), 'wait' (retry after wait_ms), 'skip'.
create or replace function public.claim_ai_turn(p_conversation_id uuid)
returns table (outcome text, message_id uuid, wait_ms integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations;
  s public.ai_settings;
  ch public.channels;
  due timestamptz;
  since timestamptz;
  has_settings boolean;
  held_by_agent boolean;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.ai_pending_message_id is null then
    return query select 'skip'::text, null::uuid, 0;
    return;
  end if;
  select * into s from public.ai_settings where organization_id = c.organization_id;
  has_settings := found;
  select * into ch from public.channels where id = c.channel_id;
  -- An agent holds the chat, except a rotated agent who has not answered yet.
  held_by_agent := c.assignee_id is not null and c.rotation_deadline is null;
  if not has_settings or not s.enabled or not ch.ai_enabled or not ch.is_active
     or not c.ai_active or held_by_agent or c.status = 'resolved' then
    -- nothing to do until something changes; drop the mark
    update public.conversations set ai_pending_message_id = null, ai_due_at = null where id = c.id;
    return query select 'skip'::text, null::uuid, 0;
    return;
  end if;
  if c.ai_busy_until is not null and c.ai_busy_until > now() then
    return query select 'wait'::text, null::uuid,
      greatest(500, (extract(epoch from c.ai_busy_until - now()) * 1000)::integer);
    return;
  end if;

  if c.ai_engaged then
    due := c.ai_pending_at + make_interval(secs => s.reply_delay_seconds);
  else
    -- People first: the oldest customer message nobody has answered yet.
    select min(m.created_at) into since
    from public.messages m
    where m.conversation_id = c.id and m.direction = 'inbound'
      and m.created_at > coalesce((
        select max(o.created_at) from public.messages o
        where o.conversation_id = c.id and o.direction = 'outbound'
      ), '-infinity'::timestamptz);
    -- After the AI itself asked for a person, give people at least 3 minutes.
    due := greatest(
      coalesce(since, c.ai_pending_at) + make_interval(mins => case
        when c.ai_handoff_at is not null then greatest(s.agent_wait_minutes, 3)
        else s.agent_wait_minutes end),
      c.ai_pending_at + make_interval(secs => s.reply_delay_seconds)
    );
  end if;
  if due > now() then
    update public.conversations set ai_due_at = due where id = c.id and ai_due_at is distinct from due;
    return query select 'wait'::text, null::uuid, (extract(epoch from due - now()) * 1000)::integer + 100;
    return;
  end if;

  if not c.ai_engaged and c.assignee_id is not null then
    insert into public.assignment_logs (
      organization_id, conversation_id, from_assignee_id, to_assignee_id, from_team_id, to_team_id, actor_id, note
    ) values (
      c.organization_id, c.id, c.assignee_id, null, c.team_id, c.team_id, null,
      'Diambil alih AI: belum dibalas agen dalam ' || s.agent_wait_minutes || ' menit'
    );
  end if;
  update public.conversations
  set ai_pending_message_id = null,
      ai_due_at = null,
      ai_busy_until = now() + interval '2 minutes',
      ai_engaged = true,
      ai_handoff_at = null,
      ai_handoff_reason = null,
      assignee_id = null,
      rotation_deadline = null
  where id = c.id;
  return query select 'claimed'::text, c.ai_pending_message_id, 0;
end;
$$;

-- Closes an AI turn. 'handoff' gives the chat back to people (with an internal
-- note) without switching the AI off; it serves again if nobody answers.
create or replace function public.finish_ai_turn(p_conversation_id uuid, p_outcome text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations;
begin
  update public.conversations
  set ai_busy_until = null,
      ai_reply_count = case when p_outcome = 'handoff' then 0
                            else ai_reply_count + case when p_outcome = 'replied' then 1 else 0 end end,
      ai_last_reply_at = case when p_outcome = 'replied' then now() else ai_last_reply_at end,
      ai_engaged = case when p_outcome = 'handoff' then false else ai_engaged end,
      ai_handoff_at = case when p_outcome = 'handoff' then now() else ai_handoff_at end,
      ai_handoff_reason = case when p_outcome = 'handoff' then left(p_reason, 500) else ai_handoff_reason end
  where id = p_conversation_id
  returning * into c;
  if p_outcome = 'handoff' and c.id is not null then
    insert into public.notes (organization_id, conversation_id, author_id, body)
    values (c.organization_id, c.id, null,
            left('AI menyerahkan chat ini ke agen' || coalesce(': ' || nullif(p_reason, ''), '.'), 5000));
  end if;
end;
$$;

-- An agent taking the chat ends the AI's turn; giving it back re-engages it.
create or replace function public.ai_follow_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id and new.rotated_at is not distinct from old.rotated_at then
    new.ai_engaged := false;
  end if;
  return new;
end;
$$;
create trigger conversations_ai_follow_assignment before update of assignee_id on public.conversations
  for each row execute function public.ai_follow_assignment();

create or replace function public.hand_to_ai(conv_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.conversations;
  result public.conversations;
begin
  if not public.can_access_conversation(conv_id) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;
  select * into conv from public.conversations where id = conv_id for update;

  update public.conversations
  set assignee_id = null,
      rotation_deadline = null,
      ai_active = true,
      ai_engaged = true,
      ai_reply_count = 0,
      ai_handoff_at = null,
      ai_handoff_reason = null
  where id = conv_id
  returning * into result;

  if conv.assignee_id is not null then
    insert into public.assignment_logs (
      organization_id, conversation_id, from_assignee_id, to_assignee_id, from_team_id, to_team_id, actor_id, note
    ) values (
      conv.organization_id, conv_id, conv.assignee_id, null, conv.team_id, conv.team_id, auth.uid(), 'Diserahkan ke AI'
    );
  end if;
  return result;
end;
$$;

-- A resolved chat starts a new round: people first, then the AI.
create or replace function public.reset_ai_on_resolve()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.ai_active := true;
    new.ai_engaged := false;
    new.ai_reply_count := 0;
    new.ai_handoff_at := null;
    new.ai_handoff_reason := null;
    if exists (
      select 1
      from public.ai_settings s
      join public.channels ch on ch.id = new.channel_id and ch.ai_enabled
      where s.organization_id = new.organization_id and s.enabled and s.reclaim_on_resolve
    ) then
      new.assignee_id := null;
      new.rotation_deadline := null;
    end if;
  end if;
  return new;
end;
$$;
