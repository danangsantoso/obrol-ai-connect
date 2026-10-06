#!/usr/bin/env bash
# Deploys the current checkout to the VPS: database migrations, Edge Functions, web app.
# Run on the VPS from the repo checkout (e.g. /opt/balas/app) after `git pull`.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SUPABASE_DIR="${SUPABASE_DIR:-/opt/balas/supabase/docker}"
WEB_ROOT="${WEB_ROOT:-/var/www/balas}"
FUNCTIONS=(_shared whatsapp-webhook send-message invite-member sync-templates)

cd "$APP_DIR"
set -a; source "$SUPABASE_DIR/.env"; set +a

echo "== migrations"
# Applies supabase/migrations/<version>_<name>.sql files not yet recorded in
# supabase_migrations.schema_migrations (the same table the Supabase CLI uses).
psql_db() {
  docker compose -f "$SUPABASE_DIR/docker-compose.yml" exec -T db \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
psql_db -q -c "create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"
for file in supabase/migrations/*.sql; do
  base="$(basename "$file" .sql)"
  version="${base%%_*}"
  if [[ -z "$(psql_db -tAc "select 1 from supabase_migrations.schema_migrations where version = '$version'")" ]]; then
    echo "applying $base"
    psql_db --single-transaction -q < "$file"
    psql_db -q -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '${base#*_}')"
  fi
done

echo "== edge functions"
for fn in "${FUNCTIONS[@]}"; do
  rm -rf "$SUPABASE_DIR/volumes/functions/$fn"
  cp -r "supabase/functions/$fn" "$SUPABASE_DIR/volumes/functions/$fn"
done
docker compose -f "$SUPABASE_DIR/docker-compose.yml" restart functions

echo "== web app"
npm ci --no-audit --no-fund
VITE_SUPABASE_URL="$API_EXTERNAL_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" npm run build
mkdir -p "$WEB_ROOT"
rm -rf "$WEB_ROOT/dist.new" && cp -r dist "$WEB_ROOT/dist.new"
rm -rf "$WEB_ROOT/dist.old" && { [[ -d "$WEB_ROOT/dist" ]] && mv "$WEB_ROOT/dist" "$WEB_ROOT/dist.old" || true; }
mv "$WEB_ROOT/dist.new" "$WEB_ROOT/dist"

echo "Deployed $(git rev-parse --short HEAD)"
