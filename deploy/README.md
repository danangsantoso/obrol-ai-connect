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

**Banyak perusahaan (multi-tenant):** buat Master Admin, lalu buat tenant dan Superadmin-nya dari halaman Master Admin.

```bash
cd /opt/balas/app && sudo ./deploy/scripts/create-master-admin.sh master@domainanda.com "Nama Anda"
```

Login dengan email itu dan password `12345678` (wajib diganti), lalu klik **Tenant baru**. Atau tentukan password
sendiri (tanda kutip satu wajib, agar karakter seperti `!` dan `$` tidak diubah shell; menjalankan ulang perintah ini
juga mengganti password akun yang sudah ada):

```bash
sudo MASTER_PASSWORD='password-anda' ./deploy/scripts/create-master-admin.sh master@domainanda.com "Nama Anda"
```
 Menonaktifkan tenant
langsung memblokir login semua anggotanya, menghentikan AI dan webhook-nya; datanya tetap tersimpan.

Calon pelanggan juga bisa **mendaftar sendiri** (Google atau email): mereka mengisi nama usaha, lalu menunggu. Master
Admin menyetujui atau menolak di halaman Master Admin; setelah disetujui, tenant dibuat dan pendaftar masuk sebagai
Superadmin. Untuk ini pendaftaran harus tetap terbuka (`DISABLE_SIGNUP=false`, bawaan): akun yang belum disetujui
tidak bisa melihat data apa pun.

**Login dengan Google** (opsional):
1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client
   ID** → *Web application*. Jika diminta, isi dulu *OAuth consent screen* (External, nama aplikasi Balas.id).
2. **Authorized redirect URIs**: `https://api.domainanda.com/auth/v1/callback`
3. Isi di `/opt/balas/supabase/.env`, lalu jalankan `cd /opt/balas/supabase && sudo docker compose up -d auth`:
   ```bash
   GOOGLE_ENABLED=true
   GOOGLE_CLIENT_ID=<Client ID>.apps.googleusercontent.com
   GOOGLE_SECRET=<Client secret>
   ```
Tombol **Masuk/Daftar dengan Google** muncul otomatis. Anggota yang diundang dengan alamat Gmail juga bisa memakainya.

**Satu perusahaan saja** (tanpa Master Admin):

1. Buka `https://app.domainanda.com`, daftar sebagai admin pertama, buat organisasi.
   Atau buat akun awal per role sekaligus (password bawaan `12345678`, wajib diganti saat login pertama):
   ```bash
   cd /opt/balas/app && sudo ./deploy/scripts/create-default-users.sh "Nama Toko Anda"
   ```
   Hasilnya `admin@balas.id`, `supervisor@balas.id`, dan `agen@balas.id`. Segera login dengan ketiganya dan
   ganti passwordnya, karena siapa pun yang tahu password bawaan bisa masuk sebelum diganti.
2. Tutup pendaftaran umum:
   ```bash
   sudo sed -i 's/^DISABLE_SIGNUP=.*/DISABLE_SIGNUP=true/' /opt/balas/supabase/.env
   cd /opt/balas/supabase && sudo docker compose up -d
   ```
3. Tambahkan agen dari menu **Tim & Agen**. Password bawaan `12345678`; agen wajib menggantinya saat login pertama.
   Admin bisa mereset password agen ke `12345678` dari tabel anggota (agen kembali wajib mengganti).

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

### 4f. API, Webhook & MCP

Menu **Integrasi** (admin): buat API key untuk REST API dan MCP, dan daftarkan URL webhook. Tidak perlu pengaturan
server tambahan: `deploy.sh` memasang fungsi `api`, `mcp`, dan `webhook-dispatch`, dan cron per menit mengulang
webhook yang gagal. Referensi lengkap: [docs/API.md](../docs/API.md).

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

Pesan suara & gambar (**AI Agent → Pengaturan → Pesan suara & gambar**):
- **Gambar**: Claude, ChatGPT, dan Gemini ikut membaca foto dari pelanggan. Bukti transfer selalu diserahkan ke tim
  beserta nominal yang terbaca.
