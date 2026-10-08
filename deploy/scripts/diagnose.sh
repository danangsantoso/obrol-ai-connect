#!/usr/bin/env bash
# Where do incoming chats stop? Read-only overview for when messages do not
# arrive: services, numbers and their connection, the latest messages per
# number, and recent errors of the functions and the QR gateway.
#   sudo ./deploy/scripts/diagnose.sh
set -uo pipefail
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$APP_DIR/deploy/scripts/lib.sh"
cd "$APP_DIR"

log "Versi"
git log --oneline -1

log "Layanan (harus berjalan: db, api-gw, functions, evolution)"
compose ps --format '{{.Service}}\t{{.Status}}' 2>/dev/null | sort

log "Nomor & kanal"
psql_db -c "select o.name as toko, ch.name, provider, ch.is_active as aktif, ai_enabled as ai, coalesce(connection_status, '-') as status,
  to_char(connection_updated_at at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') as status_sejak, coalesce(display_phone, '') as nomor
  from public.channels ch join public.organizations o on o.id = ch.organization_id order by o.name, ch.created_at"

log "Pesan masuk terakhir per nomor"
psql_db -c "select o.name as toko, ch.name, ch.provider, count(*) filter (where m.created_at > now() - interval '24 hours') as masuk_24_jam,
  to_char(max(m.created_at) at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') as terakhir
  from public.channels ch
  join public.organizations o on o.id = ch.organization_id
  left join public.conversations c on c.channel_id = ch.id
  left join public.messages m on m.conversation_id = c.id and m.direction = 'inbound'
  where ch.is_active
  group by o.name, ch.id, ch.name, ch.provider order by o.name, ch.name"

log "Balasan AI 24 jam terakhir"
psql_db -c "select status, count(*) from public.ai_runs where created_at > now() - interval '24 hours' group by status order by 2 desc"
psql_db -c "select to_char(created_at at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') as waktu, left(error, 120) as error
  from public.ai_runs where status = 'error' order by created_at desc limit 5"

log "Error functions (60 menit terakhir)"
compose logs --since 60m functions 2>&1 | grep -iE "error|failed|ignoring|skipped|invalid signature|not configured" | tail -30

log "Gateway QR: pesan yang gagal dibuka/diabaikan (60 menit terakhir)"
compose logs --since 60m evolution 2>&1 | grep -iE "ignored|decrypt|bad mac|no session|webhook.*(error|fail)|logout|connection.*close" | tail -20

log "Selesai. Kirim seluruh hasil di atas bila butuh bantuan."
