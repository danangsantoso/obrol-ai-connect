#!/usr/bin/env bash
# Deploys the current checkout to the VPS: database migrations, Edge Functions, web app.
# Run on the VPS from the repo checkout (e.g. /opt/balas/app) after `git pull`:
#   sudo ./deploy/scripts/deploy.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$APP_DIR/deploy/scripts/lib.sh"
WEB_ROOT="${WEB_ROOT:-/var/www/balas}"
FUNCTIONS=(_shared whatsapp-webhook send-message invite-member sync-templates purge-retention wa-qr wa-qr-webhook ai-reply ai-admin social-oauth meta-webhook telegram-connect telegram-webhook webchat member-password api mcp webhook-dispatch master-admin followup orders payment-webhook)

[[ -f "$SUPABASE_DIR/.env" ]] || die "Supabase belum terpasang di $SUPABASE_DIR (jalankan setup-vps.sh dulu)"
cd "$APP_DIR"

log "Layanan Docker"
# New services or settings from the repo (e.g. the QR gateway) start here.
install_balas_overlay "$APP_DIR"
compose up -d --wait --wait-timeout 600 >/dev/null || {
  compose ps
  die "Sebagian layanan gagal menyala. Lihat log: cd $SUPABASE_DIR && docker compose logs --tail 50"
}

log "Migrasi database"
# Applies supabase/migrations/<version>_<name>.sql files not yet recorded in
# supabase_migrations.schema_migrations (the same table the Supabase CLI uses).
psql_db -q -c "create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"
for file in supabase/migrations/*.sql; do
  base="$(basename "$file" .sql)"
  version="${base%%_*}"
  if [[ -z "$(psql_db -tAc "select 1 from supabase_migrations.schema_migrations where version = '$version'")" ]]; then
    echo "applying $base"
    psql_db --single-transaction -q <"$file"
    psql_db -q -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '${base#*_}')"
  fi
done

log "Edge Functions"
FUNCTIONS_DIR="${SUPABASE_DIR:?}/volumes/functions"
for fn in "${FUNCTIONS[@]}"; do
  rm -rf "${FUNCTIONS_DIR:?}/${fn:?}"
  cp -r "supabase/functions/$fn" "$FUNCTIONS_DIR/$fn"
done
compose restart functions >/dev/null

# Where the database reaches the functions (webhook delivery wake-up).
gw="$(compose exec -T functions printenv SUPABASE_URL 2>/dev/null | tr -d '\r' || true)"
if [[ -n "$gw" ]]; then
  psql_db -q -c "insert into public.app_config (key, value) values ('functions_url', '${gw%/}/functions/v1')
    on conflict (key) do update set value = excluded.value"
fi

log "Build web app"
npm ci --no-audit --no-fund --loglevel=error
VITE_SUPABASE_URL="$(env_get SUPABASE_PUBLIC_URL)" VITE_SUPABASE_ANON_KEY="$(env_get ANON_KEY)" npm run build
mkdir -p "$WEB_ROOT"
rm -rf "${WEB_ROOT:?}/dist.new" "${WEB_ROOT:?}/dist.old"
cp -r dist "$WEB_ROOT/dist.new"
if [[ -d "$WEB_ROOT/dist" ]]; then mv "$WEB_ROOT/dist" "$WEB_ROOT/dist.old"; fi
mv "$WEB_ROOT/dist.new" "$WEB_ROOT/dist"

# Jobs added after the first install (the rest of /etc/cron.d/balas may carry local edits).
if [[ -f /etc/cron.d/balas ]] && ! grep -q ai-sweep.sh /etc/cron.d/balas; then
  echo "* * * * * root $APP_DIR/deploy/scripts/ai-sweep.sh >> /var/log/balas-ai.log 2>&1" >>/etc/cron.d/balas
fi

log "Selesai deploy $(git rev-parse --short HEAD)"
