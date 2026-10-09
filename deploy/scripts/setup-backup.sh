#!/usr/bin/env bash
# Connects the daily backup to a Google Drive folder (rclone) and sets the
# passphrase that encrypts what is uploaded. Run once on the VPS:
#   sudo ./deploy/scripts/setup-backup.sh https://drive.google.com/drive/folders/<id>
#
# Google login without a browser on the server, choose one:
#  A) SSH tunnel: connect to the VPS with
#       ssh -L 53682:127.0.0.1:53682 root@<IP VPS>
#     run this script there and open the link it prints on your computer.
#  B) Token from your computer: install rclone (https://rclone.org/downloads),
#     run `rclone authorize "drive"`, log in, and paste the token it prints.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$APP_DIR/deploy/scripts/lib.sh"
REMOTE_NAME="${REMOTE_NAME:-gdrive}"

[[ $EUID -eq 0 ]] || die "Jalankan dengan sudo"
[[ -f "$SUPABASE_DIR/.env" ]] || die "Supabase belum terpasang di $SUPABASE_DIR"

folder="${1:-}"
[[ -n "$folder" ]] || read -rp "Link atau ID folder Google Drive: " folder
folder_id="$(sed -E 's#.*/folders/([A-Za-z0-9_-]+).*#\1#; s#.*[?&]id=([A-Za-z0-9_-]+).*#\1#' <<<"$folder")"
[[ "$folder_id" =~ ^[A-Za-z0-9_-]{10,}$ ]] || die "ID folder tidak dikenali: $folder"

if ! command -v rclone >/dev/null; then
  log "Memasang rclone"
  curl -fsSL https://rclone.org/install.sh | bash >/dev/null
fi

log "Login Google Drive"
cat <<EOF
Pilih cara login:
  A) Saya terhubung lewat: ssh -L 53682:127.0.0.1:53682 root@<IP VPS>
     (link login dibuka di browser komputer Anda)
  B) Saya sudah menjalankan  rclone authorize "drive"  di komputer dan punya tokennya
EOF
read -rp "Pilihan [A/B]: " how
token=""
if [[ "${how^^}" == B ]]; then
  read -rp "Tempel token (satu baris, diawali {\"access_token\"): " token
else
  echo "Buka link http://127.0.0.1:53682/auth... yang muncul di bawah pada browser komputer Anda, lalu login & izinkan."
  out="$(mktemp)"
  rclone authorize drive --auth-no-open-browser 2>&1 | tee "$out"
  token="$(grep -o '{"access_token".*}' "$out" | tail -n1 || true)"
  rm -f "$out"
fi
[[ "$token" == \{* ]] || die "Token Google tidak didapat. Ulangi dan pastikan login selesai."

rclone config delete "$REMOTE_NAME" >/dev/null 2>&1 || true
rclone config create "$REMOTE_NAME" drive scope=drive root_folder_id="$folder_id" token="$token" >/dev/null
rclone lsd "$REMOTE_NAME:" >/dev/null || die "Folder tidak bisa dibuka. Pastikan akun yang login punya akses ke folder itu."

log "Kata sandi backup"
cat <<EOF
Backup di Google Drive dienkripsi dengan kata sandi ini. SIMPAN di tempat aman
(mis. pengelola kata sandi): tanpa kata sandi ini backup TIDAK BISA dibuka,
termasuk oleh kami. Minimal 12 karakter.
EOF
while true; do
  read -rsp "Kata sandi backup: " p1 && echo
  read -rsp "Ulangi: " p2 && echo
  [[ "$p1" == "$p2" ]] || { warn "Tidak sama, ulangi."; continue; }
  [[ ${#p1} -ge 12 ]] || { warn "Minimal 12 karakter."; continue; }
  [[ "$p1" != *"'"* && "$p1" != *\\* ]] || { warn "Jangan pakai tanda petik satu (') atau garis miring terbalik (\\)."; continue; }
  break
done
env_set BACKUP_REMOTE "$REMOTE_NAME:"
env_set BACKUP_PASSPHRASE "$p1"

log "Backup pertama (bisa beberapa menit)"
"$APP_DIR/deploy/scripts/backup.sh" | tee -a /var/log/balas-backup.log
echo
rclone ls "$(backup_remote backups)" | tail -n 5
log "Selesai. Backup berjalan otomatis setiap hari pukul 02:15 ke folder Google Drive tersebut."
