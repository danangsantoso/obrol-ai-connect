export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Wraps a POST handler with CORS preflight handling and uniform error responses:
// { "error": { "code": "...", "message": "..." } }
export function serveJson(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: { code: "method_not_allowed", message: "Use POST" } }, 405);
    }
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: { code: err.code, message: err.message } }, err.status);
      }
      reportError("internal error", err);
      return json({ error: { code: "internal", message: "Internal error" } }, 500);
    }
  });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Body must be valid JSON", "invalid_json");
  }
}

// A database error caused by the data itself (a bad value, a broken
// constraint): retrying the same webhook would fail again, so such a message
// is logged and skipped instead of holding back the rest of the batch.
export function isDataError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && /^(22|23)/.test(code);
}

// Logs an unexpected error and records it in app_errors (Master Admin ->
// Kesehatan sistem), grouped by where it happened. Never throws.
export function reportError(context: string, err?: unknown): void {
  console.error(context, err ?? "");
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) return;
  const message = err instanceof Error ? `${context}: ${err.message}` : err && typeof err === "object" && "message" in err ? `${context}: ${String((err as { message: unknown }).message)}` : context;
  const detail = err instanceof Error ? (err.stack ?? err.message) : err === undefined ? null : typeof err === "object" ? JSON.stringify(err) : String(err);
  const sent = fetch(`${base}/rest/v1/rpc/report_app_error`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_source: "function", p_message: message, p_detail: detail, p_url: context }),
  }).then((res) => res.body?.cancel()).catch(() => {});
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(sent);
}
