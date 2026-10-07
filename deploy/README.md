# Deploy Balas.id ke VPS sendiri

Satu VPS menjalankan semuanya: Supabase self-hosted (Postgres, Auth, Realtime, Storage, Edge Functions) di Docker,
gateway Evolution API untuk nomor scan QR, web app statis, dan Caddy untuk HTTPS.

```
Nomor API resmi:  Pelanggan ⇄ WhatsApp ⇄ Meta Cloud API ──webhook──▶ https://api.domainanda.com/functions/v1/whatsapp-webhook
Nomor scan QR:    Pelanggan ⇄ WhatsApp ⇄ Evolution API (container internal) ──▶ Edge Function wa-qr-webhook
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
   Gateway QR (Evolution API) hanya bisa dihubungi dari dalam jaringan Docker.
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

## 4. Hubungkan kanal chat (WhatsApp, Messenger, Instagram, Telegram, live chat)

Ada dua cara, dan keduanya bisa dipakai bersamaan (misalnya nomor utama lewat API resmi, nomor cadangan lewat QR):

| | Scan QR | WhatsApp API resmi |
|---|---|---|
| Daftar ke Meta | Tidak perlu | Perlu Meta Business |
| Aturan 24 jam & template | Tidak ada | Ada |
| Pesan yang diketik di HP | Ikut tercatat di Balas.id | Tidak berlaku |
| Risiko diblokir WhatsApp | **Ada** (tidak resmi), hindari kirim massal | Tidak ada |

### 4a. Scan QR (nomor WhatsApp / WhatsApp Business biasa)

1. **Pengaturan → Nomor WhatsApp → Tambah nomor**, pilih **Scan QR**, isi nama, klik **Tambah & tampilkan QR**.
2. Di HP: WhatsApp → **Perangkat tertaut** → **Tautkan perangkat**, lalu scan QR di layar.
   Atau pakai tab **Kode tautan**: masukkan nomor HP, lalu ketik kodenya di HP
   (*Tautkan dengan nomor telepon saja*).
3. Status berubah menjadi **Terhubung**. HP boleh tetap dipakai, tapi harus online minimal sekali tiap 14 hari
   agar tautan tidak terputus.

Kalau status menjadi **Terputus** (misalnya perangkat dihapus dari HP), klik **Hubungkan** dan scan ulang.
Log gateway: `cd /opt/balas/supabase && sudo docker compose logs --tail 100 evolution`.

### 4b. WhatsApp API resmi (Meta Cloud API)

1. **Pengaturan → Nomor WhatsApp → Tambah nomor**, pilih **WhatsApp API resmi**, isi Phone number ID dan WhatsApp Business Account ID (Meta Business Manager → WhatsApp → API Setup).
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

### 4c. Facebook Messenger & Instagram Direct

Sekali siapkan aplikasi Meta (boleh aplikasi yang sama dengan WhatsApp), lalu admin cukup klik **Hubungkan dengan
Facebook**:

1. developers.facebook.com → aplikasi Anda (tipe *Business*) → tambahkan produk **Facebook Login for Business**,
   **Messenger**, dan **Instagram** (*API setup with Facebook login*).
2. Facebook Login → Settings → **Valid OAuth Redirect URIs**: `https://api.domainanda.com/functions/v1/social-oauth`
3. Webhooks:
   - Callback URL: `https://api.domainanda.com/functions/v1/meta-webhook`; verify token: sama dengan WhatsApp
     (`WHATSAPP_VERIFY_TOKEN`).
   - Objek **Page**: field `messages`, `message_echoes`, `message_deliveries`, `message_reads`, `messaging_postbacks`.
   - Objek **Instagram**: field `messages`.
4. Isi di `/opt/balas/supabase/.env`, lalu jalankan `cd /opt/balas/supabase && sudo docker compose up -d functions`:
   ```bash
   META_APP_ID=<App ID>
   META_APP_SECRET=<App secret>   # kosongkan bila sama dengan WHATSAPP_APP_SECRET
   ```
5. Di Balas.id: **Pengaturan → Kanal chat → Hubungkan dengan Facebook**. Login dengan akun yang menjadi admin Halaman,
   centang Halaman (Messenger) dan akun Instagram Bisnis yang tertaut, lalu klik **Hubungkan**.

Catatan:
- Selama aplikasi Meta masih *Development*, hanya akun yang terdaftar sebagai admin/tester aplikasi yang bisa login dan
  mengirim pesan uji. Untuk pelanggan umum, ajukan **App Review** untuk izin `pages_messaging`,
  `instagram_manage_messages`, `pages_manage_metadata`, `pages_show_list`, `instagram_basic`,
  `business_management`, dan lakukan **Business Verification**.
- Akun Instagram harus akun **Bisnis/Kreator** yang tertaut ke Halaman Facebook, dan pengaturan Instagram
  *Izinkan akses ke pesan* harus aktif.
