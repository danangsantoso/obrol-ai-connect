// AI agent entry points:
//  process  - answer one chat automatically (service role; started by the webhooks)
//  sweep    - pick up chats whose automatic answer was missed (service role; cron every minute)
//  suggest  - draft a reply for the agent handling a chat (members)
//  test     - try a question against the current settings and knowledge (admins, supervisors)
//  transcribe - turn a voice note into text (members who can see the chat)
import { HttpError, json, readJson, serveJson, reportError } from "../_shared/http.ts";
import { adminClient, callerClient, isServiceRole, requireMember } from "../_shared/supabase.ts";
import { answer, autoReply, cleanName, loadAi, logRun, suggest, toChat } from "../_shared/ai.ts";
import { LlmError } from "../_shared/llm.ts";
import { AUDIO_TYPES, sttConfig, transcribe } from "../_shared/media.ts";

interface AiRequest {
  action: "process" | "sweep" | "suggest" | "test" | "transcribe";
  message_id?: string;
  conversation_id?: string;
  question?: string;
  history?: { role: "customer" | "agent"; text: string }[];
  customer_name?: string;
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

// Keeps work running after the response is sent.
function inBackground(work: Promise<unknown>) {
  const guarded = work.catch((err) => reportError("ai background task failed", err));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(guarded);
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
    // Chats still marked as waiting a while after their last message, whose
    // turn is due (the AI may be giving agents a few minutes first).
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("conversations")
      .select("id")
      .not("ai_pending_message_id", "is", null)
      .lt("ai_pending_at", new Date(Date.now() - 20_000).toISOString())
      .or(`ai_due_at.is.null,ai_due_at.lte.${now}`)
      .order("ai_pending_at")
      .limit(20);
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

  if (input.action === "transcribe") {
    const member = await requireMember(req, admin);
    const { data: msg } = await admin.from("messages").select("id, organization_id, conversation_id, direction, type, body, media_path, media_mime, metadata")
      .eq("id", input.message_id ?? "").eq("organization_id", member.organization_id).maybeSingle();
    if (!msg) throw new HttpError(404, "Pesan tidak ditemukan", "not_found");
    const { data: allowed } = await callerClient(req).rpc("can_access_conversation", { conv_id: msg.conversation_id });
    if (allowed !== true) throw new HttpError(404, "Pesan tidak ditemukan", "not_found");
    if (!AUDIO_TYPES.includes(msg.type)) throw new HttpError(400, "Bukan pesan suara", "invalid_request");
    if (typeof msg.metadata?.transcript === "string") return json({ transcript: msg.metadata.transcript });
    const cfg = await sttConfig(admin, member.organization_id);
    if (!cfg) throw new HttpError(400, "Transkripsi suara belum diatur di AI Agent", "stt_not_configured");
    return json({ transcript: await transcribe(admin, cfg, msg) });
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
      const result = await answer(admin, ai, chat, "auto", { name: cleanName(input.customer_name) });
      await logRun(admin, { organization_id: member.organization_id, kind: "test", llm: ai.llm, status: result.handoff ? "handoff" : "replied", answer: result });
      return json({
        reply: result.reply,
        handoff: result.handoff,
        reason: result.reason,
        customer_name: result.customerName,
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
