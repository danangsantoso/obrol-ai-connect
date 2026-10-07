#!/usr/bin/env bash
# Creates one starter account per role, all with the default password 12345678:
#   admin@balas.id (Admin), supervisor@balas.id (Supervisor), agen@balas.id (Agen)
# Each must choose a new password at the first sign-in. Accounts that already
# exist are left as they are. Run on the VPS from the repo checkout:
#   sudo ./deploy/scripts/create-default-users.sh ["Nama Organisasi"]
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$APP_DIR/deploy/scripts/lib.sh"

ORG_NAME="${1:-Balas.id}"
DOMAIN="${BALAS_USER_DOMAIN:-balas.id}"
PASSWORD="12345678"
API="${API_URL:-http://127.0.0.1:8000}"
SERVICE_KEY="$(env_get SERVICE_ROLE_KEY)"
[[ -n "$SERVICE_KEY" ]] || die "SERVICE_ROLE_KEY tidak ditemukan di $SUPABASE_DIR/.env"

sql_quote() { printf "'%s'" "${1//\'/\'\'}"; }

log "Organisasi: $ORG_NAME"
org_id="$(psql_db -tAc "select id from public.organizations where name = $(sql_quote "$ORG_NAME") order by created_at limit 1")"
if [[ -z "$org_id" ]]; then
  org_id="$(psql_db -tAc "insert into public.organizations (name) values ($(sql_quote "$ORG_NAME")) returning id" | head -n1)"
  echo "dibuat ($org_id)"
else
  echo "sudah ada ($org_id)"
fi

for entry in "admin:admin:Admin" "supervisor:supervisor:Supervisor" "agen:agent:Agen"; do
  IFS=: read -r name role label <<<"$entry"
  email="$name@$DOMAIN"
  if [[ -n "$(psql_db -tAc "select 1 from auth.users where lower(email) = lower($(sql_quote "$email"))")" ]]; then
    echo "$email sudah ada, dilewati"
    continue
  fi
  status="$(curl -sS -o /tmp/balas-user.json -w '%{http_code}' -X POST "$API/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"$label\"}}")"
  [[ "$status" == 200 ]] || die "gagal membuat $email (HTTP $status): $(cat /tmp/balas-user.json)"
  psql_db -q -c "update public.profiles
    set organization_id = '$org_id', role = '$role', must_change_password = true
    where lower(email) = lower($(sql_quote "$email"))"
  echo "$email dibuat sebagai $label"
done
rm -f /tmp/balas-user.json

log "Selesai"
cat <<EOF
Login di aplikasi dengan:
  admin@$DOMAIN       / $PASSWORD   (Admin)
  supervisor@$DOMAIN  / $PASSWORD   (Supervisor)
  agen@$DOMAIN        / $PASSWORD   (Agen)
Setiap akun wajib mengganti password saat login pertama.
Segera login dengan ketiganya dan ganti passwordnya: siapa pun yang tahu
password bawaan bisa masuk sebelum password diganti.
EOF
