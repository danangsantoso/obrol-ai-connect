# Deploy Balas.id ke VPS sendiri

Satu VPS menjalankan semuanya: Supabase self-hosted (Postgres, Auth, Realtime, Storage, Edge Functions) di Docker, web app statis, dan Caddy untuk HTTPS.

```
Pelanggan ⇄ WhatsApp ⇄ Meta Cloud API ──webhook──▶ https://api.balas.id/functions/v1/whatsapp-webhook
                                                     │
Agen (browser) ──▶ https://app.balas.id (Caddy, file statis)
               └─▶ https://api.balas.id (Caddy → Kong :8000 → Supabase)
```

## 1. Siapkan server

- VPS: 4 vCPU, 8 GB RAM, 100 GB SSD, Ubuntu 24.04 LTS, data center Jakarta.
- DNS: arahkan `app.balas.id` dan `api.balas.id` (A record) ke IP VPS.
- Firewall: buka hanya 22, 80, 443.

```bash
sudo apt update && sudo apt install -y git curl ca-certificates
curl -fsSL https://get.docker.com | sudo sh
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

## 2. Pasang Supabase self-hosted

```bash
sudo mkdir -p /opt/balas && sudo chown $USER /opt/balas && cd /opt/balas
git clone --depth 1 https://github.com/supabase/supabase supabase
git clone <url-repo-ini> app
cd supabase/docker
cp .env.example .env
cp /opt/balas/app/deploy/supabase/docker-compose.override.yml .
```

Edit `/opt/balas/supabase/docker/.env`:

| Variabel | Isi |
| --- | --- |
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DASHBOARD_PASSWORD`, `SECRET_KEY_BASE`, `VAULT_ENC_KEY` | Ganti semua dengan nilai acak. `ANON_KEY` dan `SERVICE_ROLE_KEY` dibuat dari `JWT_SECRET` (lihat panduan self-hosting Supabase). |
| `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL` | `https://api.balas.id` |
| `SITE_URL` | `https://app.balas.id` |
| `ADDITIONAL_REDIRECT_URLS` | `https://app.balas.id` |
| `DISABLE_SIGNUP` | `false` sampai admin pertama mendaftar, lalu `true` (agen ditambahkan admin dari menu Tim & Agen) |
| `SMTP_*` | Opsional, hanya untuk undangan lewat email |
| `FUNCTIONS_VERIFY_JWT` | `false` (setiap fungsi Balas.id memeriksa login sendiri) |

Tambahkan di file yang sama:

```bash
APP_URL=https://app.balas.id
WHATSAPP_VERIFY_TOKEN=<string acak buatan Anda>
WHATSAPP_APP_SECRET=<Meta App → Settings → Basic → App secret>
WHATSAPP_ACCESS_TOKEN=<token permanen System User dengan izin whatsapp_business_messaging & whatsapp_business_management>
WHATSAPP_GRAPH_VERSION=v23.0
```

Jalankan:

```bash
docker compose pull && docker compose up -d
```

Jangan buka port Postgres/pooler (5432, 6543) di firewall; akses database lewat SSH.

## 3. Deploy aplikasi

```bash
cd /opt/balas/app
chmod +x deploy/scripts/*.sh
sudo mkdir -p /var/www/balas && sudo chown $USER /var/www/balas
SUPABASE_DIR=/opt/balas/supabase/docker ./deploy/scripts/deploy.sh
```

Skrip ini menjalankan migrasi database yang belum pernah diterapkan (`supabase/migrations`, lewat `psql` di container `db`), menyalin Edge Functions ke `volumes/functions`, me-restart container functions, lalu build web app ke `/var/www/balas/dist`.

Untuk update berikutnya: `git pull && ./deploy/scripts/deploy.sh`.

## 4. HTTPS dengan Caddy

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # ganti domain di dalamnya
sudo systemctl reload caddy
```

Caddy mengambil sertifikat Let's Encrypt otomatis.

## 5. Hubungkan WhatsApp

1. Buka `https://app.balas.id`, daftar sebagai admin pertama, buat organisasi.
2. **Pengaturan → Nomor WhatsApp**: isi Phone number ID dan WhatsApp Business Account ID (Meta Business Manager → WhatsApp → API Setup).
3. Meta App → WhatsApp → Configuration → Webhook:
   - Callback URL: `https://api.balas.id/functions/v1/whatsapp-webhook` (juga tampil di halaman Pengaturan)
   - Verify token: nilai `WHATSAPP_VERIFY_TOKEN`
   - Subscribe field: `messages`
4. Klik **Sinkron** pada nomor untuk menarik template pesan yang sudah disetujui.
5. Set `DISABLE_SIGNUP=true`, `docker compose up -d`, lalu tambahkan agen dari **Tim & Agen**.

## 6. Backup & pemeliharaan

```bash
sudo crontab -e
# Backup harian 02:15 (database + file media), simpan 30 hari
15 2 * * * SUPABASE_DIR=/opt/balas/supabase/docker /opt/balas/app/deploy/scripts/backup.sh >> /var/log/balas-backup.log 2>&1
# Hapus pesan yang melewati masa retensi organisasi (default 180 hari)
30 3 * * * cd /opt/balas/supabase/docker && docker compose exec -T db psql -U postgres -d postgres -c "select public.purge_expired_messages();" >> /var/log/balas-retention.log 2>&1
```

Isi `BACKUP_REMOTE` (remote [rclone](https://rclone.org)) agar backup juga tersalin ke luar VPS, dan uji restore sebulan sekali:

```bash
gunzip -c db-<tanggal>.dump.gz | docker compose exec -T db pg_restore -U postgres -d postgres --clean --if-exists
```

Pantau server dengan [Uptime Kuma](https://github.com/louislam/uptime-kuma) (cek `https://app.balas.id` dan `https://api.balas.id/functions/v1/whatsapp-webhook` → 403 berarti hidup).
