# PRD: Marketplace Karyawan AI & Aplikasi

| | |
| --- | --- |
| Status | Draft v0.1 (untuk didiskusikan) |
| Tanggal | 2026-10-07 |
| Pemilik | Danang Santoso |
| Basis | Platform Balas.id (inbox WhatsApp multi-kanal, AI Agent, REST API, webhook, MCP) |

> Dokumen ini draf awal. Bagian bertanda **[ASUMSI]** perlu dikonfirmasi; bagian **Pertanyaan Terbuka** di akhir menentukan arah MVP.

---

## 1. Ringkasan

Sebuah platform dengan dua produk dalam satu akun dan satu penagihan:

1. **Penyewaan Karyawan AI**: bisnis menyewa "karyawan" AI siap kerja (CS, sales/admin WhatsApp, rekap laporan, dll.) dengan langganan bulanan, tanpa perlu merakit prompt, integrasi, atau infrastruktur sendiri.
2. **Marketplace Aplikasi**: katalog aplikasi/tool siap pakai yang sudah dibuat pemilik platform (dan nanti developer lain) yang bisa dibeli atau dilanggan, dan bisa dipasangkan ke karyawan AI sebagai "alat kerja".

Balas.id yang sekarang sudah ada (inbox, kanal, AI Agent, RLS per tim, REST/MCP/webhook) menjadi **fondasi**: karyawan AI pertama adalah evolusi dari fitur AI Agent yang ada.

## 2. Masalah & Peluang

| Masalah pelanggan (UMKM / tim kecil) | Peluang |
| --- | --- |
| Merekrut staf CS/admin mahal dan tidak bisa 24 jam | Karyawan AI berlangganan, harga per bulan jauh di bawah gaji |
| Membuat AI agent sendiri butuh keahlian teknis (prompt, API key, integrasi) | Paket siap pakai: pilih peran, isi data bisnis, aktif |
| Aplikasi bisnis tersebar, tidak saling terhubung | Satu etalase, satu login, aplikasi bisa dipakai karyawan AI |
| Pemilik platform sudah punya banyak aplikasi tapi tidak punya kanal distribusi dan penagihan terpusat | Marketplace = distribusi + monetisasi aset yang sudah ada |

## 3. Tujuan & Non-Tujuan

**Tujuan (MVP, 3 bulan)**
- Pelanggan bisa menyewa karyawan AI dan aktif bekerja dalam < 15 menit sejak daftar.
- Pelanggan bisa membeli/berlangganan minimal 5 aplikasi dari katalog.
- Penagihan berulang otomatis (bulanan) dengan metode bayar lokal.
- Pemilik platform punya panel admin untuk mengelola katalog, harga, dan pelanggan.

**Non-tujuan (belum di MVP)**
- Developer pihak ketiga mengunggah aplikasi sendiri (fase 2).
- Karyawan AI custom buatan pelanggan yang dijual ke pelanggan lain (fase 3).
- Aplikasi mobile native.
- Pembayaran per-hasil (outcome-based) yang rumit.

## 4. Pengguna & Persona

| Persona | Kebutuhan utama |
| --- | --- |
| **Pemilik UMKM** (pembeli utama) | Murah, mudah, cepat jalan; tidak mau mengurus teknis |
| **Manajer/Supervisor tim** | Memantau kerja karyawan AI, mengambil alih chat, laporan |
| **Pemilik platform / admin** (Anda) | Kelola katalog, harga, pelanggan, pendapatan, kualitas |
| **Developer eksternal** (fase 2) | Menjual aplikasi, dapat bagi hasil |

## 5. Konsep Produk

### 5.1 Karyawan AI
Satu "karyawan" = **peran** + **kemampuan** + **pengetahuan** + **alat** + **aturan kerja**.

