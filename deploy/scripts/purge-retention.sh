#!/usr/bin/env bash
# Daily retention job: calls the purge-retention Edge Function, which deletes
# messages (and their media) older than each organization's retention period.
# Installed as a cron job by setup-vps.sh (/etc/cron.d/balas).
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
key="$(env_get SERVICE_ROLE_KEY)"
port="$(env_get API_GW_HTTP_PORT)"

printf '[%s] ' "$(date -Is)"
curl -fsS -X POST \
  -H "Authorization: Bearer $key" -H "apikey: $key" -H "Content-Type: application/json" \
  -d '{}' "http://127.0.0.1:${port:-8000}/functions/v1/purge-retention"
echo

# AI activity log (holds reply text) follows the same retention as messages.
printf '[%s] AI log: ' "$(date -Is)"
psql_db -tAc "with gone as (delete from public.ai_runs r using public.organizations o
  where r.organization_id = o.id and r.created_at < now() - make_interval(days => o.retention_days) returning 1)
  select count(*) || ' catatan AI lama dihapus' from gone"

# The QR gateway keeps its own copy of recent messages (media download, retries).
# Balas.id holds the chat history, so the gateway only needs a short window.
GATEWAY_KEEP_DAYS="${GATEWAY_KEEP_DAYS:-30}"
if [[ -n "$(psql_db -tAc "select 1 from pg_database where datname = 'evolution'")" ]]; then
  printf '[%s] QR gateway: ' "$(date -Is)"
  compose exec -T db psql -U postgres -d evolution -v ON_ERROR_STOP=1 -tAc \
    "with gone as (delete from \"Message\" where \"messageTimestamp\" < extract(epoch from now() - interval '$GATEWAY_KEEP_DAYS days') returning 1)
     select count(*) || ' pesan lama dihapus' from gone"
fi

# Application errors that stopped happening are kept for 30 days.
printf '[%s] app errors: ' "$(date -Is)"
psql_db -tAc "with gone as (delete from public.app_errors where last_seen < now() - interval '30 days' returning 1)
  select count(*) || ' catatan error lama dihapus' from gone"

# Activity log: one year.
printf '[%s] activity log: ' "$(date -Is)"
psql_db -tAc "with gone as (delete from public.audit_log where created_at < now() - interval '365 days' returning 1)
  select count(*) || ' catatan aktivitas lama dihapus' from gone"