- **Pesan suara**: pilih layanan transkripsi (OpenAI Whisper, Groq, atau layanan lain yang kompatibel) dan simpan
  API key-nya. AI menjawab isi voice note, dan agen bisa menekan **Ubah jadi teks** di chat.

Cara kerja AI:
- AI hanya menjawab chat yang belum diambil agen. Begitu agen mengambil chat, AI berhenti.
- Kalau informasinya tidak ada di pengetahuan, pelanggan minta bicara dengan manusia, atau ada komplain/pembayaran/refund, AI mengirim pesan serah-terima. Chat tetap di antrean dengan catatan alasannya untuk agen.
- Agen bisa mematikan atau menyalakan AI per chat, dan memakai tombol **Saran AI** untuk membuat draf balasan.

API key disimpan terenkripsi dengan `BALAS_SECRET_KEY` (dibuat installer di `.env`). Kalau kunci itu diganti,
API key harus disimpan ulang. Log AI: tab **Riwayat**, dan `/var/log/balas-ai.log` untuk penyapu per menit.

## 5a. Follow-up otomatis

Menu **Follow-up → Urutan pesan**: klik **Pakai contoh 7 lapis** (kata-kata sudah disiapkan) atau buat sendiri,
maksimal 10 lapis. Atur jeda tiap lapis (hari/jam) dan jam kirim. Pakai `{sapaan}`, `{nama}`, `{agen}`, `{bot}`,
dan `{toko}` di pesan.

- **Manual**: agen klik tombol **Follow-up** di chat dan memilih urutannya.
- **Otomatis**: chat masuk sendiri saat kita sudah membalas dan pelanggan diam selama N jam. Bisa dibatasi ke chat
  berlabel tertentu.
- Urutan berhenti begitu pelanggan membalas atau membayar pesanan. Hasilnya ada di tab **Pelacakan** (berapa yang
  membalas, setelah lapis ke berapa, per agen).
- Nomor WhatsApp API resmi: setelah 24 jam sejak pesan terakhir pelanggan, sebuah lapis hanya bisa terkirim bila diberi
  template yang sudah disetujui Meta.

Pesan dikirim oleh penyapu per menit (`ai-sweep.sh`, log di `/var/log/balas-ai.log`).

## 5b. Pesanan, pembayaran & ongkir

Atur di **Pengaturan → Pembayaran & ongkir**:

- **Transfer bank**: isi rekening tujuan. Agen menekan **Tandai lunas** setelah memeriksa bukti transfer.
- **Xendit**: isi secret key (Xendit Dashboard → Settings → API Keys, izin *Money-in write*) dan *callback verification
  token*. Salin URL callback yang ditampilkan ke Xendit → Settings → Webhooks → *Invoices paid*.
- **Midtrans**: isi server key, lalu salin URL notifikasi ke Midtrans → Settings → Configuration →
  *Payment Notification URL*. Matikan **Mode produksi** saat memakai key sandbox.
- **Ongkir**: tarif tetap, atau tarif kurir otomatis lewat **Biteship** (API key dari biteship.com, plus kode pos asal).
  Isi berat produk di katalog agar ongkir akurat.
- **AI boleh membuat pesanan**: AI membuat pesanan begitu pelanggan setuju dan datanya lengkap, lalu mengirim tagihan.

Pesanan dibuat dari tombol **Pesanan** di chat dan dikelola di menu **Pesanan** (lunas, kirim dengan resi, selesai,
batal, ekspor CSV). Tagihan yang tidak dibayar sampai batas waktu otomatis jadi *Kedaluwarsa*. Event `order.created`,
`order.paid`, dan `order.status_changed` bisa dikirim ke webhook Anda.

## 5c. Broadcast

Menu **Broadcast** (admin dan supervisor): satu pesan ke banyak kontak, dengan filter label dan "aktif chat dalam N
hari", jadwal kirim, dan kecepatan per menit. Hasil per broadcast: terkirim, diterima, dibaca, dan membalas.

- **WhatsApp API resmi**: wajib template yang disetujui Meta (kategori *Marketing* untuk promo). Sinkronkan template di
  Pengaturan.