- **Peran siap sewa** (contoh awal): CS WhatsApp, Admin Toko/Order, Sales Follow-up, Rekap & Laporan Harian. **[ASUMSI]** mulai dari CS WhatsApp karena paling dekat dengan produk yang ada.
- **Pengetahuan**: katalog produk, dokumen (PDF/Word/TXT/CSV), FAQ (sudah ada di AI Agent).
- **Alat**: aplikasi dari marketplace, REST API, MCP, kanal (WhatsApp, IG, FB, Telegram, webchat).
- **Aturan kerja**: jam aktif, tingkat otonomi (balas otomatis / draf untuk manusia), batas eskalasi ke manusia, nada bicara.
- **Siklus hidup**: Trial → Aktif → Dijeda → Dihentikan. Bisa dijeda atau diganti kapan saja.
- **Pemantauan**: log percakapan, jumlah tugas selesai, tingkat eskalasi, kepuasan, biaya pemakaian.

### 5.2 Marketplace Aplikasi
- Katalog dengan kategori, deskripsi, tangkapan layar, harga, ulasan.
- Jenis aplikasi **[ASUMSI]**:
  - **Aplikasi mandiri** (web app yang dibuka dari dashboard, SSO).
  - **Alat untuk karyawan AI** (tool/MCP yang bisa dipanggil agen).
  - **Template** (alur kerja, balasan cepat, prompt pack).
- Model harga per aplikasi: gratis, sekali bayar, langganan bulanan, atau per pemakaian.
- Instalasi satu klik ke akun/workspace pelanggan; pencabutan akses otomatis saat berhenti langganan.

### 5.3 Hubungan keduanya
Aplikasi di marketplace dapat "dipasangkan" ke karyawan AI sehingga karyawan mendapat kemampuan baru (mis. app kasir → karyawan AI bisa cek stok & buat invoice). Ini pembeda utama dibanding marketplace biasa.

## 6. Kebutuhan Fungsional

Prioritas: **P0** wajib MVP, **P1** setelah MVP awal, **P2** nanti.

### 6.1 Akun & Workspace
- P0 Daftar/login (email), multi-user per workspace dengan peran Admin / Supervisor / Agen (sudah ada).
- P0 Satu workspace = satu bisnis; data terisolasi antar workspace (RLS).
- P1 Banyak workspace per akun; undang anggota.

### 6.2 Katalog Karyawan AI
- P0 Daftar karyawan AI: nama, peran, deskripsi, kemampuan, contoh percakapan, harga/bulan.
- P0 Halaman detail + tombol "Sewa" / "Coba gratis".
- P1 Perbandingan paket, ulasan, demo interaktif.

### 6.3 Sewa & Konfigurasi Karyawan AI
- P0 Wizard onboarding: pilih peran → isi profil bisnis → unggah pengetahuan → hubungkan kanal → uji coba → aktifkan.
- P0 Mode otonomi: auto-balas / draf / hanya saran. Batas eskalasi ke manusia (sudah ada konsep serah-terima).
- P0 Jeda, lanjutkan, hentikan, ganti peran.
- P0 Pilih model AI yang disediakan platform (tanpa pelanggan perlu punya API key) **[ASUMSI: platform menanggung biaya token, dimasukkan ke harga]**; opsional bawa API key sendiri (sudah ada).
- P1 Beberapa karyawan AI per workspace dengan pembagian kanal/tim.
- P2 Karyawan AI saling oper tugas (multi-agent).

### 6.4 Marketplace Aplikasi
- P0 Katalog + pencarian + kategori + halaman detail.
- P0 Beli/berlangganan, instalasi ke workspace, pembukaan aplikasi dengan SSO.
- P0 Pasang/lepas aplikasi ke karyawan AI sebagai alat.
- P0 Manajemen lisensi: aktif, kedaluwarsa, dibatalkan.
- P1 Ulasan & rating, kupon/promo, bundel (karyawan AI + aplikasi).
- P1 Webhook & API untuk aplikasi (memanfaatkan REST API/webhook/MCP yang ada).
- P2 Portal developer: unggah aplikasi, review/kurasi, bagi hasil, laporan pendapatan.

### 6.5 Penagihan & Pembayaran
- P0 Langganan bulanan berulang, invoice otomatis, pengingat jatuh tempo, penangguhan otomatis jika gagal bayar.
- P0 Metode bayar lokal: VA bank, QRIS, e-wallet. **[ASUMSI]** lewat payment gateway Indonesia (Midtrans / Xendit / sejenisnya), tidak membangun sendiri.
- P0 Trial gratis berbatas waktu/kuota.
- P1 Pemakaian terukur (jumlah percakapan/token) dengan kuota & top-up.
- P1 Faktur pajak/PPN, mata uang IDR saja.
- P2 Bagi hasil developer & pencairan.

