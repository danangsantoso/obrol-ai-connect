// Public REST API for other systems (websites, CRMs, Zapier/Make/n8n, scripts).
// Authenticate with an API key from Balas.id → Integrasi:
//   Authorization: Bearer blsk_...   (or X-Api-Key: blsk_...)
//
//   GET   /api/v1/channels
//   GET   /api/v1/conversations?status=&channel_id=&assignee_id=&contact_id=&limit=&before=
//   GET   /api/v1/conversations/{id}
//   PATCH /api/v1/conversations/{id}            { status?, assignee_id?, assignee_email? }
//   GET   /api/v1/conversations/{id}/messages?limit=&before=
//   POST  /api/v1/messages                      { conversation_id | channel_id + to, text | media_url | template }
//   GET   /api/v1/contacts?search=&limit=
//   POST  /api/v1/contacts                      { phone, name?, email?, company?, notes?, custom_fields? }
//   GET   /api/v1/stats
import { HttpError } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import * as ops from "../_shared/integration.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Body must be valid JSON", "invalid_json");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const url = new URL(req.url);
    // "/api/v1/conversations/x" -> ["conversations", "x"]
    const parts = url.pathname.replace(/^.*?\/api(\/v1)?/, "").split("/").filter(Boolean);
    const q = Object.fromEntries(url.searchParams);
    const admin = adminClient();
    if (parts.length === 0) {
      return respond({ name: "Balas.id API", version: "v1", docs: "https://github.com/danangsantoso/obrol-ai-connect/blob/main/docs/API.md" });
    }
    const caller = await ops.authenticateApiKey(req, admin);
    const [resource, id, sub] = parts;
    const route = `${req.method} ${resource}${id ? "/:id" : ""}${sub ? `/${sub}` : ""}`;

    switch (route) {
      case "GET channels":
        return respond({ data: await ops.listChannels(admin, caller) });
      case "GET conversations":
        return respond({ data: await ops.listConversations(admin, caller, q) });
      case "GET conversations/:id":
        return respond({ data: await ops.getConversation(admin, caller, id) });
      case "PATCH conversations/:id":
        return respond({ data: await ops.updateConversation(admin, caller, id, await body(req)) });
      case "GET conversations/:id/messages":
        return respond({ data: await ops.listMessages(admin, caller, id, q) });
      case "POST messages":
        return respond({ data: await ops.sendMessage(admin, caller, await body(req)) }, 201);
      case "GET contacts":
        return respond({ data: await ops.listContacts(admin, caller, q) });
      case "POST contacts":
        return respond({ data: await ops.upsertContact(admin, caller, await body(req)) }, 201);
      case "GET stats":
        return respond({ data: await ops.stats(admin, caller) });
      default:
        throw new HttpError(404, `Unknown endpoint: ${req.method} /${parts.join("/")}`, "not_found");
    }
  } catch (err) {
    if (err instanceof HttpError) return respond({ error: { code: err.code, message: err.message } }, err.status);
    const pg = err as { code?: string; message?: string };
    if (pg?.code === "22P02") return respond({ error: { code: "invalid_request", message: "Invalid id" } }, 400);
    console.error(err);
    return respond({ error: { code: "internal", message: "Internal error" } }, 500);
  }
});