- **WhatsApp scan QR**: teks biasa. Nomor bisa diblokir WhatsApp kalau mengirim promo ke banyak orang yang tidak
  menyimpan nomor Anda. Kirim hanya ke pelanggan yang pernah chat, dengan kecepatan rendah (bawaan 8 pesan/menit).
- **Telegram**: teks ke pengguna yang pernah chat dengan bot.
- Messenger dan Instagram tidak didukung karena Meta melarang pesan promosi di luar 24 jam.
- Pelanggan yang membalas **STOP** atau **BERHENTI** tidak akan menerima broadcast lagi.

## 5d. Jam operasional, survei kepuasan & pertanyaan belum terjawab

- **Pengaturan → Jam operasional & survei kepuasan**: di luar jam kerja, AI langsung menjawab tanpa menunggu agen,
  chat tidak dirotasi ke agen, dan nomor tanpa AI mengirim pesan "sedang tutup".
- **Survei kepuasan**: saat chat diselesaikan, pelanggan diminta memberi nilai 1–5. Balasan angka tercatat per agen
  dan tidak membuka chat lagi.
- **AI Agent → Belum terjawab**: pertanyaan yang tidak bisa dijawab AI karena datanya belum ada, diurutkan dari
  yang paling sering ditanyakan. Klik **Jawab**: jawaban disimpan sebagai dokumen FAQ dan langsung dipakai AI.

## 5e. Laporan performa

Menu **Laporan** (admin dan supervisor) menampilkan, per agen dan AI:
- waktu respons (median, dan persen yang dibalas sesuai target menit);
- jumlah chat diselesaikan dan lama penyelesaiannya;
- nilai kepuasan (CSAT);
- pesanan lunas dan omzet.

Ada juga tren harian. Tombol **Ekspor Excel (CSV)** mengunduh file yang langsung terbuka di Excel.

## 5f. Paket langganan tenant (Master Admin)

Di halaman Master Admin, bagian **Paket langganan**, buat paket dengan batas:
- jumlah pengguna;
- jumlah kanal;
- balasan AI per bulan;
- pesan broadcast per bulan.

Kosongkan batas yang tidak ingin dibatasi. Tandai satu paket sebagai **bawaan** (dengan masa trial) agar tenant baru
otomatis memakainya.

Di daftar tenant, pilih paket per tenant dan tekan **+30 hari** untuk memperpanjang.

Saat kuota habis atau paket berakhir:
- **Balasan AI**: chat diserahkan ke tim.
- **Broadcast**: pesan sisanya tidak dikirim.
- **Pengguna atau kanal baru**: ditolak dengan pesan yang jelas.

Admin tenant melihat pemakaiannya di **Pengaturan → Paket & pemakaian**, dan mendapat peringatan di atas halaman
saat paket hampir berakhir atau kuota hampir habis. Tenant tanpa paket tidak dibatasi.

## 5g. Aplikasi di HP & notifikasi

Balas.id bisa dipasang seperti aplikasi:
- **Android/Chrome/Edge**: menu browser → **Pasang aplikasi**, atau tombol **Pasang aplikasi Balas.id** di ikon lonceng.
- **iPhone/iPad (iOS 16.4+)**: buka di Safari → Bagikan → **Tambah ke Layar Utama**, lalu buka dari ikonnya.

Setiap agen menekan ikon **lonceng → Aktifkan notifikasi** di tiap perangkat. Notifikasi muncul walau aplikasi
ditutup untuk:
- pesan baru di chat miliknya;
- chat yang diberikan kepadanya;
- AI yang butuh bantuan (agen yang online/away);
- disebut di catatan.

Kunci VAPID dibuat otomatis saat pertama dipakai. `PUSH_CONTACT_EMAIL` di `.env` (opsional) adalah email kontak yang
dikirim ke layanan push browser.

### Aplikasi agen untuk HP (APK Android & iPhone)

Tampilan khusus HP ada di `https://<web Balas.id>/m`: pengenalan saat pertama dibuka, Inbox (Chat saya / Antrean /
Dilayani AI), percakapan (ambil alih AI, serahkan ke AI, catatan internal, balasan cepat, lampiran), profil
pelanggan, kontak, pesanan (konfirmasi bayar, input resi), status & notifikasi, serta ubah profil dan foto.

