-- The AI's "soul" (like a soul.md): its character, way of talking and sales
-- approach, written or uploaded by the admin. Empty = the built-in sales persona.
alter table public.ai_settings
  add column persona text not null default '' check (char_length(persona) <= 8000);

-- Closing a sale takes more than 10 messages.
alter table public.ai_settings alter column max_auto_replies set default 30;
update public.ai_settings set max_auto_replies = 30 where max_auto_replies = 10;
