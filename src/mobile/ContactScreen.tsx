import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { displayName, errorMessage, formatWaId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LabelPicker } from "@/components/inbox/LabelPicker";
import { TransferDialog } from "@/components/inbox/TransferDialog";
import { useLabels, useMembers, useTeams } from "@/components/inbox/useInboxData";
import { formatWhen, useSequences } from "@/components/followup/followup";
import { ORDER_STATUS, rupiah, type OrderItem } from "@/components/orders/orders";
import { Avatar, Empty, Screen, Section } from "./ui";

export default function ContactScreen() {
  const { contactId = "" } = useParams();
  const [params] = useSearchParams();
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const queryClient = useQueryClient();
  const [transfer, setTransfer] = useState(false);
  const [form, setForm] = useState({ name: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const { data: labels = [] } = useLabels(orgId);
  const { data: members = [] } = useMembers(orgId);
  const { data: teams = [] } = useTeams(orgId);
  const { data: sequences = [] } = useSequences(orgId);

  const { data: contact, isLoading } = useQuery({
    queryKey: ["contact", contactId],
    queryFn: async () => (await supabase.from("contacts").select("*").eq("id", contactId).maybeSingle()).data,
  });
  // The chat it was opened from, else the customer's latest chat.
  const { data: chat } = useQuery({
    queryKey: ["m-contact-chat", contactId, params.get("chat")],
    queryFn: async () => {
      let q = supabase.from("conversations").select("id, status, assignee_id, conversation_labels(label_id)").eq("contact_id", contactId);
      const wanted = params.get("chat");
      if (wanted) q = q.eq("id", wanted);
      return (await q.order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()).data;
    },
  });
  const { data: orders = [] } = useQuery({
    queryKey: ["m-contact-orders", contactId],
    queryFn: async () =>
      (await supabase.from("orders").select("id, number, status, total, items").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(5)).data ?? [],
  });
  const { data: followup, refetch: refetchFollowup } = useQuery({
    queryKey: ["chat-followup", chat?.id],
    enabled: Boolean(chat?.id),
    queryFn: async () =>
      (await supabase.from("followup_enrollments").select("*").eq("conversation_id", chat!.id).eq("status", "active").order("started_at", { ascending: false }).limit(1).maybeSingle()).data,
  });

  useEffect(() => {
    if (contact) setForm({ name: contact.name ?? "", notes: contact.notes ?? "" });
  }, [contact]);

  if (isLoading) return <Empty>Memuat profil…</Empty>;
  if (!contact) return <Empty>Kontak tidak ditemukan.</Empty>;

  const name = displayName(contact);
  const refreshChat = () => {
    queryClient.invalidateQueries({ queryKey: ["m-contact-chat", contactId] });
    queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
  };
  const stages = labels.filter((l) => l.in_pipeline);
  const chatLabels = chat?.conversation_labels.map((l) => l.label_id) ?? [];
  const stageIndex = stages.findIndex((s) => chatLabels.includes(s.id));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("contacts").update({ name: form.name.trim() || null, notes: form.notes.trim() || null })
      // A merged number: the name belongs to the main contact (and follows to its numbers).
      .eq("id", contact?.merged_into ?? contactId);
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Kontak disimpan");
    queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
    queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
  };
  const stopFollowup = async () => {
    if (!followup) return;
    const { error } = await supabase.rpc("followup_stop", { p_enrollment_id: followup.id });
    if (error) return toast.error(errorMessage(error));
    toast.success("Follow-up dihentikan");
    refetchFollowup();
  };
  const resolve = async () => {
    if (!chat) return;
    const next = chat.status === "resolved" ? "open" : "resolved";
    const { error } = await supabase.rpc("set_conversation_status", { conv_id: chat.id, new_status: next });
    if (error) return toast.error(errorMessage(error));
    toast.success(next === "resolved" ? "Chat ditandai selesai" : "Chat dibuka lagi");
    refreshChat();
  };

  return (
    <Screen
      back={true}
      title="Profil pelanggan"
      footer={
        chat && (
          <div className="grid grid-cols-2 gap-2.5 border-t border-slate-200 bg-white px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
            <button onClick={() => setTransfer(true)} className="min-h-[50px] rounded-2xl border border-slate-300 text-sm font-bold">
              Pindahkan ke agen
            </button>
            <button onClick={resolve} className={cn("min-h-[50px] rounded-2xl text-sm font-bold text-white", chat.status === "resolved" ? "bg-primary" : "bg-green-700")}>
              {chat.status === "resolved" ? "Buka lagi" : "Tandai selesai"}
            </button>
          </div>
        )
      }
    >
      <div className="flex flex-col items-center gap-2 border-b border-slate-200 bg-white px-4 pb-5 pt-4">
        <Avatar name={name} size={72} seed={contact.id} />
        <p className="text-xl font-extrabold">{name}</p>
        <p className="text-sm text-slate-600">{formatWaId(contact.wa_id, contact.username)}</p>
        {chat && (
          <div className="flex flex-wrap justify-center gap-2">
            <Link to={`/m/chat/${chat.id}`} className="flex min-h-[40px] items-center rounded-xl bg-primary px-4 text-sm font-bold text-white">
              Buka chat
            </Link>
          </div>
        )}
        {chat && labels.length > 0 && (
          <div className="pt-1">
            <LabelPicker conversationId={chat.id} labels={labels} selectedIds={chatLabels} onChanged={refreshChat} />
          </div>
        )}
      </div>

      <div className="space-y-3 p-4">
        {stages.length > 0 && chat && (
          <Section title="Tahap penjualan">
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
              {stages.map((s, i) => (
                <span key={s.id} className={cn("h-1.5 rounded-full", i <= stageIndex ? "bg-primary" : "bg-slate-300")} />
              ))}
            </div>
            <p className="text-[13px] font-bold">{stageIndex >= 0 ? stages[stageIndex].name : "Belum masuk pipeline"}</p>
          </Section>
        )}

        <Section title="Pesanan">
          {orders.length === 0 ? (
            <p className="text-[13px] text-slate-500">Belum ada pesanan.</p>
          ) : (
            orders.map((o) => (
              <div key={o.id} className="flex items-center gap-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{o.number}</span>
                  <span className="block truncate text-[13px] text-slate-600">
                    {(o.items as unknown as OrderItem[]).map((i) => `${i.qty}x ${i.name}`).join(", ")} · {rupiah(o.total)}
                  </span>
                </span>
                <span className={cn("rounded-lg px-2 py-1 text-xs font-bold", ORDER_STATUS[o.status]?.className)}>{ORDER_STATUS[o.status]?.label ?? o.status}</span>
              </div>
            ))
          )}
        </Section>

        {followup && (
          <Section title="Follow-up">
            <div className="flex items-center gap-2.5">
              <CalendarClock className="h-5 w-5 shrink-0 text-primary" />
              <span className="flex-1 text-[13px] leading-snug">
                <b>{sequences.find((s) => s.id === followup.sequence_id)?.name ?? "Follow-up"}</b> · lapis {followup.current_step + 1} dari {followup.steps_total},{" "}
                {formatWhen(followup.next_send_at)}
              </span>
              <button onClick={stopFollowup} className="min-h-[36px] rounded-xl border border-slate-300 px-3 text-xs font-bold">
                Hentikan
              </button>
            </div>
          </Section>
        )}

        <Section title="Data pelanggan">
          <div className="space-y-1.5">
            <label htmlFor="m-contact-name" className="text-[13px] font-semibold">
              Nama
            </label>
            <input
              id="m-contact-name"
              value={form.name}
              placeholder={contact.profile_name ?? undefined}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="h-12 w-full rounded-xl border border-slate-300 px-3.5 text-[15px] outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="m-contact-notes" className="text-[13px] font-semibold">
              Catatan tim
            </label>
            <textarea
              id="m-contact-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-[15px] outline-none focus:border-primary"
            />
          </div>
          <button onClick={save} disabled={saving} className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
          </button>
        </Section>
      </div>

      {chat && (
        <TransferDialog
          open={transfer}
          onOpenChange={setTransfer}
          conversationId={chat.id}
          currentAssigneeId={chat.assignee_id}
          members={members}
          teams={teams}
          onDone={refreshChat}
        />
      )}
    </Screen>
  );
}
