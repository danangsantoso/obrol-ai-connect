// Links a regular WhatsApp number to a QR channel through the Evolution API
// gateway: shows the QR code (or a pairing code), reports the connection state
// and logs the number out.
import { HttpError, json, readJson, serveJson } from "../_shared/http.ts";
import { adminClient, audit, requireMember } from "../_shared/supabase.ts";
import * as evolution from "../_shared/evolution.ts";

interface QrRequest {
  action: "connect" | "status" | "logout";
  channel_id: string;
  // Phone number (international format, digits) to receive a pairing code instead of scanning.
  phone?: string;
}

serveJson(async (req) => {
  const admin = adminClient();
  const input = await readJson<QrRequest>(req);
  const member = await requireMember(req, admin, input.action === "status" ? undefined : ["admin"]);

  const { data: channel } = await admin
    .from("channels")
    .select("id, provider, instance_name")
    .eq("id", input.channel_id)
    .eq("organization_id", member.organization_id)
    .maybeSingle();
  if (!channel) throw new HttpError(404, "Channel not found", "not_found");
  if (channel.provider !== "qr" || !channel.instance_name) {
    throw new HttpError(400, "This number does not use QR login", "invalid_request");
  }
  const instance: string = channel.instance_name;

  const save = async (status: evolution.ConnectionStatus, phone: string | null = null) => {
    const { error } = await admin.rpc("set_channel_connection", {
      p_instance_name: instance,
      p_status: status,
      p_display_phone: phone,
    });
    if (error) throw error;
  };

  const connected = async () => {
    const owner = await evolution.ownerInfo(instance);
    await save("connected", owner.phone);
    return json({ status: "connected", phone: owner.phone, profile_name: owner.name, qr: null });
  };

  if (input.action === "status") {
    const state = await evolution.connectionState(instance);
    if (state === "open") return await connected();
    const status = evolution.mapState(state ?? undefined);
    await save(status);
    return json({ status, phone: null, qr: null });
  }

  if (input.action === "logout") {
    await evolution.logout(instance);
    await save("disconnected");
    const { data: ch } = await admin.from("channels").select("name").eq("id", channel.id).single();
    await audit(admin, member, "update", "channel", ch?.name ?? null, { connection_status: { from: "connected", to: "logout" } }, channel.id);
    return json({ status: "disconnected", phone: null, qr: null });
  }

  if (input.action !== "connect") throw new HttpError(400, "Unknown action", "invalid_request");

  const phone = input.phone?.replace(/\D/g, "").replace(/^0/, "62");
  if (input.phone !== undefined && (!phone || phone.length < 8 || phone.length > 15)) {
    throw new HttpError(400, "Nomor HP tidak valid. Contoh: 6281234567890", "invalid_request");
  }

  const state = await evolution.connectionState(instance);
  if (state === "open") return await connected();

  let qr: evolution.QrCode;
  if (phone) {
    // A pairing code is only issued when a session starts with the number.
    if (state !== null) await evolution.deleteInstance(instance);
    qr = await evolution.createInstance(instance, phone);
  } else if (state === null) {
    qr = await evolution.createInstance(instance);
  } else {
    // Polled while the QR dialog is open: returns the current code, or starts a
    // new session once the previous one expired.
    if (state === "close") await evolution.syncWebhook(instance);
    qr = await evolution.connect(instance);
  }
  await save("connecting");
  return json({ status: "connecting", phone: null, qr });
});
