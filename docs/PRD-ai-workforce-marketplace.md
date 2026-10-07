# PRD: Platform Sewa Karyawan AI & Marketplace Aplikasi

| | |
| --- | --- |
| Status | Draft v0.2 (produk baru, terpisah dari Balas.id) |
| Tanggal | 2026-10-07 |
| Pemilik | Danang Santoso |

> Bagian bertanda **[ASUMSI]** perlu dikonfirmasi. Bagian **Pertanyaan Terbuka** di akhir menentukan arah MVP.

---

## 1. Ringkasan

Satu platform dengan dua produk dalam satu akun dan satu penagihan:

1. **Sewa Karyawan AI**: bisnis menyewa "karyawan" AI siap kerja (mis. CS, admin, sales, laporan) dengan langganan, tanpa merakit prompt, integrasi, atau infrastruktur sendiri.
2. **Marketplace Aplikasi**: katalog aplikasi siap pakai yang sudah dibuat pemilik platform, bisa dibeli atau dilanggan, dan bisa dipasang ke karyawan AI sebagai alat kerja.

Pembeda: aplikasi di marketplace menjadi "tangan" karyawan AI. Karyawan AI bukan sekadar chatbot, tapi bisa mengerjakan tugas lewat aplikasi yang terpasang.

## 2. Masalah & Peluang

| Masalah | Peluang |
| --- | --- |
| Merekrut staf mahal dan tidak bisa 24 jam | Karyawan AI berlangganan, jauh di bawah biaya gaji |
| Membuat AI agent sendiri butuh keahlian teknis | Paket siap pakai: pilih peran, isi data bisnis, aktif |
| Aplikasi bisnis tersebar dan tidak saling terhubung | Satu etalase, satu login, aplikasi bisa dipakai karyawan AI |
| Anda punya banyak aplikasi tapi belum punya kanal distribusi dan penagihan terpusat | Marketplace = distribusi + monetisasi aset yang ada |

## 3. Tujuan & Non-Tujuan

**Tujuan MVP (sekitar 3 bulan)**
- Pelanggan menyewa karyawan AI dan aktif bekerja dalam < 15 menit sejak daftar.
- Pelanggan bisa membeli/berlangganan minimal 5 aplikasi dari katalog.
- Penagihan berulang otomatis dengan metode bayar lokal.
- Panel admin untuk mengelola katalog, harga, dan pelanggan.

**Non-tujuan (belum di MVP)**
- Developer pihak ketiga mengunggah aplikasi (fase 2).
- Karyawan AI buatan pelanggan yang dijual ke pelanggan lain (fase 3).
- Aplikasi mobile native.

## 4. Persona

| Persona | Kebutuhan utama |
| --- | --- |
| Pemilik bisnis (pembeli) | Murah, mudah, cepat jalan, tanpa urusan teknis |
| Manajer/supervisor | Memantau kerja karyawan AI, mengambil alih bila perlu, laporan |
| Pemilik platform / admin | Kelola katalog, harga, pelanggan, pendapatan, kualitas |
| Developer eksternal (fase 2) | Menjual aplikasi dan mendapat bagi hasil |

## 5. Konsep Produk

### 5.1 Karyawan AI
Satu karyawan = **peran** + **pengetahuan** + **alat** + **aturan kerja**.

- **Peran siap sewa** **[ASUMSI]**: CS, admin order, sales follow-up, rekap & laporan. Peran awal dipilih setelah Anda menjawab pertanyaan 2.
- **Pengetahuan**: profil bisnis, katalog, dokumen (PDF/Word/TXT/CSV), FAQ.
- **Alat**: aplikasi dari marketplace dan integrasi (API, MCP), serta kanal komunikasi yang dipilih (lihat pertanyaan 3).
- **Aturan kerja**: jam aktif, tingkat otonomi (jalan otomatis / draf untuk disetujui manusia), batas eskalasi ke manusia, gaya bahasa.
- **Siklus hidup**: Trial → Aktif → Dijeda → Dihentikan.
- **Pemantauan**: log aktivitas, tugas selesai, tingkat eskalasi, kepuasan, biaya pemakaian.

### 5.2 Marketplace Aplikasi
- Katalog: kategori, deskripsi, tangkapan layar, harga, ulasan.
- Jenis aplikasi **[ASUMSI]**: (a) aplikasi mandiri yang dibuka dari dashboard dengan SSO, (b) alat untuk karyawan AI, (c) template/alur kerja.
- Harga: gratis, sekali bayar, langganan bulanan, atau per pemakaian.
- Instalasi satu klik ke workspace pelanggan; akses dicabut otomatis saat langganan berhenti.