- Aturan balasan Meta: bebas dalam 24 jam sejak pesan terakhir pelanggan; sampai 7 hari dikirim dengan tag *Human Agent*
  (perlu izin Human Agent di App Review); lewat 7 hari tidak bisa dibalas.
- Threads belum punya API pesan langsung. X/Twitter butuh paket API berbayar, jadi belum didukung.

### 4d. Telegram

1. Di Telegram, chat **@BotFather** → `/newbot` → beri nama dan username bot (harus berakhiran `bot`).
2. Salin token yang diberikan, lalu di Balas.id: **Pengaturan → Kanal chat → Telegram → Hubungkan bot**.
3. Pelanggan cukup membuka `t.me/<username_bot>` dan menekan **Start**. Pesan masuk ke Inbox.

Webhook Telegram diatur otomatis; Telegram hanya mengirim ke alamat HTTPS, jadi pastikan instalasi HTTPS sudah jalan.
Bot hanya bisa membalas orang yang pernah memulai chat dengannya.

### 4e. Live chat di website

1. **Pengaturan → Kanal chat → Live chat website → Buat widget**.
2. Atur judul, sapaan, dan warna; salin **kode pasang**, lalu tempel sebelum `</body>` di website Anda (WordPress:
   plugin *Insert Headers and Footers*; Shopify: `theme.liquid`). Contoh:
   ```html
   <script src="https://app.domainanda.com/widget.js" data-key="KODE_WIDGET"
           data-api="https://api.domainanda.com" async></script>
   ```
3. Opsional: isi daftar website yang diizinkan, supaya widget tidak bisa dipasang di situs lain.

Pengunjung bisa langsung chat (opsional isi nama dan No. WhatsApp/email). Riwayatnya tersimpan di browser mereka, jadi
chat tetap ada setelah halaman dimuat ulang. AI Agent juga bisa menjawab chat website.

## 5. AI Agent (balas otomatis)

1. Buat API key di penyedia pilihan Anda; biaya pemakaian ditagih penyedia langsung ke akun Anda:
   - Claude: console.anthropic.com → API Keys
   - ChatGPT: platform.openai.com → API keys
   - DeepSeek: platform.deepseek.com
   - Gemini: aistudio.google.com
   - LLM lain yang kompatibel OpenAI (OpenRouter, Groq, Qwen, Ollama): isi juga Base URL-nya
2. Buka menu **AI Agent → Pengaturan**: pilih penyedia dan model, simpan API key, lalu klik **Cek koneksi**.
3. Di **Produk & Pengetahuan**:
   - Isi produk satu per satu, atau impor dari CSV (kolom `nama`, `harga`, `sku`, `deskripsi`, `kata kunci`).
   - Unggah dokumen per produk atau dokumen umum (PDF, DOCX, TXT, MD, CSV): spesifikasi, FAQ, pengiriman, pembayaran, garansi.
4. Coba dulu di tab **Uji coba**. Kalau jawabannya sudah pas, nyalakan **Balas otomatis** dan centang nomor yang dijawab AI.

Cara kerja AI:
- AI hanya menjawab chat yang belum diambil agen. Begitu agen mengambil chat, AI berhenti.
- Kalau informasinya tidak ada di pengetahuan, pelanggan minta bicara dengan manusia, atau ada komplain/pembayaran/refund, AI mengirim pesan serah-terima. Chat tetap di antrean dengan catatan alasannya untuk agen.
- Agen bisa mematikan atau menyalakan AI per chat, dan memakai tombol **Saran AI** untuk membuat draf balasan.

API key disimpan terenkripsi dengan `BALAS_SECRET_KEY` (dibuat installer di `.env`). Kalau kunci itu diganti,
API key harus disimpan ulang. Log AI: tab **Riwayat**, dan `/var/log/balas-ai.log` untuk penyapu per menit.

## 6. Update aplikasi

```bash
cd /opt/balas/app && sudo git pull && sudo ./deploy/scripts/deploy.sh
```

`deploy.sh` menjalankan migrasi database yang belum diterapkan, memasang ulang Edge Functions, dan build web app.

## 7. Backup & pemeliharaan

- Backup harian ada di `/var/backups/balas` (database, sesi nomor QR, file media; disimpan 30 hari).
- Setiap malam (03:30) pesan yang lewat masa simpan organisasi dihapus. Gateway QR hanya menyimpan salinan pesan
  30 hari terakhir (`GATEWAY_KEEP_DAYS` di baris purge pada `/etc/cron.d/balas`). Log: `/var/log/balas-backup.log`.
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

## 8. Uji beban (opsional)

Setelah nomor uji terhubung, kirim 200 pesan tiruan ke webhook untuk memastikan server kuat:

```bash
node scripts/loadtest-webhook.mjs --url https://api.domainanda.com/functions/v1/whatsapp-webhook \
  --secret "<WHATSAPP_APP_SECRET>" --phone-number-id <phone_number_id nomor uji> \
  --messages 200 --contacts 50 --concurrency 10
```

Data uji muncul sebagai kontak "Load Test …" (nomor 6289900…); hapus dari database setelah selesai.
