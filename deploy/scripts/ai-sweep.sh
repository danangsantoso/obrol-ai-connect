#!/usr/bin/env bash
# Every minute: answers chats whose automatic AI reply was missed (e.g. a
# function restart while the AI was waiting), sends due follow-up messages and
# broadcasts, expires unpaid orders, sends ad events to Meta (and fetches ad
# spend hourly), and retries webhook deliveries and push
# notifications that failed. Installed by setup-vps.sh.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
key="$(env_get SERVICE_ROLE_KEY)"
port="$(env_get API_GW_HTTP_PORT)"

# Each sweep can take up to ~50 seconds, so they run side by side.
sweep() {
  curl -fsS -o /dev/null -X POST --max-time 58 \
    -H "Authorization: Bearer $key" -H "apikey: $key" -H "Content-Type: application/json" \
    -d '{"action":"sweep"}' "http://127.0.0.1:${port:-8000}/functions/v1/$1" || echo "$1 sweep failed" >&2
}

sweep ai-reply &
sweep followup &
sweep orders &
sweep broadcast &
sweep meta-ads &
curl -fsS -o /dev/null -X POST --max-time 58 -H "Content-Type: application/json" -d '{}' \
  "http://127.0.0.1:${port:-8000}/functions/v1/webhook-dispatch" || echo "webhook-dispatch failed" >&2 &
curl -fsS -o /dev/null -X POST --max-time 58 -H "Content-Type: application/json" -d '{"action":"dispatch"}' \
  "http://127.0.0.1:${port:-8000}/functions/v1/push" || echo "push dispatch failed" >&2 &
wait