### 5.3 Hubungan keduanya
Aplikasi dapat dipasang ke karyawan AI untuk menambah kemampuan. Contoh: aplikasi kasir terpasang, karyawan AI bisa cek stok dan membuat invoice.

## 6. Kebutuhan Fungsional

Prioritas: **P0** wajib MVP, **P1** setelah MVP, **P2** nanti.

### 6.1 Akun & Workspace
- P0 Daftar/login, satu workspace per bisnis, multi-user dengan peran Admin / Supervisor / Anggota.
- P0 Data terisolasi antar workspace.
- P1 Banyak workspace per akun.

### 6.2 Katalog Karyawan AI
- P0 Daftar karyawan: nama, peran, kemampuan, contoh hasil kerja, harga.
- P0 Halaman detail, tombol "Sewa" dan "Coba gratis".
- P1 Perbandingan paket, ulasan, demo interaktif.

### 6.3 Sewa & Konfigurasi
- P0 Wizard: pilih peran → isi profil bisnis → unggah pengetahuan → pasang aplikasi/kanal → uji coba → aktifkan.
- P0 Mode otonomi dan batas eskalasi ke manusia.
- P0 Jeda, lanjutkan, hentikan, ganti peran.
- P0 Model AI disediakan platform **[ASUMSI: biaya token masuk ke harga]**; opsi bawa API key sendiri di P1.
- P1 Beberapa karyawan AI per workspace.
- P2 Karyawan AI saling oper tugas.

### 6.4 Marketplace Aplikasi
- P0 Katalog, pencarian, kategori, detail aplikasi.
- P0 Beli/langganan, instalasi ke workspace, buka aplikasi dengan SSO.
- P0 Pasang/lepas aplikasi ke karyawan AI.
- P0 Manajemen lisensi: aktif, kedaluwarsa, dibatalkan.
- P1 Ulasan, kupon, bundel (karyawan + aplikasi).
- P1 API/webhook untuk aplikasi.
- P2 Portal developer: unggah, kurasi, bagi hasil, laporan pendapatan.

### 6.5 Penagihan & Pembayaran
- P0 Langganan bulanan berulang, invoice otomatis, pengingat, penangguhan otomatis jika gagal bayar.
- P0 Metode bayar lokal: VA bank, QRIS, e-wallet lewat payment gateway **[ASUMSI: Midtrans/Xendit atau sejenis]**.
- P0 Trial gratis berbatas waktu/kuota.
- P1 Pemakaian terukur dengan kuota dan top-up.
- P1 PPN/faktur pajak.
- P2 Bagi hasil developer dan pencairan.

### 6.6 Panel Admin Platform
- P0 CRUD karyawan AI dan aplikasi (harga, status, gambar).
- P0 Daftar pelanggan, langganan, status bayar, akses bantuan untuk dukungan.
- P0 Dashboard: MRR, churn, pelanggan aktif, biaya token vs pendapatan.
- P1 Moderasi dan pelaporan penyalahgunaan.

### 6.7 Pemantauan & Kualitas
- P0 Log aktivitas karyawan AI bisa ditinjau, tombol ambil alih.
- P0 Notifikasi saat karyawan gagal, eskalasi, atau kuota hampir habis.
- P1 Umpan balik jempol atas/bawah untuk perbaikan.

## 7. Kebutuhan Non-Fungsional

| Area | Target |
| --- | --- |
| Keamanan | Isolasi data per workspace, kredensial terenkripsi, audit log, token SSO berumur pendek |
| Privasi | Patuh UU PDP, hapus data atas permintaan, data pelanggan tidak dipakai melatih model |
| Ketersediaan | 99,5% di MVP; antrean dan retry untuk tugas dan webhook |
| Performa | Respons AI p95 < 10 detik; halaman < 2 detik |
| Skala awal | 100 workspace |
| Biaya | Biaya token dilacak per workspace; margin kotor ≥ 60% per paket |
| Bahasa | Indonesia dulu, Inggris menyusul |

## 8. Arsitektur Tingkat Tinggi (usulan, stack belum diputuskan)

Komponen logis, apa pun stack-nya:

- **Web app**: katalog, wizard, dashboard pelanggan, panel admin.
- **Auth & workspace**: multi-tenant dengan isolasi data per workspace.
- **Runtime karyawan AI**: menjalankan agen, memanggil LLM, memakai alat.
- **Tool gateway**: aplikasi mendaftarkan kemampuan sebagai tool (mis. format MCP); izin per instalasi.
- **Penagihan & lisensi**: langganan, invoice, entitlement, webhook payment gateway, penangguhan otomatis.
- **SSO aplikasi**: token berumur pendek untuk membuka aplikasi dari dashboard.
- **Pencatatan pemakaian**: token dan tugas per workspace untuk kuota dan margin.

