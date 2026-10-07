# Balas.id

Satu nomor WhatsApp untuk seluruh tim CS. Pesan pelanggan masuk ke inbox bersama, dibagi ke agen, dan seluruh percakapan tercatat di sistem.

- **Inbox bersama realtime**: tab Antrean, Saya, Semua, dan Selesai, ditambah pencarian nama, nomor, dan isi pesan.
- **Satu chat, satu pemilik**: agen mengambil chat (klaim atomik), memindahkan ke agen atau tim lain dengan catatan, dan mengubah status Open/Pending/Resolved.
- **Banyak kanal, satu inbox**: WhatsApp, Facebook Messenger, dan Instagram Direct. Messenger dan Instagram dihubungkan lewat login Facebook.
- **Dua cara menghubungkan nomor WhatsApp**: scan QR (nomor WhatsApp biasa, lewat gateway Evolution API) atau WhatsApp API resmi (Meta Cloud API). Keduanya bisa dipakai bersamaan.
- **Aturan WhatsApp 24 jam** (nomor API resmi): sisa waktu jendela layanan ditampilkan. Di luar jendela itu, balasan hanya bisa lewat template yang disetujui Meta.
- **AI Agent**: AI membalas chat otomatis (atau membuat draf untuk agen) berdasarkan katalog produk dan dokumen pengetahuan yang diunggah (PDF, Word, TXT, CSV). Pilih model sendiri: Claude, ChatGPT, DeepSeek, Gemini, atau LLM lain yang kompatibel OpenAI. Chat yang tidak bisa dijawab diserahkan ke agen.
- **Catatan internal**, profil kontak, lampiran media, dan status terkirim/dibaca.
- **Hak akses**: Admin, Supervisor, dan Agen per tim/divisi, ditegakkan dengan Row Level Security di database.
- **Self-hosted** di VPS sendiri (lihat [deploy/README.md](deploy/README.md)).

## Stack

| Bagian | Teknologi |
| --- | --- |
| Web app | React 18, Vite, TypeScript, Tailwind, shadcn/ui (warna utama biru `#2563EB`) |
| Backend | Supabase self-hosted: Postgres + RLS, Auth, Realtime, Storage |
| Integrasi WhatsApp | Edge Functions (Deno) ke WhatsApp Cloud API resmi, atau ke Evolution API (scan QR) di VPS yang sama |

```
supabase/migrations/            skema database, RLS, fungsi RPC
supabase/functions/
  whatsapp-webhook/             terima pesan & status dari Meta (verifikasi signature, idempoten)
  send-message/                 kirim teks/media/template atas nama agen
  invite-member/                admin menambah anggota tim
  sync-templates/               tarik template pesan dari Meta
  wa-qr/                        hubungkan nomor scan QR: QR/kode tautan, status, putuskan
  wa-qr-webhook/                terima pesan, status, dan koneksi dari gateway QR
  ai-reply/                     AI: balas otomatis, draf untuk agen, uji coba
  ai-admin/                     AI: simpan API key (terenkripsi), cek koneksi
  social-oauth/                 login Facebook: pilih Halaman Messenger & akun Instagram
  meta-webhook/                 terima pesan Messenger & Instagram
  _shared/                      helper bersama
src/pages/                      Dashboard, Inbox, Kontak, Tim & Agen, Pengaturan
deploy/                         Caddyfile, override docker-compose, skrip deploy & backup
```

## Menjalankan secara lokal

Butuh Node.js 20+ dan Docker.

```bash
npm ci
npx supabase start                       # Postgres, Auth, Realtime, Storage, Edge Runtime lokal
cp .env.example .env.local               # isi VITE_SUPABASE_URL=http://127.0.0.1:54321 dan ANON_KEY dari output di atas
npx supabase functions serve --env-file supabase/functions/.env   # WHATSAPP_* (lihat deploy/README.md)
npm run dev                              # http://localhost:8080
```

Daftar akun pertama, buat organisasi, lalu tambahkan nomor WhatsApp di **Pengaturan**.

Setelah mengubah skema: `npx supabase gen types typescript --local --schema public > src/integrations/supabase/types.ts`.

## Deploy

Lihat [deploy/README.md](deploy/README.md) untuk langkah-langkah memasang di VPS (Supabase self-hosted, Caddy HTTPS, webhook Meta, backup harian).
