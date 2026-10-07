#!/usr/bin/env bash
# One-shot installer for Balas.id on a fresh Ubuntu/Debian VPS.
#
#   sudo mkdir -p /opt/balas && cd /opt/balas
#   sudo git clone https://github.com/danangsantoso/obrol-ai-connect.git app
#   sudo bash app/deploy/scripts/setup-vps.sh --domain domainanda.com
#
# Installs Docker, Node.js and Caddy, sets up self-hosted Supabase (official
# setup.sh), configures Balas.id, HTTPS, firewall, daily backup/retention jobs,
# then deploys the app. Safe to re-run: existing secrets are kept.
#
# Options:
#   --domain D        use app.D for the web app and api.D for the API
#   --app-host H      web app host name (overrides --domain)
#   --api-host H      API host name (overrides --domain)
#   --yes             do not ask for confirmation
#   --local-test      no HTTPS/firewall/apt; http://127.0.0.1 URLs (for testing the stack only)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BASE_DIR="$(dirname "$APP_DIR")"
export SUPABASE_DIR="${SUPABASE_DIR:-$BASE_DIR/supabase}"
# shellcheck source=lib.sh
source "$APP_DIR/deploy/scripts/lib.sh"

DOMAIN="" APP_HOST="" API_HOST="" ASSUME_YES=0 LOCAL_TEST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --app-host) APP_HOST="$2"; shift 2 ;;
    --api-host) API_HOST="$2"; shift 2 ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    --local-test) LOCAL_TEST=1; shift ;;
    -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "Opsi tidak dikenal: $1" ;;
  esac
done

[[ "$(id -u)" == 0 ]] || die "Jalankan sebagai root: sudo bash $0 ..."
[[ -f /etc/os-release ]] && . /etc/os-release
case "${ID:-}:${ID_LIKE:-}" in
  ubuntu:* | debian:* | *:*debian*) ;;
  *) [[ $LOCAL_TEST == 1 ]] || die "Skrip ini untuk Ubuntu/Debian." ;;
esac

# ---------------------------------------------------------------------------
# 1. Domain
# ---------------------------------------------------------------------------
if [[ $LOCAL_TEST == 1 ]]; then
  APP_URL="http://127.0.0.1:4173"
  API_URL="http://127.0.0.1:8000"