### 6.6 Panel Admin Platform
- P0 CRUD karyawan AI & aplikasi (harga, status, gambar).
- P0 Daftar pelanggan, langganan, status pembayaran, impersonate untuk dukungan.
- P0 Dashboard: MRR, churn, pelanggan aktif, pemakaian token vs pendapatan.
- P1 Moderasi, pelaporan penyalahgunaan, feature flag.

### 6.7 Pemantauan & Kontrol Kualitas
- P0 Log percakapan karyawan AI dapat ditinjau; tombol ambil alih (sudah ada konsep takeover).
- P0 Notifikasi bila karyawan AI gagal/eskalasi/kuota hampir habis.
- P1 Skor kualitas, umpan balik jempol atas/bawah untuk memperbaiki prompt.

## 7. Kebutuhan Non-Fungsional

| Area | Target |
| --- | --- |
| Keamanan | Isolasi data per workspace (RLS), API key dienkripsi, audit log, SSO token berumur pendek untuk aplikasi |
| Privasi | Patuh UU PDP: persetujuan, hapus data atas permintaan, jangan melatih model dengan data pelanggan |
| Ketersediaan | 99,5% pada MVP; antrean & retry untuk webhook/pesan |
| Performa | Balasan AI p95 < 10 detik; halaman < 2 detik |
| Skalabilitas | Mulai 100 workspace, 1.000 percakapan/hari per workspace |
| Biaya | Biaya token per workspace dilacak; margin kotor ≥ 60% per paket |
| Kepatuhan kanal | Ikuti kebijakan WhatsApp/Meta (jendela 24 jam, template); peringatan risiko untuk nomor non-resmi (QR) |
| Lokalisasi | Bahasa Indonesia utama; Inggris menyusul |

## 8. Arsitektur Tingkat Tinggi

Memakai stack yang ada: React + Vite + Supabase (Postgres/RLS/Auth/Realtime/Storage) + Edge Functions (Deno).

Komponen baru yang diusulkan:

- **Tabel baru**: `plans`, `ai_employees` (definisi katalog), `employee_hires` (sewa per workspace), `apps`, `app_installs`, `licenses`, `subscriptions`, `invoices`, `usage_events`, `reviews`.
- **Edge Functions baru**: `billing-webhook` (callback payment gateway), `billing-cron` (tagihan berulang, penangguhan), `app-sso` (token masuk ke aplikasi), `usage-meter` (catat pemakaian token), `employee-runtime` (menjalankan karyawan AI; memperluas `ai-reply`).
- **Registri alat**: aplikasi mendaftarkan kemampuan sebagai tool (format MCP), karyawan AI memanggil lewat gateway dengan izin per instalasi.
- **Pemisahan**: penagihan dan lisensi sebagai modul sendiri agar bisa dipakai ulang oleh aplikasi-aplikasi lain.

```
Pelanggan ──> Web App (Katalog, Wizard, Dashboard)
                 │
                 ├─ Supabase (Auth, DB+RLS, Realtime, Storage)
                 ├─ employee-runtime ──> LLM provider
                 │        └─ tool gateway ──> Aplikasi marketplace (MCP/REST)
                 ├─ Kanal: WhatsApp / IG / FB / Telegram / Webchat (sudah ada)
                 └─ Billing ──> Payment gateway (webhook ↔ billing-webhook)
```

## 9. Model Bisnis & Harga (usulan awal)

**[ASUMSI]**, perlu divalidasi dengan riset harga.

- Karyawan AI: langganan bulanan per karyawan (mis. tiga tingkat: Starter / Pro / Business) dengan kuota percakapan; kelebihan kuota ditagih per paket top-up.
- Aplikasi: gratis / sekali bayar / bulanan, ditetapkan per aplikasi.
- Bundel: karyawan AI + beberapa aplikasi dengan diskon.
- Fase 2: komisi platform atas aplikasi developer lain (mis. 20–30%).
- Biaya variabel utama: token LLM, biaya gateway WhatsApp, hosting. Harga harus memasukkan margin atas token.