Entitas data utama: `workspaces`, `members`, `ai_employees` (katalog), `employee_hires`, `apps`, `app_installs`, `licenses`, `subscriptions`, `invoices`, `usage_events`, `reviews`.

## 9. Model Bisnis & Harga (usulan awal)

**[ASUMSI]**, perlu validasi riset harga.

- Karyawan AI: langganan bulanan per karyawan, tiga tingkat (Starter / Pro / Business) dengan kuota; kelebihan kuota lewat top-up.
- Aplikasi: gratis / sekali bayar / bulanan, ditetapkan per aplikasi.
- Bundel karyawan + aplikasi dengan diskon.
- Fase 2: komisi platform atas aplikasi developer lain (mis. 20–30%).
- Biaya variabel utama: token LLM, biaya kanal, hosting.

## 10. Metrik Keberhasilan (3 bulan setelah rilis)

| Metrik | Target |
| --- | --- |
| Workspace terdaftar | 200 |
| Konversi trial → berbayar | ≥ 15% |
| Waktu sampai karyawan aktif | median < 15 menit |
| Churn bulanan | < 8% |
| Tugas selesai AI tanpa manusia | ≥ 60% |
| Kepuasan (CSAT) | ≥ 4,0 / 5 |

## 11. Risiko & Mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Biaya token melebihi pendapatan | Kuota per paket, batas harian, pemantauan, model hemat untuk tugas ringan |
| AI salah/berhalusinasi merugikan bisnis | Mode draf default, batas eskalasi, jawaban dari basis pengetahuan, log dan ambil alih |
| Aplikasi pihak ketiga berbahaya | MVP hanya aplikasi milik sendiri; fase 2 ada kurasi, sandbox, izin per tool |
| Kebocoran data antar pelanggan | Isolasi data ketat, uji penetrasi, audit log |
| Kepatuhan UU PDP | Kebijakan privasi, perjanjian pemrosesan data, fitur hapus data |
| Aplikasi lama sulit diintegrasikan (SSO, lisensi) | Audit aplikasi di fase discovery, standar integrasi seragam, mulai 5–10 aplikasi terbaik |

## 12. Rencana Rilis

| Fase | Isi | Perkiraan |
| --- | --- | --- |
| 0. Discovery | Inventarisasi aplikasi, pilih kandidat, validasi harga dengan ±10 calon pelanggan | 2 minggu |
| 1. MVP | Katalog, 1–2 karyawan AI, 5 aplikasi, penagihan berulang, panel admin | 8–10 minggu |
| 2. Marketplace terbuka | Portal developer, kurasi, bagi hasil, ulasan, bundel | +8 minggu |
| 3. Ekosistem | Karyawan AI buatan komunitas, multi-agent, mobile | menyusul |

## 13. Pertanyaan Terbuka

1. **Target pasar**: UMKM Indonesia atau perusahaan menengah?
2. **Karyawan AI** jenis apa saja di awal (CS, sales, admin order, akuntansi, HR, konten, dll.)?
3. **Karyawan AI bekerja lewat apa**: chat (WhatsApp/web), di dalam aplikasi, lewat email, atau otomatis di belakang layar?
4. **Aplikasi yang sudah ada**: jumlah, stack, dan apakah masing-masing punya login/database sendiri? Ini menentukan tingkat kesulitan SSO dan instalasi satu klik.
5. **Marketplace** hanya untuk aplikasi Anda, atau nanti terbuka untuk developer lain?
6. **Pembayaran**: langganan bulanan saja, atau juga sekali bayar dan per pemakaian?
7. **Biaya token AI**: ditanggung platform (masuk harga) atau pelanggan bawa API key sendiri?
8. **Hosting aplikasi**: di infrastruktur Anda (multi-tenant) atau di server pelanggan?
9. **Stack dan repo**: pakai stack apa untuk platform ini, dan dibuat di repo baru?
10. **Payment gateway** dan **nama/merek** produk.

## 14. Langkah Berikutnya

1. Anda jawab pertanyaan terbuka (prioritas 1, 3, 4, 5, 7).
2. Saya revisi ke v0.3 dengan daftar aplikasi MVP dan pilihan stack.
3. Setelah disetujui: rancang skema database dan wireframe, lalu bangun MVP per sprint.