else
  if [[ -z "$DOMAIN" && ( -z "$APP_HOST" || -z "$API_HOST" ) ]]; then
    read -r -p "Domain Anda (contoh: balas.id): " DOMAIN </dev/tty
  fi
  APP_HOST="${APP_HOST:-app.$DOMAIN}"
  API_HOST="${API_HOST:-api.$DOMAIN}"
  [[ "$APP_HOST" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ && "$API_HOST" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] ||
    die "Nama domain tidak valid: $APP_HOST / $API_HOST"
  APP_URL="https://$APP_HOST"
  API_URL="https://$API_HOST"

  log "Memeriksa DNS"
  apt-get install -qq -y curl dnsutils >/dev/null 2>&1 || true
  public_ip="$(curl -fsS4 --max-time 10 https://api.ipify.org || true)"
  dns_ok=1
  for host in "$APP_HOST" "$API_HOST"; do
    resolved="$(dig +short A "$host" | tail -n1)"
    if [[ -z "$resolved" ]]; then
      warn "$host belum mengarah ke mana pun. Buat A record ke ${public_ip:-IP VPS ini}."
      dns_ok=0
    elif [[ -n "$public_ip" && "$resolved" != "$public_ip" ]]; then
      warn "$host mengarah ke $resolved, bukan ke VPS ini ($public_ip). Cloudflare proxy (awan oranye) harus dimatikan."
      dns_ok=0
    else
      echo "  $host -> $resolved  OK"
    fi
  done
  if [[ $dns_ok == 0 ]]; then
    warn "Sertifikat HTTPS hanya bisa dibuat setelah DNS benar. Instalasi tetap bisa dilanjutkan; jalankan ulang skrip setelah DNS beres."
  fi
fi

echo
echo "  Web app : $APP_URL"
echo "  API     : $API_URL"
echo "  Lokasi  : $APP_DIR (aplikasi), $SUPABASE_DIR (Supabase)"
if [[ $ASSUME_YES == 0 ]]; then
  read -r -p "Lanjutkan instalasi? [Y/n] " answer </dev/tty
  [[ "${answer:-Y}" =~ ^[Yy]$ ]] || exit 0
fi

# ---------------------------------------------------------------------------
# 2. System packages, Node.js, Caddy, firewall
# ---------------------------------------------------------------------------
if [[ $LOCAL_TEST == 0 ]]; then
  log "Memasang paket sistem"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -qq -y git curl ca-certificates gnupg openssl jq ufw cron debian-keyring \
    debian-archive-keyring apt-transport-https >/dev/null

  if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
    log "Memasang Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -qq -y nodejs >/dev/null
  fi

  if ! command -v caddy >/dev/null; then
    log "Memasang Caddy (HTTPS otomatis)"
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
      gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -qq -y caddy >/dev/null
  fi

  log "Firewall: hanya SSH, 80 dan 443 yang dibuka"
  ssh_ports="$(ss -tlnpH 2>/dev/null | awk '/sshd/ { n = split($4, a, ":"); print a[n] }' | sort -u)"
  for port in 22 $ssh_ports; do ufw allow "$port/tcp" >/dev/null; done
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

# ---------------------------------------------------------------------------
# 3. Self-hosted Supabase (official installer: Docker, sources, secrets)
# ---------------------------------------------------------------------------
if [[ ! -f "$SUPABASE_DIR/.env" ]]; then
  log "Memasang Supabase self-hosted (unduhan image beberapa menit)"
  setup_script="$(mktemp)"
  curl -fsSL https://raw.githubusercontent.com/supabase/supabase/HEAD/docker/setup.sh -o "$setup_script"
  skip_deps=()
  [[ $LOCAL_TEST == 1 ]] && skip_deps=(--skip-deps)
  (cd "$BASE_DIR" && sh "$setup_script" -y -p "$(basename "$SUPABASE_DIR")" "${skip_deps[@]}")
  rm -f "$setup_script"
else
  log "Supabase sudah terpasang di $SUPABASE_DIR, kunci rahasia dipertahankan"
fi
command -v docker >/dev/null || die "Docker tidak terpasang"
chmod 600 "$SUPABASE_DIR/.env"

log "Konfigurasi Balas.id"
install_balas_overlay "$APP_DIR"
env_set SUPABASE_PUBLIC_URL "$API_URL"
env_set API_EXTERNAL_URL "$API_URL/auth/v1"
env_set SITE_URL "$APP_URL"
env_set ADDITIONAL_REDIRECT_URLS "$APP_URL,$APP_URL/**"
env_set APP_URL "$APP_URL"
env_set FUNCTIONS_VERIFY_JWT false
# Accounts are created by the admin; no email confirmation round-trip.
env_set ENABLE_EMAIL_AUTOCONFIRM true
env_set STUDIO_DEFAULT_ORGANIZATION '"Balas.id"'
env_set STUDIO_DEFAULT_PROJECT '"Balas.id"'
[[ -n "$(env_get DISABLE_SIGNUP)" ]] || env_set DISABLE_SIGNUP false

log "Menyalakan Supabase"
compose up -d --wait --wait-timeout 600 || {
  compose ps
  die "Sebagian layanan Supabase gagal menyala. Lihat log: cd $SUPABASE_DIR && docker compose logs --tail 50"
}

# Auth and storage create their schemas on first boot; migrations need both.
for i in $(seq 1 60); do
  ready="$(psql_db -tAc "select to_regclass('auth.users') is not null and to_regclass('storage.buckets') is not null" 2>/dev/null || true)"
  [[ "$ready" == "t" ]] && break
  [[ $i == 60 ]] && die "Skema auth/storage belum siap setelah 3 menit"
  sleep 3
done

# ---------------------------------------------------------------------------
# 4. Deploy the app (migrations, Edge Functions, web build)
# ---------------------------------------------------------------------------
WEB_ROOT="${WEB_ROOT:-/var/www/balas}" bash "$APP_DIR/deploy/scripts/deploy.sh"

# ---------------------------------------------------------------------------
# 5. HTTPS, scheduled jobs
# ---------------------------------------------------------------------------
if [[ $LOCAL_TEST == 0 ]]; then
  log "HTTPS dengan Caddy"
  sed -e "s/__APP_HOST__/$APP_HOST/" -e "s/__API_HOST__/$API_HOST/" "$APP_DIR/deploy/Caddyfile" >/etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl enable --now caddy >/dev/null 2>&1
  systemctl reload caddy

  log "Jadwal backup harian & penghapusan sesuai masa simpan"
  cat >/etc/cron.d/balas <<EOF
# Balas.id maintenance (installed by setup-vps.sh)
SUPABASE_DIR=$SUPABASE_DIR
15 2 * * * root $APP_DIR/deploy/scripts/backup.sh >> /var/log/balas-backup.log 2>&1
30 3 * * * root $APP_DIR/deploy/scripts/purge-retention.sh >> /var/log/balas-retention.log 2>&1
EOF
  chmod 644 /etc/cron.d/balas
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
cat <<EOF

$(printf '\033[1;32m')Balas.id terpasang.$(printf '\033[0m')

  Buka aplikasi   : $APP_URL
  1. Daftar akun admin pertama di tab "Daftar", lalu buat organisasi.
  2. Setelah itu tutup pendaftaran umum:
       sudo sed -i 's/^DISABLE_SIGNUP=.*/DISABLE_SIGNUP=true/' $SUPABASE_DIR/.env
       cd $SUPABASE_DIR && sudo docker compose up -d
  3. Tambahkan agen dari menu Tim & Agen (pakai password sementara).

  Sambungkan WhatsApp, pilih salah satu atau keduanya:
  a) Scan QR (nomor WhatsApp biasa): Pengaturan -> Nomor WhatsApp -> Scan QR,
     lalu scan dari HP (WhatsApp -> Perangkat tertaut). Tidak perlu akun Meta.
  b) WhatsApp API resmi (Meta App -> WhatsApp -> Configuration):
     Callback URL : $API_URL/functions/v1/whatsapp-webhook
     Verify token : $(env_get WHATSAPP_VERIFY_TOKEN)
     Field        : messages
  Lalu isi WHATSAPP_APP_SECRET dan WHATSAPP_ACCESS_TOKEN di $SUPABASE_DIR/.env,
  jalankan: cd $SUPABASE_DIR && sudo docker compose up -d functions

  Semua kunci rahasia tersimpan di $SUPABASE_DIR/.env (jangan dibagikan).
  Dashboard Supabase Studio hanya lewat SSH tunnel:
     ssh -L 8000:127.0.0.1:8000 root@<IP VPS>  lalu buka http://localhost:8000
     (user: $(env_get DASHBOARD_USERNAME), password: lihat DASHBOARD_PASSWORD di .env)

  Update aplikasi nanti: cd $APP_DIR && sudo git pull && sudo ./deploy/scripts/deploy.sh
EOF
