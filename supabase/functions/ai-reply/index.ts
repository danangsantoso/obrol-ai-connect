// AI agent entry points:
//  process  - answer one chat automatically (service role; started by the webhooks)
//  sweep    - pick up chats whose automatic answer was missed (service role; cron every minute)
//  suggest  - draft a reply for the agent handling a chat (members)
//  test     - try a question against the current settings and knowledge (admins, supervisors)
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, callerClient, requireMember } from "../_shared/supabase.ts";
import { answer, autoReply, loadAi, logRun, suggest, toChat } from "../_shared/ai.ts";
import { LlmError } from "../_shared/llm.ts";

interface AiRequest {
  action: "process" | "sweep" | "suggest" | "test";
  conversation_id?: string;
  question?: string;
  history?: { role: "customer" | "agent"; text: string }[];
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

// Keeps work running after the response is sent.
function inBackground(work: Promise<unknown>) {
  const guarded = work.catch((err) => console.error("ai background task failed", err));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(guarded);
}

function isServiceRole(req: Request): boolean {
  const given = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

serveJson(async (req) => {
  const admin = adminClient();
  const input = await readJson<AiRequest>(req);

  if (input.action === "process" || input.action === "sweep") {
    if (!isServiceRole(req)) throw new HttpError(401, "Service role required", "unauthorized");
    if (input.action === "process") {
      if (!input.conversation_id) throw new HttpError(400, "conversation_id is required", "invalid_request");
      inBackground(autoReply(admin, input.conversation_id));
      return json({ accepted: true }, 202);
    }
    // Chats still marked as waiting a while after their last message.
    const { data, error } = await admin
      .from("conversations")
      .select("id")
      .not("ai_pending_message_id", "is", null)
      .lt("ai_pending_at", new Date(Date.now() - 20_000).toISOString())
      .order("ai_pending_at")
      .limit(10);
    if (error) throw error;
    const deadline = Date.now() + 50_000;
    inBackground((async () => {
      for (const row of data ?? []) {
        if (Date.now() > deadline - 15_000) break;
        await autoReply(admin, row.id, deadline);
      }
    })());
    return json({ accepted: true, conversations: (data ?? []).length }, 202);
  }

  if (input.action === "suggest") {
    const member = await requireMember(req, admin);
    if (!input.conversation_id) throw new HttpError(400, "conversation_id is required", "invalid_request");
    const { data: allowed, error } = await callerClient(req).rpc("can_access_conversation", { conv_id: input.conversation_id });
    if (error) throw error;
    if (!allowed) throw new HttpError(404, "Conversation not found", "not_found");
    const result = await suggest(admin, member.organization_id, input.conversation_id);
    return json({ reply: result.reply, handoff: result.handoff, reason: result.reason, sources: result.sources });
  }

  if (input.action === "test") {
    const member = await requireMember(req, admin, ["admin", "supervisor"]);
    const question = input.question?.trim();
    if (!question) throw new HttpError(400, "question is required", "invalid_request");
    const ai = await loadAi(admin, member.organization_id);
    const chat = toChat([
      ...(input.history ?? []).slice(-10).map((h) => ({
        direction: h.role === "customer" ? "inbound" as const : "outbound" as const,
        type: "text",
        body: h.text,
      })),
      { direction: "inbound", type: "text", body: question },
    ]);
    try {
      const result = await answer(admin, ai, chat, "auto");
      await logRun(admin, { organization_id: member.organization_id, kind: "test", llm: ai.llm, status: result.handoff ? "handoff" : "replied", answer: result });
      return json({
        reply: result.reply,
        handoff: result.handoff,
        reason: result.reason,
        sources: result.sources,
        handoff_message: ai.settings.handoff_message,
        usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens, latency_ms: result.latencyMs },
      });
    } catch (err) {
      if (err instanceof LlmError) {
        await logRun(admin, { organization_id: member.organization_id, kind: "test", llm: ai.llm, status: "error", error: err.message });
        throw new HttpError(502, err.message, "ai_error");
      }
      throw err;
    }
  }

  throw new HttpError(400, "Unknown action", "invalid_request");
});
