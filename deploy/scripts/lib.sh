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
