// Web Push without dependencies: VAPID (RFC 8292) and aes128gcm payload
// encryption (RFC 8291) with WebCrypto.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Bytes = Uint8Array<ArrayBuffer>;
const enc = (s: string): Bytes => new TextEncoder().encode(s) as Bytes;

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

// RFC 8291: one record, aes128gcm content coding.
export async function encryptPayload(payload: Bytes, p256dh: string, auth: string): Promise<Bytes> {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, pair.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

export interface Vapid {
  publicKey: string;
  privateKey: CryptoKey;
}

// The platform's VAPID keys, created once and kept in the database.
export async function vapidKeys(admin: SupabaseClient): Promise<Vapid> {
  let { data } = await admin.from("push_config").select("public_key, private_jwk").eq("id", 1).maybeSingle();
  if (!data) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    // Another call may have created them meanwhile: the first one wins.
    await admin.from("push_config").upsert({ id: 1, public_key: publicKey, private_jwk: jwk }, { onConflict: "id", ignoreDuplicates: true });
    ({ data } = await admin.from("push_config").select("public_key, private_jwk").eq("id", 1).single());
  }
  const privateKey = await crypto.subtle.importKey("jwk", data!.private_jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { publicKey: data!.public_key, privateKey };
}

async function vapidHeader(vapid: Vapid, endpoint: string, subject: string): Promise<string> {
  const header = b64url(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapid.privateKey, enc(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

// Browsers' push services. Anything else is refused so a registered "device"
// cannot make the server call arbitrary addresses.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/];

export function allowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    const extra = (Deno.env.get("PUSH_EXTRA_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (extra.includes(u.origin)) return true;
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// Sends one notification; "gone" means the device unsubscribed (delete it).
export async function sendPush(vapid: Vapid, target: PushTarget, message: unknown, subject: string): Promise<"ok" | "gone" | "error"> {
  if (!allowedEndpoint(target.endpoint)) return "gone";
  const body = await encryptPayload(enc(JSON.stringify(message)), target.p256dh, target.auth);
  try {
    const res = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidHeader(vapid, target.endpoint, subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "high",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}
