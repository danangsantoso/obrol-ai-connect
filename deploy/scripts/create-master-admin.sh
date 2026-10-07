#!/usr/bin/env bash
# Creates a Master Admin: the platform owner who creates tenants (organizations)
# and their Superadmins from the Master Admin console. A Master Admin belongs
# to no tenant and cannot read tenants' chats. Default password 12345678, to be
# changed at the first sign-in. Run on the VPS from the repo checkout:
#   sudo ./deploy/scripts/create-master-admin.sh [email] ["Nama"]
# Once a Master Admin exists, users can no longer create organizations themselves.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$APP_DIR/deploy/scripts/lib.sh"

EMAIL="$(printf '%s' "${1:-master@balas.id}" | tr '[:upper:]' '[:lower:]')"
NAME="${2:-Master Admin}"
PASSWORD="12345678"
API="${API_URL:-http://127.0.0.1:8000}"
SERVICE_KEY="$(env_get SERVICE_ROLE_KEY)"
[[ -n "$SERVICE_KEY" ]] || die "SERVICE_ROLE_KEY tidak ditemukan di $SUPABASE_DIR/.env"
[[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die "Email tidak valid: $EMAIL"

sql_quote() { printf "'%s'" "${1//\'/\'\'}"; }

user_id="$(psql_db -tAc "select id from auth.users where lower(email) = $(sql_quote "$EMAIL")")"
if [[ -n "$user_id" ]]; then
  org="$(psql_db -tAc "select organization_id from public.profiles where id = '$user_id'")"
  [[ -z "$org" ]] || die "$EMAIL sudah menjadi anggota sebuah tenant; pakai email lain untuk Master Admin"
  echo "$EMAIL sudah ada, dijadikan Master Admin"
else
  name_json="$(printf '%s' "$NAME" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  status="$(curl -sS -o /tmp/balas-master.json -w '%{http_code}' -X POST "$API/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"$name_json\"}}")"
  [[ "$status" == 200 ]] || die "gagal membuat $EMAIL (HTTP $status): $(cat /tmp/balas-master.json)"
  rm -f /tmp/balas-master.json
  user_id="$(psql_db -tAc "select id from auth.users where lower(email) = $(sql_quote "$EMAIL")")"
  psql_db -q -c "update public.profiles set must_change_password = true where id = '$user_id'"
  echo "$EMAIL dibuat"
fi
psql_db -q -c "insert into public.platform_admins (user_id) values ('$user_id') on conflict do nothing"

log "Selesai"
cat <<MSG
Login di aplikasi sebagai Master Admin:
  $EMAIL / $PASSWORD   (kecuali akun ini sudah ada sebelumnya)
Ganti password saat diminta, lalu buat tenant dan Superadmin-nya dari halaman Master Admin.
MSG
