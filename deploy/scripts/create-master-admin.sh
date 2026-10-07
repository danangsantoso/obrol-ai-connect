#!/usr/bin/env bash
# Creates a Master Admin: the platform owner who creates tenants (organizations)
# and their Superadmins from the Master Admin console. A Master Admin belongs
# to no tenant and cannot read tenants' chats. Default password 12345678, to be
# changed at the first sign-in. Run on the VPS from the repo checkout:
#   sudo ./deploy/scripts/create-master-admin.sh [email] ["Nama"]
# Own password instead (no forced change; also resets an existing account's
# password). Single quotes keep the shell from touching characters like ! $:
#   sudo MASTER_PASSWORD='rahasia' ./deploy/scripts/create-master-admin.sh master@domain.com
# Once a Master Admin exists, users can no longer create organizations themselves.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$APP_DIR/deploy/scripts/lib.sh"

EMAIL="$(printf '%s' "${1:-master@balas.id}" | tr '[:upper:]' '[:lower:]')"
NAME="${2:-Master Admin}"
PASSWORD="${MASTER_PASSWORD:-12345678}"
[[ ${#PASSWORD} -ge 8 ]] || die "Password minimal 8 karakter"
API="${API_URL:-http://127.0.0.1:8000}"
SERVICE_KEY="$(env_get SERVICE_ROLE_KEY)"
[[ -n "$SERVICE_KEY" ]] || die "SERVICE_ROLE_KEY tidak ditemukan di $SUPABASE_DIR/.env"
[[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die "Email tidak valid: $EMAIL"

sql_quote() { printf "'%s'" "${1//\'/\'\'}"; }
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

user_id="$(psql_db -tAc "select id from auth.users where lower(email) = $(sql_quote "$EMAIL")")"
if [[ -n "$user_id" ]]; then
  org="$(psql_db -tAc "select organization_id from public.profiles where id = '$user_id'")"
  [[ -z "$org" ]] || die "$EMAIL sudah menjadi anggota sebuah tenant; pakai email lain untuk Master Admin"
  echo "$EMAIL sudah ada, dijadikan Master Admin"
  if [[ -n "${MASTER_PASSWORD:-}" ]]; then
    status="$(curl -sS -o /tmp/balas-master.json -w '%{http_code}' -X PUT "$API/auth/v1/admin/users/$user_id" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
      -d "{\"password\":\"$(json_escape "$PASSWORD")\"}")"
    [[ "$status" == 200 ]] || die "gagal mengganti password (HTTP $status): $(cat /tmp/balas-master.json)"
    rm -f /tmp/balas-master.json
    psql_db -q -c "update public.profiles set must_change_password = false where id = '$user_id'"
    echo "password diganti"
  fi
else
  name_json="$(json_escape "$NAME")"
  status="$(curl -sS -o /tmp/balas-master.json -w '%{http_code}' -X POST "$API/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$(json_escape "$PASSWORD")\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"$name_json\"}}")"
  [[ "$status" == 200 ]] || die "gagal membuat $EMAIL (HTTP $status): $(cat /tmp/balas-master.json)"
  rm -f /tmp/balas-master.json
  user_id="$(psql_db -tAc "select id from auth.users where lower(email) = $(sql_quote "$EMAIL")")"
  # The default password is temporary; one chosen by the owner is not.
  [[ -n "${MASTER_PASSWORD:-}" ]] || psql_db -q -c "update public.profiles set must_change_password = true where id = '$user_id'"
  echo "$EMAIL dibuat"
fi
psql_db -q -c "insert into public.platform_admins (user_id) values ('$user_id') on conflict do nothing"

log "Selesai"
cat <<MSG
Login di aplikasi sebagai Master Admin dengan $EMAIL
$( [[ -n "${MASTER_PASSWORD:-}" ]] && echo "dan password yang Anda tentukan." || echo "dan password 12345678 (wajib diganti saat login pertama), kecuali akun ini sudah ada sebelumnya." )
Lalu buat tenant dan Superadmin-nya dari halaman Master Admin.
MSG
