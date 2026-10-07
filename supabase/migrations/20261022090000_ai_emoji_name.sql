-- Emoji in AI replies (on by default), and how the AI addresses customers by
-- name: "auto" picks Bapak/Ibu when it is clear from the chat, otherwise Kak.
alter table public.ai_settings
  add column use_emoji boolean not null default true,
  add column salutation text not null default 'auto'
    check (salutation in ('auto', 'kak', 'bapak_ibu', 'name_only'));
