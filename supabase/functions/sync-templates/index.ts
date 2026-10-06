// Pulls message templates for a channel's WhatsApp Business Account from Meta.
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, requireMember } from "../_shared/supabase.ts";
import { listTemplates } from "../_shared/whatsapp.ts";

serveJson(async (req) => {
  const admin = adminClient();
  const member = await requireMember(req, admin, ["admin", "supervisor"]);
  const { channel_id } = await readJson<{ channel_id: string }>(req);

  const { data: channel } = await admin
    .from("channels")
    .select("id, organization_id, waba_id")
    .eq("id", channel_id)
    .eq("organization_id", member.organization_id)
    .maybeSingle();
  if (!channel) throw new HttpError(404, "Channel not found", "not_found");
  if (!channel.waba_id) throw new HttpError(400, "Set the WhatsApp Business Account ID first", "invalid_request");

  const templates = await listTemplates(channel.waba_id);
  if (templates.length) {
    const { error } = await admin.from("templates").upsert(
      templates.map((t) => ({
        organization_id: channel.organization_id,
        channel_id: channel.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components,
      })),
      { onConflict: "channel_id,name,language" },
    );
    if (error) throw error;
  }

  return json({ synced: templates.length });
});
