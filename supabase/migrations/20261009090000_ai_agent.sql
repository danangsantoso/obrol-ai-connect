-- AI agent: answers customers automatically (or drafts replies for agents)
-- with an LLM chosen per organization, grounded in uploaded product knowledge.

create type public.ai_provider as enum ('openai', 'anthropic', 'deepseek', 'gemini', 'custom');

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.ai_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  provider public.ai_provider not null default 'anthropic',
  model text not null default 'claude-opus-5-5' check (char_length(model) between 1 and 120),
  -- Required for 'custom' (any OpenAI-compatible API); optional override otherwise.
  base_url text check (base_url is null or base_url ~ '^https?://'),
  -- Last characters of the stored key, for display. The key itself is in ai_secrets.
  api_key_hint text,
  bot_name text not null default 'Asisten' check (char_length(bot_name) between 1 and 60),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  handoff_message text not null default 'Baik kak, saya sambungkan ke tim CS kami ya. Mohon ditunggu sebentar 🙏'
    check (char_length(handoff_message) <= 500),
  -- Waits this long after the customer's last message, so a burst of messages gets one answer.
  reply_delay_seconds integer not null default 6 check (reply_delay_seconds between 0 and 30),
  -- Consecutive AI replies in one chat before it is handed to a person.
  max_auto_replies integer not null default 10 check (max_auto_replies between 1 and 50),
  updated_at timestamptz not null default now()
);

-- API keys, encrypted by the Edge Functions (BALAS_SECRET_KEY). No client access at all.
create table public.ai_secrets (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  api_key_encrypted text not null,
  updated_at timestamptz not null default now()
);

alter table public.channels add column ai_enabled boolean not null default false;

alter table public.conversations
  add column ai_active boolean not null default true,
  add column ai_reply_count integer not null default 0,
  add column ai_last_reply_at timestamptz,
  add column ai_handoff_at timestamptz,
  add column ai_handoff_reason text,
  add column ai_pending_message_id uuid,
  add column ai_pending_at timestamptz,
  add column ai_busy_until timestamptz;
create index conversations_ai_pending_idx on public.conversations (ai_pending_at) where ai_pending_message_id is not null;

