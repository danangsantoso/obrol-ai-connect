# Balas.id API, Webhook & MCP

Hubungkan Balas.id dengan sistem lain. Semua dibuat oleh **admin** di menu **Integrasi**.

| Kebutuhan | Pakai |
|---|---|
| Pengunjung website chat dengan CS | Live chat widget (Pengaturan → Kanal chat) |
| Sistem Anda mengirim WhatsApp / menyimpan lead / membaca chat | REST API |
| Sistem Anda diberi tahu saat ada pesan masuk, chat selesai, dll. | Webhook |
| Asisten AI (Claude, ChatGPT, Cursor, n8n AI agent) membaca & membalas chat | MCP |

## Autentikasi

Buat API key di **Integrasi → API key** (`blsk_...`, hanya ditampilkan sekali). Kirim di header:

```
Authorization: Bearer blsk_...
```

(atau `X-Api-Key: blsk_...`). Key berlaku untuk seluruh organisasi: simpan di server, jangan di kode
website yang terlihat pengunjung. Cabut key dari halaman yang sama.

## REST API

Base URL: `https://<domain API>/functions/v1/api/v1`. Respons: `{ "data": ... }`; galat:
`{ "error": { "code", "message" } }` dengan status HTTP 400/401/404/422/500.

| Method | Path | Isi |
|---|---|---|
| GET | `/channels` | Daftar kanal (WhatsApp, Messenger, Instagram, Telegram, live chat) |
| GET | `/conversations` | Query: `status` (open/pending/resolved), `channel_id`, `assignee_id`, `contact_id`, `limit` (≤200), `before` (ISO, untuk halaman berikutnya) |
| GET | `/conversations/{id}` | Satu chat |
| PATCH | `/conversations/{id}` | `{ "status": "resolved" }` dan/atau `{ "assignee_email": "agen@toko.com" }` (atau `assignee_id`, `null` = kembali ke antrean) |
| GET | `/conversations/{id}/messages` | Pesan, terlama dulu. Query: `limit`, `before` |
| POST | `/messages` | Kirim pesan (lihat di bawah) |
| GET | `/contacts` | Query: `search`, `limit` |
| POST | `/contacts` | Buat/perbarui kontak per nomor: `phone`, `name`, `email`, `company`, `notes`, `custom_fields` |
| GET | `/stats` | Jumlah chat open, pending, belum di-assign, selesai hari ini |

### Mengirim pesan

```json
{ "conversation_id": "…", "text": "Halo kak" }
```

Memulai chat WhatsApp baru ke nomor (kanal WhatsApp QR: pesan apa pun; WhatsApp API resmi: template):

```json
{ "channel_id": "…", "to": "081234567890", "name": "Rina", "text": "Pesanan #123 sudah dikirim" }
{ "channel_id": "…", "to": "081234567890", "template": { "name": "order_update", "language": "id", "parameters": ["#123"] } }
```

File: `"media_url": "https://…/invoice.pdf"` (maks. 16 MB, `text` menjadi caption, `filename` opsional).
Pesan dari API tercatat di Inbox dengan sumber `api`. Nomor `08…`, `+62…`, dan `8…` otomatis menjadi `628…`.

## Webhook

Tambahkan URL di **Integrasi → Webhook**, pilih event (kosong = semua):

`message.received`, `message.sent`, `conversation.created`, `conversation.assigned`,
`conversation.resolved`, `conversation.status_changed`, `contact.created`, dan `ping` (tombol *Kirim uji*).

Setiap event dikirim sebagai `POST` JSON:

```json
{
  "id": "<delivery id>",
  "event": "message.received",
  "organization_id": "…",
  "created_at": "2026-10-07T12:00:00Z",
  "data": {
    "message": { "id": "…", "direction": "inbound", "type": "text", "text": "Halo", "source": "customer", "created_at": "…" },
    "conversation": {
      "id": "…", "status": "open", "assignee": null,
      "contact": { "id": "…", "wa_id": "6281234567890", "name": "Rina" },
      "channel": { "id": "…", "provider": "qr", "name": "CS Utama" }
    }
  }
}
```

Header: `X-Balas-Event`, `X-Balas-Delivery`, dan `X-Balas-Signature: t=<detik unix>,v1=<hex>` dengan
`v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. Secret ada di halaman Integrasi. Balas 2xx dalam 10 detik;
jika gagal dicoba lagi setelah 1, 5, 15, 60, dan 240 menit. Riwayat pengiriman disimpan 14 hari.

```js
const crypto = require("crypto");
function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

## MCP (Model Context Protocol)

URL: `https://<domain API>/functions/v1/mcp` (Streamable HTTP), header `Authorization: Bearer blsk_...`.

Claude Code:

```bash
claude mcp add --transport http balas https://<domain API>/functions/v1/mcp --header "Authorization: Bearer blsk_..."
```

Klien lain:

```json
{ "mcpServers": { "balas": { "type": "http", "url": "https://<domain API>/functions/v1/mcp",
  "headers": { "Authorization": "Bearer blsk_..." } } } }
```

Tool: `list_channels`, `list_conversations`, `get_conversation`, `get_messages`, `send_message`,
`update_conversation`, `search_contacts`, `upsert_contact`, `get_stats`. Pesan yang dikirim lewat MCP
sampai ke pelanggan sungguhan.
