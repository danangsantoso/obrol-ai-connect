#!/usr/bin/env bash
# Daily Balas.id backup: database dump + storage files, kept for 30 days.
# Copy the result off the VPS (BACKUP_REMOTE, an rclone remote) so a lost server is not a lost business.
#
# cron (as root):  15 2 * * * /opt/balas/app/deploy/scripts/backup.sh >> /var/log/balas-backup.log 2>&1
set -euo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/balas/supabase/docker}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/balas}"
KEEP_DAYS="${KEEP_DAYS:-30}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"   # e.g. "b2:balas-backups" (rclone), empty = local only

stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] dumping database"
docker compose -f "$SUPABASE_DIR/docker-compose.yml" exec -T db \
  pg_dump -U postgres -d postgres --format=custom --no-owner \
  | gzip > "$BACKUP_DIR/db-$stamp.dump.gz"

echo "[$(date -Is)] archiving storage files"
tar -C "$SUPABASE_DIR/volumes" -czf "$BACKUP_DIR/storage-$stamp.tar.gz" storage

find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete

if [[ -n "$BACKUP_REMOTE" ]]; then
  echo "[$(date -Is)] uploading to $BACKUP_REMOTE"
  rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE" --max-age 2d
fi

echo "[$(date -Is)] backup done: $BACKUP_DIR/*-$stamp*"
