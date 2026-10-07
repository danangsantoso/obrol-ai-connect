-- Admin-defined hand-over to the team: phrases that hand the chat over at once
-- (no AI call), and extra rules telling the AI when to hand over.
alter table public.ai_settings
  add column handoff_keywords text[] not null default '{}'
    check (cardinality(handoff_keywords) <= 50),
  add column handoff_rules text not null default '' check (char_length(handoff_rules) <= 2000);
