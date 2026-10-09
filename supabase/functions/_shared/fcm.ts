// Firebase Cloud Messaging (HTTP v1) for the Android app, without
// dependencies: the service account signs a JWT (RS256) that is exchanged for
// an access token, cached until shortly before it expires.
//
// FCM_SERVICE_ACCOUNT holds the service account JSON from the Firebase
// console (Project settings → Service accounts), as is or base64-encoded.

import { reportError } from "./http.ts";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (s: string) => new TextEncoder().encode(s);

export function serviceAccount(): ServiceAccount | null {
  const raw = (Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.startsWith("{") ? raw : new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))));
    return parsed.project_id && parsed.client_email && parsed.private_key ? parsed : null;
  } catch {
    reportError("FCM_SERVICE_ACCOUNT is not valid JSON");
    return null;
  }
}

let cached: { token: string; until: number; email: string } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.until > Date.now() + 60_000) return cached.token;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(enc(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })));
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc(`${header}.${claims}`)));
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(signature)}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`FCM token request failed (${res.status})`);
  cached = { token: body.access_token, until: Date.now() + (Number(body.expires_in) || 3600) * 1000, email: sa.client_email };
  return body.access_token;
}

export interface FcmMessage {
  title: string;
  body: string;
  url: string;
  tag: string | null;
}

// "gone" means the app was uninstalled or the token replaced (delete it).
export async function sendFcm(sa: ServiceAccount, token: string, m: FcmMessage): Promise<"ok" | "gone" | "error"> {
  try {
    const base = Deno.env.get("FCM_API_BASE") || "https://fcm.googleapis.com";
    const res = await fetch(`${base}/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: m.title, body: m.body },
          data: { url: m.url, tag: m.tag ?? "" },
          android: {
            priority: "HIGH",
            ttl: "86400s",
            notification: { channel_id: "chat", sound: "default", ...(m.tag ? { tag: m.tag } : {}) },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return "ok";
    const code = JSON.stringify(body?.error?.details ?? "");
    if (res.status === 404 || code.includes("UNREGISTERED") || (res.status === 400 && code.includes("INVALID_ARGUMENT") && /token/i.test(body?.error?.message ?? ""))) {
      return "gone";
    }
    console.error(`FCM send failed (${res.status})`, body?.error?.message);
    return "error";
  } catch (err) {
    console.error("FCM send failed", err);
    return "error";
  }
}
