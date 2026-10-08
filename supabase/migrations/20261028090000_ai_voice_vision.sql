-- The AI understands voice notes and pictures.
--  - Voice notes are transcribed with a speech-to-text API (OpenAI Whisper,
--    Groq, or any OpenAI-compatible /audio/transcriptions endpoint). The text is
--    kept on the message (metadata.transcript), so agents can read it too.
--  - Pictures from the customer are shown to models that can see images.
alter table public.ai_settings
  add column vision_enabled boolean not null default true,
  add column stt_provider text check (stt_provider in ('openai', 'groq', 'custom')),
  add column stt_model text not null default 'whisper-1' check (char_length(stt_model) between 1 and 100),
  add column stt_base_url text check (stt_base_url is null or stt_base_url ~ '^https?://'),
  add column stt_key_hint text;

alter table public.ai_secrets
  alter column api_key_encrypted drop not null,
  add column stt_api_key_encrypted text;
