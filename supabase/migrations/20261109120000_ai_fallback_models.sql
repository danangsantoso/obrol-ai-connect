-- Model AI berlapis: daftar model cadangan yang dicoba berurutan ketika
-- model utama gagal (nama model salah, kuota habis, penyedia sedang down).
-- Kunci API tidak disimpan di sini; lapis dari penyedia lain memakai kunci
-- dari env server yang ditunjuk api_key_env.
alter table public.ai_settings
  add column if not exists fallback_models jsonb not null default '[]'::jsonb;

comment on column public.ai_settings.fallback_models is
  'Model cadangan berlapis: [{"provider":"deepseek","model":"deepseek-reasoner"},{"provider":"openai","model":"gpt-4o-mini","api_key_env":"OPENAI_API_KEY"}]';
