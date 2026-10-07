# shellcheck shell=bash
# Shared helpers for the Balas.id VPS scripts (sourced, not executed).

SUPABASE_DIR="${SUPABASE_DIR:-/opt/balas/supabase}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mPERINGATAN: %s\033[0m\n' "$*" >&2; }
die() {
  printf '\033[1;31mGAGAL: %s\033[0m\n' "$*" >&2
  exit 1
}

# Reads one value from the Supabase .env without sourcing it (some values contain spaces).
env_get() {
  grep -E "^$1=" "$SUPABASE_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

# Sets KEY=VALUE in the Supabase .env, replacing an existing line or appending one.
env_set() {
  local key="$1" value="$2" file="$SUPABASE_DIR/.env" tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$file"; then
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$file" >"$tmp"
  else
    cat "$file" >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

# docker compose in the Supabase project dir, so COMPOSE_FILE from its .env applies.
compose() {
  (cd "$SUPABASE_DIR" && docker compose "$@")
}

psql_db() {
  compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

# Installs the Balas.id compose overlay next to the Supabase stack and fills in
# generated secrets that are still missing. Safe to run on every deploy, so
# existing servers pick up new services (e.g. the QR gateway) after git pull.
install_balas_overlay() {
  local app_dir="$1" compose_files
  cp "$app_dir/deploy/supabase/docker-compose.balas.yml" "$SUPABASE_DIR/docker-compose.balas.yml"
  compose_files="$(env_get COMPOSE_FILE)"
  compose_files="${compose_files:-docker-compose.yml}"
  [[ ":$compose_files:" == *":docker-compose.balas.yml:"* ]] || compose_files="$compose_files:docker-compose.balas.yml"
  env_set COMPOSE_FILE "$compose_files"

  [[ -n "$(env_get WHATSAPP_VERIFY_TOKEN)" ]] || env_set WHATSAPP_VERIFY_TOKEN "balas-$(openssl rand -hex 16)"
  local key
  for key in WHATSAPP_APP_SECRET WHATSAPP_ACCESS_TOKEN META_APP_ID META_APP_SECRET; do
    grep -qE "^$key=" "$SUPABASE_DIR/.env" || env_set "$key" ""
  done
  [[ -n "$(env_get WHATSAPP_GRAPH_VERSION)" ]] || env_set WHATSAPP_GRAPH_VERSION v23.0
  # QR gateway (Evolution API): API key and the token it sends with webhooks.
  [[ -n "$(env_get EVOLUTION_API_KEY)" ]] || env_set EVOLUTION_API_KEY "$(openssl rand -hex 24)"
  [[ -n "$(env_get EVOLUTION_WEBHOOK_TOKEN)" ]] || env_set EVOLUTION_WEBHOOK_TOKEN "$(openssl rand -hex 24)"
  # Encrypts AI provider API keys stored in the database. Changing it means re-entering those keys.
  [[ -n "$(env_get BALAS_SECRET_KEY)" ]] || env_set BALAS_SECRET_KEY "$(openssl rand -hex 32)"
}
