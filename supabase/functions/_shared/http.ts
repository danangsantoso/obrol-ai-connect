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
      console.error(err);
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
