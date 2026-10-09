#!/usr/bin/env bash
# Every 5 minutes: checks that the server can receive and answer chats, tries
# to restart what stopped, and tells the platform owner (push to Master Admins,
# Telegram when ALERT_TELEGRAM_BOT_TOKEN/ALERT_TELEGRAM_CHAT_ID are set) when a
# problem starts and when it is over. The result is shown in Master Admin ->
# Kesehatan sistem. Installed by setup-vps.sh / deploy.sh (/etc/cron.d/balas).
set -uo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
STATE_FILE="${STATE_FILE:-/var/lib/balas/watchdog.state}"
DISK_LIMIT="${DISK_LIMIT:-90}"
mkdir -p "$(dirname "$STATE_FILE")"
port="$(env_get API_GW_HTTP_PORT)"

problems=()
# Services that must run for chats to come in and be answered.
required=(db api-gw auth rest realtime storage functions evolution)
check_services() {
  local running svc missing=()
  running="$(compose ps --status running --services 2>/dev/null)"
  for svc in "${required[@]}"; do
    grep -qx "$svc" <<<"$running" || missing+=("$svc")
  done
  printf '%s\n' "${missing[@]}"
}
mapfile -t down < <(check_services | sed '/^$/d')
if ((${#down[@]})); then
  echo "[$(date -Is)] restarting: ${down[*]}"
  compose up -d >/dev/null 2>&1
  sleep 20
  mapfile -t down < <(check_services | sed '/^$/d')
  ((${#down[@]})) && problems+=("Layanan mati: ${down[*]}")
fi

# The whole path a webhook takes: gateway -> functions -> database.
health() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:${port:-8000}/functions/v1/health"; }
code="$(health)"
# One retry: the functions runtime answers 503 for a moment while it restarts.
[[ "$code" == 200 ]] || { sleep 15; code="$(health)"; }
[[ "$code" == 200 ]] || problems+=("API tidak sehat (health: ${code:-tidak menjawab})")

used="$(df -P / | awk 'NR == 2 { gsub("%", "", $5); print $5 }')"
((used < DISK_LIMIT)) || problems+=("Disk hampir penuh: ${used}% terpakai")

# A daily backup that silently stopped is only noticed when it is needed.
backup_age="$(psql_db -tAc "select extract(epoch from now() - checked_at)::int from public.system_status where key = 'backup' and ok" 2>/dev/null | tr -d '[:space:]')"
backup_failed="$(psql_db -tAc "select 1 from public.system_status where key = 'backup' and not ok" 2>/dev/null | tr -d '[:space:]')"
if [[ -n "$backup_age" && "$backup_age" -gt 129600 ]]; then
  problems+=("Backup terakhir lebih dari $((backup_age / 3600)) jam lalu")
elif [[ "$backup_failed" == 1 ]]; then
  problems+=("Backup terakhir gagal")
fi

now_state="$(printf '%s\n' "${problems[@]}" | sed '/^$/d' | sort)"
prev_state="$(cat "$STATE_FILE" 2>/dev/null || true)"
printf '%s' "$now_state" >"$STATE_FILE"

detail="$(jq -nc --arg disk "$used" --arg p "$now_state" '{disk_used_percent: ($disk | tonumber? // null), problems: ($p | split("\n") | map(select(. != "")))}')"
record_status watchdog "$([[ -z "$now_state" ]] && echo true || echo false)" "$detail" 2>/dev/null || true

if [[ "$now_state" != "$prev_state" ]]; then
  if [[ -n "$now_state" ]]; then
    echo "[$(date -Is)] problem: $now_state"
    system_alert "Server bermasalah" "$now_state"
  elif [[ -n "$prev_state" ]]; then
    echo "[$(date -Is)] recovered"
    system_alert "Server normal kembali" "Masalah sebelumnya sudah teratasi: $prev_state"
  fi
fi
