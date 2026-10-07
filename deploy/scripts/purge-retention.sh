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
