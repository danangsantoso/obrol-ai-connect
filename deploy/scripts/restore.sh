#!/usr/bin/env bash
# Restores a backup made by backup.sh, from the VPS or from Google Drive.
#   sudo ./deploy/scripts/restore.sh list                       # available backups
#   sudo ./deploy/scripts/restore.sh latest                     # newest backup on this VPS
#   sudo ./deploy/scripts/restore.sh 20261109-021500 --from-drive --with-settings
#
# --from-drive     download from BACKUP_REMOTE (needs the same Google Drive
#                  login and BACKUP_PASSPHRASE as the old server, see
#                  setup-backup.sh); use this on a new server
# --with-settings  also bring back the app secrets of the old server (AI key
#                  encryption, WhatsApp/Meta, QR gateway, Firebase), needed on
#                  a new server so saved AI keys and connected numbers work
#
# The database tables of this install are replaced by the backup: everything
# written after the backup was made is lost. The current data is backed up
# first, so a wrong restore can be undone.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$APP_DIR/deploy/scripts/lib.sh"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/balas}"
# App secrets carried over by --with-settings. Supabase's own keys (database
# password, JWT secret) stay those of this install.
SETTINGS_KEYS=(BALAS_SECRET_KEY EVOLUTION_API_KEY EVOLUTION_WEBHOOK_TOKEN FCM_SERVICE_ACCOUNT
  WHATSAPP_ACCESS_TOKEN WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN WHATSAPP_GRAPH_VERSION
  META_APP_ID META_APP_SECRET META_VERIFY_TOKEN GOOGLE_ENABLED GOOGLE_CLIENT_ID GOOGLE_SECRET
  PUSH_CONTACT_EMAIL ALERT_TELEGRAM_BOT_TOKEN ALERT_TELEGRAM_CHAT_ID)

[[ $EUID -eq 0 ]] || die "Jalankan dengan sudo"
[[ -f "$SUPABASE_DIR/.env" ]] || die "Supabase belum terpasang di $SUPABASE_DIR (jalankan setup-vps.sh dulu)"

stamps() { sed -nE 's/.*db-([0-9]{8}-[0-9]{6})\.dump.*/\1/p' | sort -u; }

if [[ "${1:-}" == list || -z "${1:-}" ]]; then
  log "Backup di VPS ($BACKUP_DIR)"
  find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump' -printf '%f\n' 2>/dev/null | stamps || true
  if [[ -n "${BACKUP_REMOTE:-$(env_get BACKUP_REMOTE)}" ]]; then
    log "Backup di ${BACKUP_REMOTE:-$(env_get BACKUP_REMOTE)}"
    rclone lsf "$(backup_remote backups)" | stamps
  fi
  echo
  echo "Pulihkan: sudo $0 <tanggal-jam> [--from-drive] [--with-settings]"
  exit 0
fi

stamp="$1"
shift
from_drive=0
with_settings=0
for arg in "$@"; do
  case "$arg" in
    --from-drive) from_drive=1 ;;
    --with-settings) with_settings=1 ;;
    *) die "Opsi tidak dikenal: $arg" ;;
  esac
done

work="$BACKUP_DIR/restore"
rm -rf "$work"
mkdir -p "$work"
chmod 700 "$work"
if [[ $from_drive == 1 ]]; then
  [[ -n "${BACKUP_REMOTE:-$(env_get BACKUP_REMOTE)}" ]] || die "Google Drive belum diatur: jalankan setup-backup.sh dulu (folder & kata sandi yang sama)"
  remote="$(backup_remote backups)"
  [[ "$stamp" != latest ]] || stamp="$(rclone lsf "$remote" | stamps | tail -n1)"
  log "Mengunduh backup $stamp dari Google Drive"
  rclone copy "$remote" "$work" --include "*-$stamp*"
  src="$work"
else
  [[ "$stamp" != latest ]] || stamp="$(find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump' -printf '%f\n' | stamps | tail -n1)"
  src="$BACKUP_DIR"
fi
[[ -n "$stamp" && -f "$src/db-$stamp.dump" ]] || die "Backup '$stamp' tidak ditemukan (lihat: sudo $0 list)"

cat <<EOF

