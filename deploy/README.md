# Deploy Balas.id ke VPS sendiri

Satu VPS menjalankan semuanya: Supabase self-hosted (Postgres, Auth, Realtime, Storage, Edge Functions) di Docker, web app statis, dan Caddy untuk HTTPS.

```
Pelanggan ⇄ WhatsApp ⇄ Meta Cloud API ──webhook──▶ https://api.domainanda.com/functions/v1/whatsapp-webhook
                                                     │
Agen (browser) ──▶ https://app.domainanda.com (Caddy, file statis)
               └─▶ https://api.domainanda.com (Caddy → gateway 127.0.0.1:8000 → Supabase)
```

## 1. Sebelum mulai

- VPS: minimal 4 vCPU, 8 GB RAM, 100 GB SSD, **Ubuntu 22.04/24.04**, akses root (atau sudo).
- DNS: buat dua **A record** ke IP VPS: `app.domainanda.com` dan `api.domainanda.com`.
  Di Cloudflare, matikan proxy (awan abu-abu) agar Caddy bisa membuat sertifikat HTTPS.

## 2. Instalasi otomatis (satu perintah)

```bash
sudo mkdir -p /opt/balas && cd /opt/balas
sudo git clone https://github.com/danangsantoso/obrol-ai-connect.git app
sudo bash app/deploy/scripts/setup-vps.sh --domain domainanda.com
```

Repo private: saat `git clone` meminta *Username*, isi user GitHub; untuk *Password* isi **Personal Access Token**
(GitHub → Settings → Developer settings → Fine-grained tokens, akses *Contents: Read* ke repo ini).

`setup-vps.sh` mengerjakan semuanya (± 10–15 menit) dan aman dijalankan ulang:

1. Mengecek DNS `app.` dan `api.` sudah mengarah ke VPS.
2. Memasang Docker, Node.js 22, Caddy; firewall hanya membuka SSH, 80, 443.
3. Memasang Supabase self-hosted dengan installer resmi; semua kunci rahasia dibuat acak di `/opt/balas/supabase/.env`.
4. Mengunci port Supabase (API, database) ke `127.0.0.1`; dashboard Studio tidak bisa diakses dari internet.
5. Menjalankan migrasi database, memasang Edge Functions, build web app.
6. HTTPS otomatis dengan Caddy, backup harian (02:15) dan penghapusan pesan lama (03:30) lewat cron.

Di akhir, skrip menampilkan URL aplikasi, URL webhook dan *verify token* untuk Meta.

## 3. Setelah instalasi

1. Buka `https://app.domainanda.com`, daftar sebagai admin pertama, buat organisasi.
2. Tutup pendaftaran umum:
   ```bash
   sudo sed -i 's/^DISABLE_SIGNUP=.*/DISABLE_SIGNUP=true/' /opt/balas/supabase/.env
   cd /opt/balas/supabase && sudo docker compose up -d
   ```
3. Tambahkan agen dari menu **Tim & Agen** (password sementara).

### Email (opsional: masuk dengan kode OTP, undangan via email)

Isi `SMTP_ADMIN_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SENDER_NAME` di
`/opt/balas/supabase/.env` (Gmail SMTP, Brevo, Mailgun, dll.), lalu `cd /opt/balas/supabase && sudo docker compose up -d`.
Tanpa SMTP, agen tetap bisa masuk dengan password.

## 4. Hubungkan WhatsApp

1. **Pengaturan → Nomor WhatsApp**: isi Phone number ID dan WhatsApp Business Account ID (Meta Business Manager → WhatsApp → API Setup).
2. Isi di `/opt/balas/supabase/.env`:
   ```bash
   WHATSAPP_APP_SECRET=<Meta App → Settings → Basic → App secret>
   WHATSAPP_ACCESS_TOKEN=<token permanen System User: whatsapp_business_messaging + whatsapp_business_management>
   ```
   lalu `cd /opt/balas/supabase && sudo docker compose up -d functions`.
3. Meta App → WhatsApp → Configuration → Webhook:
   - Callback URL: `https://api.domainanda.com/functions/v1/whatsapp-webhook` (juga tampil di halaman Pengaturan)
   - Verify token: nilai `WHATSAPP_VERIFY_TOKEN` di `.env` (ditampilkan di akhir instalasi)
   - Subscribe field: `messages`
4. Klik **Sinkron** pada nomor untuk menarik template pesan yang sudah disetujui.

## 5. Update aplikasi

```bash
cd /opt/balas/app && sudo git pull && sudo ./deploy/scripts/deploy.sh
```

`deploy.sh` menjalankan migrasi database yang belum diterapkan, memasang ulang Edge Functions, dan build web app.

## 6. Backup & pemeliharaan

- Backup harian ada di `/var/backups/balas` (database + file media, disimpan 30 hari). Log: `/var/log/balas-backup.log`.
- Salin backup ke luar VPS: pasang [rclone](https://rclone.org), lalu tambahkan `BACKUP_REMOTE=<remote:folder>` di baris
  backup pada `/etc/cron.d/balas`.
- Uji restore sebulan sekali:
  ```bash
  cd /opt/balas/supabase && sudo docker compose exec -T db pg_restore -U supabase_admin -d postgres --clean --if-exists < /var/backups/balas/db-<tanggal>.dump
  ```
- Dashboard Supabase Studio (lihat isi database): `ssh -L 8000:127.0.0.1:8000 root@<IP VPS>`, buka `http://localhost:8000`
  (user/password: `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` di `.env`).
- Pantau dengan [Uptime Kuma](https://github.com/louislam/uptime-kuma): `https://app.domainanda.com` dan
  `https://api.domainanda.com/functions/v1/whatsapp-webhook` (403 berarti hidup).

## 7. Uji beban (opsional)

Setelah nomor uji terhubung, kirim 200 pesan tiruan ke webhook untuk memastikan server kuat:

```bash
node scripts/loadtest-webhook.mjs --url https://api.domainanda.com/functions/v1/whatsapp-webhook \
  --secret "<WHATSAPP_APP_SECRET>" --phone-number-id <phone_number_id nomor uji> \
  --messages 200 --contacts 50 --concurrency 10
```

Data uji muncul sebagai kontak "Load Test …" (nomor 6289900…); hapus dari database setelah selesai.
