// Sends an agent's reply to the customer and records it in the conversation.
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, callerClient, requireMember } from "../_shared/supabase.ts";
import { type SendInput, sendToConversation } from "../_shared/send.ts";

interface SendRequest extends SendInput {
  conversation_id: string;
}

serveJson(async (req) => {
  const admin = adminClient();
  const member = await requireMember(req, admin);
  const input = await readJson<SendRequest>(req);

  if (!input.conversation_id) throw new HttpError(400, "conversation_id is required", "invalid_request");

  // Same access rule the inbox uses, evaluated as the caller.
  const { data: allowed, error: accessError } = await callerClient(req).rpc("can_access_conversation", {
    conv_id: input.conversation_id,
  });
  if (accessError) throw accessError;
  if (!allowed) throw new HttpError(404, "Conversation not found", "not_found");

  const message = await sendToConversation(admin, input.conversation_id, input, member.id);
  return json({ message });
});
