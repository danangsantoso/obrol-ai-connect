-- Pipeline board: labels become ordered stages; a chat moves between stages
-- by swapping one label for another.

alter table public.labels
  add column position integer not null default 0,
  add column in_pipeline boolean not null default true;

-- Existing labels keep their alphabetical order as the initial stage order.
update public.labels l
set position = ordered.rn
from (
  select id, row_number() over (partition by organization_id order by name) as rn
  from public.labels
) ordered
where ordered.id = l.id;

create index labels_org_position_idx on public.labels (organization_id, position);

-- Moves a chat from one pipeline stage (label) to another in one step.
-- from_label null = from "no label"; to_label null = back to "no label".
create or replace function public.move_conversation_label(
  conv_id uuid,
  from_label uuid,
  to_label uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv_org uuid;
begin
  if not public.can_access_conversation(conv_id) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;

  select organization_id into conv_org from public.conversations where id = conv_id;

  if to_label is not null and not exists (
    select 1 from public.labels where id = to_label and organization_id = conv_org
  ) then
    raise exception 'label does not belong to this organization' using errcode = '22023';
  end if;

  if from_label is not null then
    delete from public.conversation_labels where conversation_id = conv_id and label_id = from_label;
  end if;

  if to_label is not null then
    insert into public.conversation_labels (conversation_id, label_id)
    values (conv_id, to_label)
    on conflict do nothing;
  end if;
end;
$$;
