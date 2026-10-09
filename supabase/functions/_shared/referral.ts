// The ad a customer clicked before their first message, as each platform
// reports it, in one shape (messages.metadata.referral). The database turns a
// message carrying it into an ad lead (ad_attribute_message).
/* eslint-disable @typescript-eslint/no-explicit-any -- raw webhook payloads */
export interface Referral {
  source_type: string;
  source_id: string | null;
  source_url: string | null;
  headline: string | null;
  body: string | null;
  media_url: string | null;
  ctwa_clid: string | null;
}

const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : null);

// WhatsApp Cloud API: messages[].referral on the first message from a click-to-WhatsApp ad.
export function cloudReferral(message: any): Referral | null {
  const r = message?.referral;
  if (!r || typeof r !== "object") return null;
  return {
    source_type: str(r.source_type, 20) ?? "ad",
    source_id: str(r.source_id, 40),
    source_url: str(r.source_url),
    headline: str(r.headline, 300),
    body: str(r.body),
    media_url: str(r.image_url) ?? str(r.video_url) ?? str(r.thumbnail_url),
    ctwa_clid: str(r.ctwa_clid, 300),
  };
}

// QR numbers (Baileys via Evolution): contextInfo.externalAdReply. Link
// previews use the same field, so only an ad (or a click id) counts.
export function qrReferral(data: any, message: any, type: string | undefined): Referral | null {
  const ctx = data?.contextInfo ?? (type ? message?.[type]?.contextInfo : null) ?? {};
  const ad = ctx.externalAdReply ?? {};
  const clid = str(ad.ctwaClid ?? ctx.ctwaClid, 300);
  const fromAd = String(ad.sourceType ?? "").toLowerCase() === "ad" || Boolean(clid) ||
    /ctwa|ad/i.test(String(ctx.entryPointConversionSource ?? ctx.conversionSource ?? ""));
  if (!fromAd) return null;
  return {
    source_type: "ad",
    source_id: str(ad.sourceId, 40),
    source_url: str(ad.sourceUrl),
    headline: str(ad.title, 300),
    body: str(ad.body),
    media_url: str(ad.thumbnailUrl) ?? str(ad.mediaUrl),
    ctwa_clid: clid,
  };
}

// Messenger / Instagram: referral (source ADS) on the message that starts a
// conversation from a click-to-Messenger/Instagram ad.
export function metaReferral(event: any): Referral | null {
  const r = event?.message?.referral ?? event?.referral;
  if (!r || String(r.source ?? "").toUpperCase() !== "ADS") return null;
  return {
    source_type: "ad",
    source_id: str(r.ad_id, 40),
    source_url: str(r.ads_context_data?.post_id ? `https://www.facebook.com/${r.ads_context_data.post_id}` : null),
    headline: str(r.ads_context_data?.ad_title, 300),
    body: null,
    media_url: str(r.ads_context_data?.photo_url) ?? str(r.ads_context_data?.video_url),
    ctwa_clid: null,
  };
}
