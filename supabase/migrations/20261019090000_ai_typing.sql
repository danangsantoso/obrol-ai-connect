-- "Sedang mengetik..." before an AI reply: the customer sees the typing
-- indicator of their app for a time that fits the length of the answer.
alter table public.ai_settings add column simulate_typing boolean not null default true;
-- Until when someone is typing in this chat (website widget and the inbox show it).
alter table public.conversations add column typing_until timestamptz;