- **iPhone**: buka `https://<web Balas.id>/m` di Safari → Bagikan → **Tambah ke Layar Utama** (iOS 16.4+ untuk
  notifikasi). Apple tidak mengizinkan file APK; aplikasi App Store butuh akun Apple Developer.
- **Android (APK)**: dibuat oleh GitHub Actions. Buka tab **Actions → APK Android (agen) → Run workflow**, isi
  alamat web Balas.id (mis. `https://balasapp.contoh.id`), lalu unduh APK dari **Releases**. Kirim file APK ke
  karyawan; di HP buka file itu, izinkan *Instal aplikasi tidak dikenal*, lalu **Pasang**. Aplikasi membuka
  `/m` dari server Anda, jadi setiap `deploy.sh` langsung memperbarui isi aplikasi tanpa APK baru.

Notifikasi di aplikasi Android memakai Firebase Cloud Messaging (gratis):
1. Buat proyek di [console.firebase.google.com](https://console.firebase.google.com) → **Tambah aplikasi Android**
   dengan nama paket `id.balas.agen` → unduh `google-services.json`.
2. Di GitHub: **Settings → Secrets and variables → Actions → New repository secret** `GOOGLE_SERVICES_JSON`, isi
   dengan seluruh isi file tersebut. Jalankan ulang workflow APK.
3. Di Firebase: **Project settings → Service accounts → Generate new private key**. Simpan isinya (base64) di
   `/opt/balas/supabase/.env` sebagai `FCM_SERVICE_ACCOUNT=...`
   (`base64 -w0 file-kunci.json`), lalu jalankan `deploy.sh`.

Agar APK baru bisa dipasang menimpa yang lama, tanda tangani dengan kunci tetap. Buat sekali di VPS:

```bash
docker run --rm -it -v /root:/k eclipse-temurin:21 keytool -genkeypair -v -keystore /k/balas-agen.jks \
  -alias balas -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 /root/balas-agen.jks   # isi untuk secret ANDROID_KEYSTORE_BASE64
```

Lalu buat secret `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`balas`), dan
`ANDROID_KEY_PASSWORD`. Simpan `balas-agen.jks` dan kata sandinya di tempat aman: tanpa kunci yang sama, pembaruan
harus menghapus aplikasi lama dulu.

### Chat tidak masuk?

```bash
cd /opt/balas/app && sudo ./deploy/scripts/diagnose.sh
```

Skrip ini hanya membaca dan menampilkan:
- layanan yang berjalan;
- status tiap nomor;
- pesan masuk terakhir per nomor;
- error AI;
- error terbaru dari fungsi penerima pesan dan gateway QR.

Nomor QR yang terputus juga tampil sebagai pita merah di Inbox, dan admin/supervisor mendapat notifikasi.

## 6. Update aplikasi

```bash
cd /opt/balas/app && sudo git pull && sudo ./deploy/scripts/deploy.sh
```

`deploy.sh` menjalankan migrasi database yang belum diterapkan, memasang ulang Edge Functions, dan build web app.

## 7. Backup & pemeliharaan

Backup berjalan otomatis setiap hari pukul 02:15 dan disimpan 30 hari di `/var/backups/balas`. Isinya:

- database (chat, kontak, akun, pengaturan);
- sesi nomor QR;
- file media;
- pengaturan server (`.env` berisi kunci aplikasi, Caddy, jadwal cron).

Status backup terakhir tampil di **Master Admin → Kesehatan sistem**.

### Salin backup ke Google Drive (wajib, sekali saja)

1. Buat folder di Google Drive, misalnya `Backup Balas`.
2. Masuk ke VPS lewat SSH dengan tunnel, supaya login Google bisa dibuka di browser komputer Anda:
   ```bash
   ssh -L 53682:127.0.0.1:53682 root@<IP VPS>
   ```
3. Jalankan:
   ```bash
   cd /opt/balas/app && sudo ./deploy/scripts/setup-backup.sh https://drive.google.com/drive/folders/<ID-folder>
   ```
   Pilih **A**, buka link `http://127.0.0.1:53682/auth…` yang muncul di browser komputer, lalu login Google dan izinkan.
4. Buat **kata sandi backup** (minimal 12 karakter) dan simpan di tempat aman. Semua yang diunggah ke Drive
   dienkripsi dengan kata sandi ini. **Tanpa kata sandi ini backup tidak bisa dibuka.**

Script langsung menjalankan backup pertama. Di Drive, isinya berupa folder `backups` (database, sesi QR, pengaturan;
30 hari terakhir) dan `storage` (file media). Nama dan isi file terenkripsi, jadi memang tidak bisa dibuka langsung dari
Google Drive.

Kalau tidak bisa memakai tunnel SSH: pasang [rclone](https://rclone.org/downloads) di komputer, jalankan
`rclone authorize "drive"`, login, lalu di langkah 3 pilih **B** dan tempel token yang muncul.

### Memulihkan (restore)

```bash
sudo ./deploy/scripts/restore.sh list                    # daftar backup di VPS dan di Google Drive
sudo ./deploy/scripts/restore.sh latest                  # backup terbaru di VPS ini
```

**Server baru (VPS lama hilang):**

1. Pasang Balas.id dengan `setup-vps.sh`.
2. Jalankan `setup-backup.sh` dengan folder Drive dan kata sandi backup yang **sama**.
3. Jalankan:
   ```bash
   sudo ./deploy/scripts/restore.sh latest --from-drive --with-settings
   ```
   `--with-settings` ikut memulihkan kunci aplikasi lama (enkripsi API key AI, WhatsApp/Meta, gateway QR, Firebase).
   Tanpa opsi ini, API key AI harus diisi ulang.

Data sekarang di-backup otomatis sebelum dipulihkan, jadi restore yang salah bisa dibatalkan. Uji restore di server
percobaan sebulan sekali.

### Pemantauan

- Setiap 5 menit `watchdog.sh` memeriksa:
  - layanan yang wajib jalan (database, API, functions, gateway QR); yang mati dinyalakan ulang otomatis;
  - kesehatan API;
  - disk (≥ 90% dianggap masalah);
  - umur backup.
- Masalah baru dan pemulihannya dikirim sebagai notifikasi ke Master Admin. Aktifkan lonceng di halaman Master Admin.
- **Notifikasi Telegram** (tetap terkirim walau database mati): buat bot lewat @BotFather, kirim satu pesan ke bot itu,
  lalu ambil `chat.id` dari `https://api.telegram.org/bot<TOKEN>/getUpdates`. Tambahkan dua baris ini ke
  `/opt/balas/supabase/.env`:
  ```
  ALERT_TELEGRAM_BOT_TOKEN=<token bot>
  ALERT_TELEGRAM_CHAT_ID=<chat id>
  ```
- **Pemantau dari luar (disarankan):** [UptimeRobot](https://uptimerobot.com) gratis, cek tiap 5 menit, bisa memberi
  notifikasi lewat email atau Telegram. Pantau dua alamat ini:
  - `https://app.domainanda.com`
  - `https://api.domainanda.com/functions/v1/health` (200 = sehat, 503 = database bermasalah)
- Error aplikasi (web, aplikasi HP, server) terkumpul di **Master Admin → Kesehatan sistem**.

### Lainnya

- Setiap malam (03:30) pesan yang lewat masa simpan organisasi dihapus. Riwayat aktivitas disimpan 1 tahun, catatan
  error 30 hari. Log ada di `/var/log/balas-*.log`.
- Dashboard Supabase Studio (melihat isi database): `ssh -L 8000:127.0.0.1:8000 root@<IP VPS>`, lalu buka
  `http://localhost:8000` (user/password: `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` di `.env`).

## 8. Uji beban (opsional)

Setelah nomor uji terhubung, kirim 200 pesan tiruan ke webhook untuk memastikan server kuat:

```bash
node scripts/loadtest-webhook.mjs --url https://api.domainanda.com/functions/v1/whatsapp-webhook \
  --secret "<WHATSAPP_APP_SECRET>" --phone-number-id <phone_number_id nomor uji> \
  --messages 200 --contacts 50 --concurrency 10
```

Data uji muncul sebagai kontak "Load Test …" (nomor 6289900…); hapus dari database setelah selesai.
