#!/usr/bin/env bash
# Every minute: answers chats whose automatic AI reply was missed (e.g. a
# function restart while the AI was waiting). Installed by setup-vps.sh.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
key="$(env_get SERVICE_ROLE_KEY)"
port="$(env_get API_GW_HTTP_PORT)"

curl -fsS -o /dev/null -X POST \
  -H "Authorization: Bearer $key" -H "apikey: $key" -H "Content-Type: application/json" \
  -d '{"action":"sweep"}' "http://127.0.0.1:${port:-8000}/functions/v1/ai-reply"
