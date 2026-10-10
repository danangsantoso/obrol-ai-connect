// Landing page → WhatsApp links (public, GET):
//   /functions/v1/wa/<slug>   records the click (Meta / Google / TikTok click
//                             ids, cookies, UTM / ad parameters), picks the
//                             number and agent in turn (CS rotator) and
//                             redirects to wa.me with
//                             the greeting plus a short code, e.g. "(#K7P2)";
//                             the chat that arrives with that code becomes an
//                             ad lead (ad_attribute_message).
//   /functions/v1/wa/t.js     optional script for the landing page: passes the
//                             page's ad parameters and Meta cookies on to
//                             every link above (the browser does not send them).
import { adminClient } from "../_shared/supabase.ts";
import { reportError } from "../_shared/http.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOT = /bot|crawl|spider|facebookexternalhit|preview|slurp|whatsapp\//i;
// Parameters copied from the landing page URL (Meta ads: add them as URL
// parameters, e.g. campaign_id={{campaign.id}}&ad_id={{ad.id}}).
const PARAMS = ["fbclid", "fbc", "fbp", "gclid", "gbraid", "wbraid", "ttclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", "lp"];

const TRACKER = `(function(){
  var keys=${JSON.stringify(PARAMS.filter((k) => k !== "lp" && k !== "fbc" && k !== "fbp"))};
  var q=new URLSearchParams(location.search),saved={};
  try{saved=JSON.parse(sessionStorage.getItem("balas_ad")||"{}")}catch(e){}
  keys.forEach(function(k){var v=q.get(k);if(v)saved[k]=v});
  try{sessionStorage.setItem("balas_ad",JSON.stringify(saved))}catch(e){}
  function cookie(n){var m=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return m?decodeURIComponent(m[1]):""}
  function decorate(a){
    try{
      var u=new URL(a.href);
      if(u.pathname.indexOf("/functions/v1/wa/")<0)return;
      Object.keys(saved).forEach(function(k){u.searchParams.set(k,saved[k])});
      var fbp=cookie("_fbp"),fbc=cookie("_fbc");
      if(fbp)u.searchParams.set("fbp",fbp);
      if(fbc)u.searchParams.set("fbc",fbc);
      u.searchParams.set("lp",location.href.split("#")[0].slice(0,400));
      a.href=u.toString();
    }catch(e){}
  }
  document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(a)decorate(a)},true);
  document.addEventListener("DOMContentLoaded",function(){document.querySelectorAll("a[href]").forEach(decorate)});
})();`;

function code() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

// Which ad platform the visitor came from: its click id first, else utm_source.
function platformOf(p: (k: string) => string | null): "meta" | "google" | "tiktok" | "other" {
  if (p("gclid") || p("gbraid") || p("wbraid")) return "google";
  if (p("ttclid")) return "tiktok";
  if (p("fbclid") || p("fbc") || p("fbp")) return "meta";
  const source = (p("utm_source") ?? "").toLowerCase();
  if (/^(google|adwords|youtube)/.test(source)) return "google";
  if (/^tiktok/.test(source)) return "tiktok";
  if (/^(facebook|fb|instagram|ig|meta)\b/.test(source)) return "meta";
  return "other";
}

function page(status: number, text: string) {
  return new Response(
    `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Balas.id</title><body style="font-family:system-ui;padding:32px;text-align:center"><p>${text}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
  const url = new URL(req.url);
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";

  if (last === "t.js") {
    return new Response(TRACKER, {
      headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
    });
  }
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(last)) return page(404, "Link tidak ditemukan.");

  try {
    const admin = adminClient();
    const { data: link } = await admin
      .from("wa_links")
      .select("id, organization_id, message, is_active")
      .eq("slug", last)
      .maybeSingle();
    if (!link?.is_active) return page(404, "Link ini sudah tidak aktif.");

    // The number to open and the agent for the chat, in turn (wa_link_pick).
    const { data: picked, error: pickError } = await admin.rpc("wa_link_pick", { p_link: link.id });
    if (pickError) throw pickError;
    const pick = (picked as { channel_id: string | null; phone: string | null; agent_id: string | null }[] | null)?.[0];
    const phone = pick?.phone ?? "";
    if (phone.length < 8) return page(503, "Nomor WhatsApp belum tersambung. Silakan coba lagi nanti.");

    const p = (k: string) => (url.searchParams.get(k) ?? "").trim().slice(0, 300) || null;
    let tag = "";
    if (!BOT.test(req.headers.get("user-agent") ?? "") && req.method === "GET") {
      const fbclid = p("fbclid");
      const utm: Record<string, string> = {};
      for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
        const v = p(k);
        if (v) utm[k] = v;
      }
      const platform = platformOf(p);
      const row = {
        organization_id: link.organization_id,
        link_id: link.id,
        platform,
        channel_id: pick?.channel_id ?? null,
        agent_id: pick?.agent_id ?? null,
        // iOS clicks carry gbraid / wbraid instead of gclid (see adplatforms.ts).
        gclid: p("gclid") ?? (p("gbraid") ? `gbraid:${p("gbraid")}` : p("wbraid") ? `wbraid:${p("wbraid")}` : null),
        ttclid: p("ttclid"),
        fbclid,
        fbc: p("fbc") ?? (fbclid ? `fb.1.${Date.now()}.${fbclid}` : null),
        fbp: p("fbp"),
        campaign_id: p("campaign_id")?.replace(/\D/g, "") || null,
        campaign_name: p("campaign_name") ?? utm.utm_campaign ?? null,
        adset_id: p("adset_id")?.replace(/\D/g, "") || null,
        adset_name: p("adset_name"),
        ad_id: p("ad_id")?.replace(/\D/g, "") || null,
        ad_name: p("ad_name") ?? utm.utm_content ?? null,
        utm,
        landing_url: p("lp") ?? req.headers.get("referer")?.slice(0, 400) ?? null,
        ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      };
      for (let i = 0; i < 6 && !tag; i++) {
        const c = code();
        const { error } = await admin.from("ad_clicks").insert({ ...row, code: c });
        if (!error) tag = ` (#${c})`;
        else if (error.code !== "23505") throw error;
      }
    }
    const text = `${link.message}${tag}`;
    return new Response(null, {
      status: 302,
      headers: { Location: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "Cache-Control": "no-store" },
    });
  } catch (err) {
    reportError("wa link failed", err);
    return page(500, "Maaf, terjadi gangguan. Silakan coba lagi.");
  }
});