## 10. Metrik Keberhasilan

| Metrik | Target 3 bulan setelah rilis |
| --- | --- |
| Workspace terdaftar | 200 |
| Konversi trial → berbayar | ≥ 15% |
| Waktu sampai karyawan AI aktif | median < 15 menit |
| Churn bulanan | < 8% |
| Percakapan yang diselesaikan AI tanpa manusia | ≥ 60% |
| Skor kepuasan percakapan (CSAT) | ≥ 4,0 / 5 |
| MRR | tentukan setelah harga final |

## 11. Risiko & Mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Biaya token membengkak melebihi pendapatan | Kuota per paket, batas harian, pemantauan per workspace, model hemat untuk tugas ringan |
| Nomor WhatsApp non-resmi (QR) diblokir Meta | Peringatan jelas, dorong Cloud API resmi untuk paket berbayar |
| AI salah menjawab / halusinasi merugikan bisnis | Mode draf default, batas eskalasi, jawaban hanya dari basis pengetahuan, log & takeover |
| Kualitas aplikasi pihak ketiga rendah/berbahaya | MVP hanya aplikasi milik sendiri; fase 2 ada kurasi, sandbox, izin per tool |
| Kebocoran data antar pelanggan | RLS ketat, uji penetrasi, audit log |
| Kepatuhan UU PDP | Kebijakan privasi, perjanjian pemrosesan data, fitur hapus data |
| Terlalu banyak aplikasi sulit dirawat | Pilih 5–10 aplikasi terbaik dulu, standar integrasi seragam |

## 12. Rencana Rilis

| Fase | Isi | Perkiraan |
| --- | --- | --- |
| **0. Discovery** | Daftar aplikasi yang sudah ada, pilih kandidat, validasi harga dengan 10 calon pelanggan | 2 minggu |
| **1. MVP** | Katalog, sewa 1–2 karyawan AI (CS WhatsApp), 5 aplikasi pertama, penagihan berulang, panel admin | 8–10 minggu |
| **2. Marketplace terbuka** | Portal developer, kurasi, bagi hasil, ulasan, bundel | +8 minggu |
| **3. Ekosistem** | Karyawan AI buatan komunitas, multi-agent, aplikasi mobile | menyusul |

## 13. Pertanyaan Terbuka (perlu jawaban Anda)

1. **Target pasar**: UMKM Indonesia, atau perusahaan menengah? Ini menentukan harga, bahasa, dan metode bayar.
2. **Karyawan AI** mau jenis apa saja di awal? (CS, sales, admin order, akuntansi, HR, konten, dll.)
3. **Aplikasi yang sudah ada**: berapa jumlahnya, teknologinya apa (stack), dan apakah punya login/database masing-masing? Ini menentukan seberapa sulit SSO dan instalasi satu klik.
4. **Apakah marketplace nanti terbuka untuk developer lain**, atau hanya aplikasi milik Anda?
5. **Model pembayaran**: langganan bulanan saja, atau juga sekali bayar dan per pemakaian?
6. **Siapa menanggung biaya token AI**: platform (masuk harga) atau pelanggan bawa API key sendiri?
7. **Satu repo ini atau produk baru?** Usulan: kembangkan di repo ini sebagai fondasi, bagian marketplace/penagihan dibuat modular.
8. **Payment gateway** pilihan Anda (Midtrans, Xendit, lainnya)?
9. **Aplikasi dijalankan di mana**: di infrastruktur Anda (multi-tenant) atau di server pelanggan?
10. **Nama produk & merek**: tetap Balas.id atau merek baru?

## 14. Langkah Berikutnya

1. Anda jawab pertanyaan terbuka (terutama 1, 3, 4, 6).
2. Saya revisi PRD ke v0.2 dan menambahkan daftar aplikasi yang akan masuk MVP.
3. Setelah disetujui: rancang skema database (migrasi Supabase) dan alur UI (wireframe), lalu mulai bangun MVP dalam sprint kecil.
