#!/usr/bin/env bash
# Daily Balas.id backup: database dump, QR gateway sessions, storage files and
# server settings, kept for 30 days on the VPS. With BACKUP_REMOTE (an rclone
# remote, e.g. Google Drive via setup-backup.sh) the backup is also copied off
# the VPS, encrypted with BACKUP_PASSPHRASE, so a lost server is not a lost
# business. The result is shown in Master Admin -> Kesehatan sistem.
# Installed as a cron job by setup-vps.sh (/etc/cron.d/balas).
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/balas}"
KEEP_DAYS="${KEEP_DAYS:-30}"
BACKUP_REMOTE="${BACKUP_REMOTE:-$(env_get BACKUP_REMOTE)}" # e.g. "gdrive:" (rclone), empty = local only
[[ -z "${BACKUP_LOCAL_ONLY:-}" ]] || BACKUP_REMOTE=""
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-$(env_get BACKUP_PASSPHRASE)}"

stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

step="persiapan"
failed() {
  local msg="Backup gagal saat $step"
  echo "[$(date -Is)] $msg" >&2
  record_status backup false "$(jq -nc --arg stamp "$stamp" --arg error "$msg" '{stamp: $stamp, error: $error}')" || true
  system_alert "Backup gagal" "$msg. Lihat /var/log/balas-backup.log di server." || true
}
trap failed ERR

step="dump database"
echo "[$(date -Is)] dumping database"
compose exec -T db pg_dump -U supabase_admin -d postgres --format=custom --no-owner \
  >"$BACKUP_DIR/db-$stamp.dump"

# QR-linked WhatsApp sessions (Evolution API); without it numbers must be scanned again after a restore.
if [[ -n "$(compose exec -T db psql -U supabase_admin -d postgres -tAc "select 1 from pg_database where datname = 'evolution'")" ]]; then
  step="dump sesi nomor QR"
  echo "[$(date -Is)] dumping QR gateway sessions"
  compose exec -T db pg_dump -U supabase_admin -d evolution --format=custom --no-owner \
    >"$BACKUP_DIR/evolution-$stamp.dump"
fi

step="arsip file media"
echo "[$(date -Is)] archiving storage files"
tar -C "$SUPABASE_DIR/volumes" -czf "$BACKUP_DIR/storage-$stamp.tar.gz" storage
if [[ -d "$SUPABASE_DIR/volumes/evolution" ]]; then
  tar -C "$SUPABASE_DIR/volumes" -czf "$BACKUP_DIR/evolution-files-$stamp.tar.gz" evolution
fi

# Server settings: secrets (.env), web server and scheduled jobs. Needed to
# bring the same numbers, AI keys and integrations back on a new server.
step="arsip pengaturan server"
config_files=("$SUPABASE_DIR/.env")
for f in /etc/caddy/Caddyfile /etc/cron.d/balas; do [[ -f "$f" ]] && config_files+=("$f"); done
tar -czf "$BACKUP_DIR/config-$stamp.tar.gz" -P "${config_files[@]}"
chmod 600 "$BACKUP_DIR"/*

find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete

uploaded=false
if [[ -n "$BACKUP_REMOTE" ]]; then
  step="unggah ke ${BACKUP_REMOTE}"
  echo "[$(date -Is)] uploading to $BACKUP_REMOTE"
  remote_backups="$(backup_remote backups)"
  rclone copy "$BACKUP_DIR" "$remote_backups" --filter "- storage-*" --filter "+ *-$stamp*" --filter "- *" --retries 5 --low-level-retries 20
  # Older copies follow the same 30 days as the VPS.
  rclone delete "$remote_backups" --min-age "${KEEP_DAYS}d" --retries 3 || true
  # Media files are mirrored instead of uploaded whole every day: only new
  # files travel, and the Drive copy does not grow 30-fold.
  step="unggah file media ke ${BACKUP_REMOTE}"
  rclone sync "$SUPABASE_DIR/volumes/storage" "$(backup_remote storage)" --retries 5 --low-level-retries 20
  uploaded=true
fi

trap - ERR
size="$(du -cb "$BACKUP_DIR"/*-"$stamp"* | tail -n1 | cut -f1)"
record_status backup true "$(jq -nc --arg stamp "$stamp" --argjson size "$size" --arg remote "$BACKUP_REMOTE" \
  --argjson uploaded "$uploaded" --argjson encrypted "$([[ -n "$BACKUP_PASSPHRASE" ]] && echo true || echo false)" \
  '{stamp: $stamp, size_bytes: $size, remote: $remote, uploaded: $uploaded, encrypted: $encrypted}')"
echo "[$(date -Is)] backup done: $BACKUP_DIR/*-$stamp*"