-- ---------------------------------------------------------------------------
-- Product knowledge
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  sku text check (char_length(sku) <= 80),
  price numeric(14, 2) check (price is null or price >= 0),
  currency text not null default 'IDR' check (char_length(currency) between 1 and 8),
  summary text not null default '' check (char_length(summary) <= 2000),
  -- Other names customers use for this product, comma separated.
  keywords text not null default '' check (char_length(keywords) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- null = general knowledge (company, shipping, payment, policies)
  product_id uuid references public.products (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  source text not null default 'text' check (source in ('text', 'file')),
  file_name text,
  content text not null check (char_length(content) between 1 and 300000),
  char_count integer generated always as (char_length(content)) stored,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_docs_org_idx on public.knowledge_docs (organization_id, product_id);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  doc_id uuid not null references public.knowledge_docs (id) on delete cascade,
  product_id uuid references public.products (id) on delete cascade,
  position integer not null,
  content text not null,
  -- 'simple' config: no stemming or stop words, works for Indonesian and English alike.
  fts tsvector generated always as (to_tsvector('simple', content)) stored
);
create index knowledge_chunks_fts_idx on public.knowledge_chunks using gin (fts);
create index knowledge_chunks_doc_idx on public.knowledge_chunks (doc_id, position);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  kind text not null check (kind in ('auto', 'suggest', 'test')),
  provider public.ai_provider,
  model text,
  status text not null check (status in ('replied', 'handoff', 'suggested', 'error')),
  reply text,
  reason text,
  error text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index ai_runs_org_created_idx on public.ai_runs (organization_id, created_at desc);

create trigger ai_settings_updated_at before update on public.ai_settings
  for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger knowledge_docs_updated_at before update on public.knowledge_docs
  for each row execute function public.set_updated_at();

-- Splits text into passages of at most p_max characters, on paragraph
-- boundaries where possible, then sentences, then hard cuts.
create or replace function public.chunk_text(p_text text, p_max integer default 1200)
returns setof text
language plpgsql
immutable
set search_path = ''
as $$
declare
  para text;
  piece text;
  current text := '';
begin
  for para in
    select trim(p) from regexp_split_to_table(replace(p_text, E'\r', ''), E'\n[ \t]*\n') as p
  loop
    continue when para = '';
    if char_length(para) > p_max then
      -- long paragraph: flush, then split by sentences
      if current <> '' then
        return next current;
        current := '';
      end if;
      for piece in select trim(s) from regexp_split_to_table(para, E'(?<=[.!?])\\s+') as s loop
        continue when piece = '';
        while char_length(piece) > p_max loop
          return next left(piece, p_max);
          piece := substr(piece, p_max + 1);
        end loop;
        if char_length(current) + char_length(piece) + 1 > p_max and current <> '' then
          return next current;
          current := piece;
        else
          current := trim(current || ' ' || piece);
        end if;
      end loop;
    elsif char_length(current) + char_length(para) + 2 > p_max and current <> '' then
      return next current;
      current := para;
    else
      current := case when current = '' then para else current || E'\n\n' || para end;
    end if;
  end loop;
  if current <> '' then
    return next current;
  end if;
end;
$$;

-- Keeps the searchable passages in step with the document.
create or replace function public.rebuild_knowledge_chunks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.knowledge_chunks where doc_id = new.id;
  insert into public.knowledge_chunks (organization_id, doc_id, product_id, position, content)
  select new.organization_id, new.id, new.product_id, (row_number() over ()) - 1,
         -- the title travels with every passage so it is found by title words too
         new.title || E'\n' || chunk
  from public.chunk_text(new.content) as chunk;
  return new;
end;
$$;

create trigger knowledge_docs_chunks after insert or update of content, title, product_id
  on public.knowledge_docs for each row execute function public.rebuild_knowledge_chunks();

-- Finds the passages most related to a customer's question.
create or replace function public.search_knowledge(p_org uuid, p_query text, p_limit integer default 6)
returns table (chunk_id uuid, doc_title text, product_id uuid, product_name text, content text, rank real)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q tsquery;
  words text[];
begin
  select array_agg(distinct w) into words
  from (
    -- each word, plus the word without a trailing -nya/-kah/-lah ("madunya" -> "madu")
    select unnest(array[w0, case when char_length(w0) >= 6 then regexp_replace(w0, '(nya|kah|lah)$', '') end]) as w
    from regexp_split_to_table(lower(coalesce(p_query, '')), '[^[:alnum:]]+') as w0
  ) raw
  where w is not null;
  select array_agg(distinct w) into words
  from (
    select w from unnest(words) as w
    where char_length(w) >= 3
      and w not in ('yang', 'dan', 'ini', 'itu', 'ada', 'apa', 'apakah', 'saya', 'kak', 'kakak', 'min', 'admin',
                    'mau', 'bisa', 'untuk', 'dengan', 'dari', 'ke', 'di', 'gak', 'nggak', 'tidak', 'ya', 'iya',
                    'dong', 'deh', 'sih', 'aja', 'juga', 'kalau', 'kalo', 'berapa', 'gimana', 'bagaimana',
                    'the', 'and', 'for', 'you', 'are', 'what', 'how', 'can', 'halo', 'hai', 'pagi', 'siang',
                    'sore', 'malam', 'terima', 'kasih', 'tolong', 'mohon', 'info')
    limit 24
  ) t;
  if words is null then
    return;
  end if;
  q := to_tsquery('simple', array_to_string(array(select quote_literal(w) || ':*' from unnest(words) w), ' | '));

  return query
  select r.id, r.title, r.product_id, r.name, r.content, r.score::real
  from (
    select c.id, d.title, c.product_id, p.name, c.content, c.position,
           ts_rank_cd(c.fts, q)
           -- words inside longer words: "kirim" in "pengiriman", "bayar" in "pembayaran"
           + 0.05 * (select count(*) from unnest(words) w
                     where char_length(w) >= 4 and lower(c.content) like '%' || w || '%')
           -- passages about a product the customer named rank higher
           + case when p.id is not null and exists (
               select 1 from unnest(words) w
               where lower(p.name) like '%' || w || '%' or lower(p.keywords) like '%' || w || '%'
             ) then 0.5 else 0 end as score
    from public.knowledge_chunks c
    join public.knowledge_docs d on d.id = c.doc_id
    left join public.products p on p.id = c.product_id
    where c.organization_id = p_org
      and (p.id is null or p.is_active)
      and (c.fts @@ q or exists (
        select 1 from unnest(words) w where char_length(w) >= 4 and lower(c.content) like '%' || w || '%'
      ))
  ) r
  order by r.score desc, r.position
  limit greatest(1, least(p_limit, 20));
end;
$$;

-- ---------------------------------------------------------------------------
-- Message order
-- ---------------------------------------------------------------------------

-- WhatsApp timestamps have one-second precision, so a burst of messages could
-- sort out of order (in the inbox and in what the AI reads). Live messages get
-- their exact arrival time instead; late deliveries keep WhatsApp's time.
create or replace function public.set_message_arrival_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at between now() - interval '5 minutes' and now() + interval '1 minute' then
    new.created_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create trigger messages_arrival_time before insert on public.messages
  for each row execute function public.set_message_arrival_time();

-- ---------------------------------------------------------------------------
-- Auto-reply turn handling (service role only)
-- ---------------------------------------------------------------------------

-- Every customer message marks the chat as waiting for the AI.
create or replace function public.mark_ai_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'inbound' then
    update public.conversations
    set ai_pending_message_id = new.id, ai_pending_at = now()
    where id = new.conversation_id;
  end if;
  return new;
end;
$$;

create trigger messages_ai_pending after insert on public.messages
  for each row execute function public.mark_ai_pending();

-- Takes the AI turn of a chat if it is due: AI on for the organization and the
-- number, chat unassigned and not handed off, and quiet for reply_delay_seconds.
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
  has_settings boolean;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.ai_pending_message_id is null then
    return query select 'skip'::text, null::uuid, 0;
    return;
  end if;
  select * into s from public.ai_settings where organization_id = c.organization_id;
  has_settings := found;
  select * into ch from public.channels where id = c.channel_id;
  if not has_settings or not s.enabled or not ch.ai_enabled or not ch.is_active
     or not c.ai_active or c.assignee_id is not null then
    -- nothing to do until something changes; drop the mark
    update public.conversations set ai_pending_message_id = null where id = c.id;
    return query select 'skip'::text, null::uuid, 0;
    return;
  end if;
  if c.ai_busy_until is not null and c.ai_busy_until > now() then
    return query select 'wait'::text, null::uuid,
      greatest(500, (extract(epoch from c.ai_busy_until - now()) * 1000)::integer);
    return;
  end if;
  due := c.ai_pending_at + make_interval(secs => s.reply_delay_seconds);
  if due > now() then
    return query select 'wait'::text, null::uuid, (extract(epoch from due - now()) * 1000)::integer + 100;
    return;
  end if;

  update public.conversations
  set ai_pending_message_id = null, ai_busy_until = now() + interval '2 minutes'
  where id = c.id;
  return query select 'claimed'::text, c.ai_pending_message_id, 0;
end;
$$;

-- Closes an AI turn. 'handoff' leaves the chat to people with an internal note.
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
      ai_reply_count = ai_reply_count + case when p_outcome = 'replied' then 1 else 0 end,
      ai_last_reply_at = case when p_outcome = 'replied' then now() else ai_last_reply_at end,
      ai_active = case when p_outcome = 'handoff' then false else ai_active end,
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

-- Turns the AI on or off for one chat (agents with access).
create or replace function public.set_conversation_ai(conv_id uuid, active boolean)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.conversations;
begin
  if not public.can_access_conversation(conv_id) then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  update public.conversations
  set ai_active = active,
      ai_reply_count = case when active then 0 else ai_reply_count end,
      ai_handoff_at = case when active then null else ai_handoff_at end,
      ai_handoff_reason = case when active then null else ai_handoff_reason end,
      ai_pending_message_id = case when active then ai_pending_message_id else null end
  where id = conv_id
  returning * into result;
  return result;
end;
$$;

-- A resolved chat starts fresh: the AI may answer the customer's next visit.
create or replace function public.reset_ai_on_resolve()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.ai_active := true;
    new.ai_reply_count := 0;
    new.ai_handoff_at := null;
    new.ai_handoff_reason := null;
  end if;
  return new;
end;
$$;

create trigger conversations_reset_ai before update of status on public.conversations
  for each row execute function public.reset_ai_on_resolve();

revoke execute on function public.search_knowledge(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.claim_ai_turn(uuid) from public, anon, authenticated;
revoke execute on function public.finish_ai_turn(uuid, text, text) from public, anon, authenticated;
grant execute on function public.search_knowledge(uuid, text, integer) to service_role;
grant execute on function public.claim_ai_turn(uuid) to service_role;
grant execute on function public.finish_ai_turn(uuid, text, text) to service_role;
revoke execute on function public.set_conversation_ai(uuid, boolean) from public, anon;
grant execute on function public.set_conversation_ai(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.ai_settings enable row level security;
alter table public.ai_secrets enable row level security;
alter table public.products enable row level security;
alter table public.knowledge_docs enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.ai_runs enable row level security;

create policy "members read ai settings" on public.ai_settings
  for select to authenticated using (organization_id = public.current_org_id());
create policy "admins manage ai settings" on public.ai_settings
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (organization_id = public.current_org_id() and public.current_role_name() = 'admin');

-- ai_secrets: no policies, so only the service role can read or write it.

create policy "members read products" on public.products
  for select to authenticated using (organization_id = public.current_org_id());
create policy "admins and supervisors manage products" on public.products
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'))
  with check (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));

create policy "members read knowledge" on public.knowledge_docs
  for select to authenticated using (organization_id = public.current_org_id());
create policy "admins and supervisors manage knowledge" on public.knowledge_docs
  for all to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'))
  with check (
    organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor')
    and (product_id is null or exists (
      select 1 from public.products p where p.id = product_id and p.organization_id = public.current_org_id()
    ))
  );

create policy "members read knowledge passages" on public.knowledge_chunks
  for select to authenticated using (organization_id = public.current_org_id());

create policy "admins and supervisors read ai runs" on public.ai_runs
  for select to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() in ('admin', 'supervisor'));
