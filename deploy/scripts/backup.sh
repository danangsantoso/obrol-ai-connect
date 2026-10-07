#!/usr/bin/env bash
# Daily Balas.id backup: database dump + storage files, kept for 30 days.
# Copy the result off the VPS (BACKUP_REMOTE, an rclone remote) so a lost server is not a lost business.
# Installed as a cron job by setup-vps.sh (/etc/cron.d/balas).
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/balas}"
KEEP_DAYS="${KEEP_DAYS:-30}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}" # e.g. "b2:balas-backups" (rclone), empty = local only

stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[$(date -Is)] dumping database"
compose exec -T db pg_dump -U supabase_admin -d postgres --format=custom --no-owner \
  >"$BACKUP_DIR/db-$stamp.dump"

# QR-linked WhatsApp sessions (Evolution API); without it numbers must be scanned again after a restore.
if [[ -n "$(compose exec -T db psql -U supabase_admin -d postgres -tAc "select 1 from pg_database where datname = 'evolution'")" ]]; then
  echo "[$(date -Is)] dumping QR gateway sessions"
  compose exec -T db pg_dump -U supabase_admin -d evolution --format=custom --no-owner \
    >"$BACKUP_DIR/evolution-$stamp.dump"
fi

echo "[$(date -Is)] archiving storage files"
tar -C "$SUPABASE_DIR/volumes" -czf "$BACKUP_DIR/storage-$stamp.tar.gz" storage

find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete

if [[ -n "$BACKUP_REMOTE" ]]; then
  echo "[$(date -Is)] uploading to $BACKUP_REMOTE"
  rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE" --max-age 2d
fi

echo "[$(date -Is)] backup done: $BACKUP_DIR/*-$stamp*"