Backup yang akan dipulihkan: $stamp$([[ $from_drive == 1 ]] && echo " (Google Drive)")
SEMUA data aplikasi di server ini (chat, kontak, akun, pengaturan) diganti
dengan isi backup tersebut. Data sekarang di-backup dulu.
EOF
read -rp "Ketik PULIHKAN untuk lanjut: " answer
[[ "$answer" == PULIHKAN ]] || die "Dibatalkan"

log "Backup data sekarang (untuk jaga-jaga)"
BACKUP_LOCAL_ONLY=1 "$APP_DIR/deploy/scripts/backup.sh" >/dev/null

log "Menghentikan layanan yang menulis data"
compose stop functions evolution >/dev/null

log "Memulihkan database"
# Data only: the tables come from this install's migrations (deploy.sh), so the
# backup must be from the same or an older version of Balas.id. The services'
# own migration records stay those of this install.
compose cp "$src/db-$stamp.dump" db:/tmp/restore.dump >/dev/null
compose exec -T db sh -c "pg_restore -l /tmp/restore.dump | grep -E '(TABLE DATA|SEQUENCE SET) (public|auth|storage) ' | grep -vE ' (schema_migrations|migrations) ' > /tmp/restore.list"
compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -c "do \$\$ declare t text; begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ') into t from pg_tables
  where schemaname in ('public', 'auth', 'storage') and tablename not in ('schema_migrations', 'migrations');
  execute 'truncate ' || t || ' cascade'; end \$\$;"
compose exec -T db pg_restore -U supabase_admin -d postgres --data-only --disable-triggers --no-owner \
  --exit-on-error -L /tmp/restore.list /tmp/restore.dump
compose exec -T db rm -f /tmp/restore.dump /tmp/restore.list

if [[ -f "$src/evolution-$stamp.dump" ]]; then
  log "Memulihkan sesi nomor QR"
  compose exec -T db psql -U supabase_admin -d postgres -q -c "drop database if exists evolution with (force)" -c "create database evolution owner postgres"
  compose cp "$src/evolution-$stamp.dump" db:/tmp/evolution.dump >/dev/null
  compose exec -T db pg_restore -U postgres -d evolution --no-owner --role=postgres /tmp/evolution.dump
  compose exec -T db rm -f /tmp/evolution.dump
fi
if [[ -f "$src/evolution-files-$stamp.tar.gz" ]]; then
  rm -rf "$SUPABASE_DIR/volumes/evolution"
  tar -C "$SUPABASE_DIR/volumes" -xzf "$src/evolution-files-$stamp.tar.gz"
fi

log "Memulihkan file media"
if [[ $from_drive == 1 ]]; then
  rclone sync "$(backup_remote storage)" "$SUPABASE_DIR/volumes/storage"
else
  rm -rf "$SUPABASE_DIR/volumes/storage.old"
  mv "$SUPABASE_DIR/volumes/storage" "$SUPABASE_DIR/volumes/storage.old"
  tar -C "$SUPABASE_DIR/volumes" -xzf "$src/storage-$stamp.tar.gz"
  rm -rf "$SUPABASE_DIR/volumes/storage.old"
fi

if [[ $with_settings == 1 ]]; then
  [[ -f "$src/config-$stamp.tar.gz" ]] || die "Backup ini belum berisi pengaturan server"
  log "Memulihkan kunci & pengaturan aplikasi"
  old_env="$work/old.env"
  tar -xzf "$src/config-$stamp.tar.gz" -O --wildcards '*/.env' >"$old_env"
  for key in "${SETTINGS_KEYS[@]}"; do
    value="$(grep -E "^$key=" "$old_env" | tail -n1 | cut -d= -f2- || true)"
    [[ -n "$value" ]] && env_set "$key" "$value"
  done
  rm -f "$old_env"
fi
rm -rf "$work"

log "Menyalakan ulang layanan"
compose up -d >/dev/null 2>&1
compose restart auth storage rest >/dev/null 2>&1 || true

log "Selesai. Backup $stamp sudah dipulihkan."
echo "Data sebelum pemulihan tersimpan di $BACKUP_DIR (backup terbaru) bila perlu dibatalkan."
