// MCP server (Model Context Protocol, Streamable HTTP transport, JSON responses)
// so AI assistants and agent tools can read and answer chats in Balas.id.
// URL: https://<api domain>/functions/v1/mcp — header Authorization: Bearer blsk_...
import { HttpError } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import * as ops from "../_shared/integration.ts";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const str = (description: string) => ({ type: "string", description });
const limit = { type: "integer", minimum: 1, maximum: 200, description: "Maximum number of results (default 50)" };
const read = { readOnlyHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: "list_channels",
    description: "List the organization's chat channels (WhatsApp numbers, Messenger, Instagram, Telegram, website live chat).",
    inputSchema: { type: "object", properties: {} },
    annotations: read,
  },
  {
    name: "list_conversations",
    description: "List chats, newest activity first. Each item has the contact, channel, status, assignee and last message preview.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "pending", "resolved"] },
        channel_id: str("Only chats of this channel"),
        contact_id: str("Only chats with this contact"),
        limit,
      },
    },
    annotations: read,
  },
  {
    name: "get_conversation",
    description: "Get one chat by id.",
    inputSchema: { type: "object", properties: { conversation_id: str("Chat id") }, required: ["conversation_id"] },
    annotations: read,
  },
  {
    name: "get_messages",
    description: "Read the messages of a chat, oldest first (the most recent ones up to the limit).",
    inputSchema: { type: "object", properties: { conversation_id: str("Chat id"), limit }, required: ["conversation_id"] },
    annotations: read,
  },
  {
    name: "send_message",
    description:
      "Send a message to a customer. Give conversation_id to reply in an existing chat, or channel_id + to (phone number) to start a WhatsApp chat. " +
      "Send text, or media_url (a public file URL; text becomes the caption), or a WhatsApp template for official API numbers outside the 24-hour window.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: str("Existing chat id"),
        channel_id: str("WhatsApp channel id, to start a new chat"),
        to: str("Customer phone number, e.g. 081234567890 or 6281234567890"),
        name: str("Customer name for a new contact"),
        text: str("Message text"),
        media_url: str("Public URL of an image, video, audio or document to send"),
        filename: str("File name shown to the customer"),
        template: {
          type: "object",
          description: "Approved WhatsApp template",
          properties: { name: { type: "string" }, language: { type: "string" }, parameters: { type: "array", items: { type: "string" } } },
          required: ["name", "language"],
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "update_conversation",
    description: "Change a chat's status (open, pending, resolved) and/or assign it to a team member by email.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: str("Chat id"),
        status: { type: "string", enum: ["open", "pending", "resolved"] },
        assignee_email: str("Email of the team member to assign"),
      },
      required: ["conversation_id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "search_contacts",
    description: "Find contacts by name, phone number, email or company.",
    inputSchema: { type: "object", properties: { search: str("Text to look for"), limit } },
    annotations: read,
  },
  {
    name: "upsert_contact",
    description: "Create a contact or update it by phone number (e.g. a lead from a website form).",
    inputSchema: {
      type: "object",
      properties: {
        phone: str("Phone number"),
        name: str("Name"),
        email: str("Email"),
        company: str("Company"),
        notes: str("Notes"),
      },
      required: ["phone"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_stats",
    description: "Current numbers: open, pending and unassigned chats, and chats resolved today.",
    inputSchema: { type: "object", properties: {} },
    annotations: read,
  },
];

type Args = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : undefined);

async function callTool(name: string, args: Args, caller: ops.ApiCaller) {
  const admin = adminClient();
  switch (name) {
    case "list_channels":
      return ops.listChannels(admin, caller);
    case "list_conversations":
      return ops.listConversations(admin, caller, { status: s(args.status), channel_id: s(args.channel_id), contact_id: s(args.contact_id), limit: args.limit });
    case "get_conversation":
      return ops.getConversation(admin, caller, s(args.conversation_id) ?? "");
    case "get_messages":
      return ops.listMessages(admin, caller, s(args.conversation_id) ?? "", { limit: args.limit });
    case "send_message":
      return ops.sendMessage(admin, caller, args as ops.SendRequest);
    case "update_conversation":
      return ops.updateConversation(admin, caller, s(args.conversation_id) ?? "", { status: s(args.status), assignee_email: s(args.assignee_email) });
    case "search_contacts":
      return ops.listContacts(admin, caller, { search: s(args.search), limit: args.limit });
    case "upsert_contact":
      return ops.upsertContact(admin, caller, args);
    case "get_stats":
      return ops.stats(admin, caller);
    default:
      throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

async function handle(msg: RpcRequest, caller: ops.ApiCaller): Promise<unknown> {
  switch (msg.method) {
    case "initialize": {
      const asked = s(msg.params?.protocolVersion);
      return {
        protocolVersion: asked && SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "balas-id", title: "Balas.id", version: "1.0.0" },
        instructions:
          "Balas.id is a shared customer-service inbox (WhatsApp, Messenger, Instagram, Telegram, website chat). " +
          "Read chats with list_conversations/get_messages before replying with send_message. Messages are sent to real customers.",
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = s(msg.params?.name) ?? "";
      const args = (msg.params?.arguments ?? {}) as Args;
      try {
        const result = await callTool(name, args, caller);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: Array.isArray(result) ? { items: result } : result,
          isError: false,
        };
      } catch (err) {
        if (err instanceof RpcError) throw err;
        // Tool failures are results the model can read and act on.
        const message = err instanceof HttpError ? err.message : (err as { message?: string })?.message ?? "Internal error";
        if (!(err instanceof HttpError)) console.error(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
    default:
      throw new RpcError(-32601, `Method not found: ${msg.method}`);
  }
}

function respond(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, ...(body === null ? {} : { "Content-Type": "application/json" }) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  // No server-to-client stream: GET (SSE) and DELETE (sessions) are not offered.
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { ...CORS, Allow: "POST" } });

  let caller: ops.ApiCaller;
  try {
    caller = await ops.authenticateApiKey(req, adminClient());
  } catch (err) {
    const message = err instanceof HttpError ? err.message : "Unauthorized";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="balas-id"' },
    });
  }

  let payload: RpcRequest | RpcRequest[];
  try {
    payload = await req.json();
  } catch {
    return respond({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const one = async (msg: RpcRequest) => {
    if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
    }
    if (msg.id === undefined || msg.id === null) {
      // Notification (e.g. notifications/initialized): no reply.
      return null;
    }
    try {
      return { jsonrpc: "2.0", id: msg.id, result: await handle(msg, caller) };
    } catch (err) {
      const e = err instanceof RpcError ? err : new RpcError(-32603, "Internal error");
      if (!(err instanceof RpcError)) console.error(err);
      return { jsonrpc: "2.0", id: msg.id, error: { code: e.code, message: e.message } };
    }
  };

  if (Array.isArray(payload)) {
    const replies = (await Promise.all(payload.map(one))).filter((r) => r !== null);
    return replies.length ? respond(replies) : respond(null, 202);
  }
  const reply = await one(payload);
  return reply ? respond(reply) : respond(null, 202);
});
