import { supabase } from "@/integrations/supabase/client";

// Unexpected errors in the browser or the Android app are sent to app_errors
// (Master Admin -> Kesehatan sistem). Only for signed-in people, at most a
// few per page load, and the same error once per minute.
const MAX_PER_PAGE = 20;
const recent = new Map<string, number>();
let sent = 0;

const source = () => (/\bBalasAgen\//.test(navigator.userAgent) || location.pathname.startsWith("/m") ? "mobile" : "web");

export function reportClientError(error: unknown, extra?: string) {
  try {
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
    // Noise: aborted requests, lost connections, browser extensions.
    if (/AbortError|Failed to fetch|NetworkError|Load failed|ResizeObserver loop|chrome-extension:/i.test(`${err.name} ${err.message} ${err.stack ?? ""}`)) return;
    const key = err.message;
    const now = Date.now();
    if (sent >= MAX_PER_PAGE || now - (recent.get(key) ?? 0) < 60_000) return;
    recent.set(key, now);
    sent++;
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      return supabase.rpc("report_app_error", {
        p_source: source(),
        p_message: err.message || err.name,
        p_detail: [err.stack, extra].filter(Boolean).join("\n\n").slice(0, 4000) || null,
        p_url: location.pathname,
        p_user_agent: navigator.userAgent.slice(0, 300),
      });
    }).catch(() => {});
  } catch {
    // Reporting must never break the app.
  }
}

export function installErrorReporter() {
  window.addEventListener("error", (e) => reportClientError(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportClientError(e.reason));
}
