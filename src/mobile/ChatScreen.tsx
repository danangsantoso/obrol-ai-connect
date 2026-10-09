import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronLeft, Hand, Loader2, MoreVertical, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { callFunction, displayName, errorMessage, formatWaId, socialWindowRemainingMs, windowRemainingMs } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Timeline } from "@/components/inbox/Timeline";
import { TemplateSender } from "@/components/inbox/TemplateSender";
import { ScheduleButton, ScheduledList, SnoozeButton } from "@/components/inbox/Scheduling";
import { TransferDialog } from "@/components/inbox/TransferDialog";
import { useConversations, useMembers, useQuickReplies, useTeams, useTimeline } from "@/components/inbox/useInboxData";
import { isTakeable, memberName, type ConversationRow, type Message } from "@/components/inbox/types";
import { useAiSettings } from "@/components/ai/aiSettings";
import { aiServing } from "./helpers";
import { Avatar, Empty } from "./ui";

const CONVERSATION_SELECT =
  "*, contact:contacts!inner(id, wa_id, name, profile_name, username), channel:channels(provider, name, ai_enabled), conversation_labels(label_id)";

function mediaTypeFor(mime: string) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

// The chat from the inbox list, or loaded on its own (older chat, or opened from a notification).
function useConversation(orgId: string, id: string) {
  const { data: list = [] } = useConversations(orgId);
  const fromList = list.find((c) => c.id === id);
  const single = useQuery({
    queryKey: ["conversation", id],
    enabled: !fromList,
    queryFn: async () => {
      const { data, error } = await supabase.from("conversations").select(CONVERSATION_SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      return data as unknown as ConversationRow | null;
    },
  });
  return { conversation: fromList ?? single.data ?? null, loading: !fromList && single.isLoading };
}

export default function ChatScreen() {
  const { conversationId = "" } = useParams();
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const meId = profile!.id;
  const queryClient = useQueryClient();
  const { conversation: conv, loading } = useConversation(orgId, conversationId);
  const { items, loading: loadingItems, reloadLogs, addMessage } = useTimeline(conv?.id);
  const { data: memberList = [] } = useMembers(orgId);
  const { data: teams = [] } = useTeams(orgId);
  const { data: ai } = useAiSettings(orgId);
  const [menu, setMenu] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const members = new Map(memberList.map((m) => [m.id, m]));

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
    queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
  }, [queryClient, orgId, conversationId]);

  useEffect(() => {
    if (conv && conv.unread_count > 0) supabase.rpc("mark_conversation_read", { conv_id: conv.id }).then(refresh);
  }, [conv, refresh]);

  if (loading) return <Empty>Memuat chat…</Empty>;
  if (!conv) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-[#f4f6fb] p-8 text-center">
        <p className="text-sm text-slate-600">Chat ini tidak ditemukan atau sudah dipindahkan ke agen lain.</p>
        <Link to="/m/inbox" className="min-h-[44px] font-bold text-primary">
          Kembali ke Inbox
        </Link>
      </div>
    );
  }

  const name = displayName(conv.contact);
  const provider = conv.channel?.provider ?? "cloud_api";
  const noWindow = provider === "qr" || provider === "telegram" || provider === "webchat";
  const social = provider === "messenger" || provider === "instagram";
  const windowOpen = noWindow || (social ? socialWindowRemainingMs(conv.last_customer_message_at) > 0 : windowRemainingMs(conv.last_customer_message_at) > 0);
  const aiReady = Boolean(ai?.enabled && ai.api_key_hint);
  const aiOnNumber = aiReady && Boolean(conv.channel?.ai_enabled);
  const serving = aiServing(conv, aiReady);
  const mine = conv.assignee_id === meId;
  const takeable = isTakeable(conv, meId);
  const assignee = conv.assignee_id ? members.get(conv.assignee_id) : undefined;
  const botName = ai?.bot_name || "AI";

  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await fn();
    if (error) toast.error(errorMessage(error));
    else toast.success(ok);
    reloadLogs();
    refresh();
  };
  const claim = () => run(() => supabase.rpc("claim_conversation", { conv_id: conv.id }), "Chat ini sekarang milik Anda");
  const handToAi = () => run(() => supabase.rpc("hand_to_ai", { conv_id: conv.id }), `Chat diserahkan ke ${botName}`);
  const toggleAi = () =>
    run(() => supabase.rpc("set_conversation_ai", { conv_id: conv.id, active: !conv.ai_active }), conv.ai_active ? "AI dimatikan untuk chat ini" : "AI diaktifkan untuk chat ini");
  const setStatus = (s: ConversationRow["status"]) =>
    run(() => supabase.rpc("set_conversation_status", { conv_id: conv.id, new_status: s }), s === "resolved" ? "Chat ditandai selesai" : "Chat dibuka lagi");

  return (
    <div className="flex h-[100dvh] flex-col bg-[#eef1f6] text-slate-900">
      <header className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 pb-2 pt-[max(env(safe-area-inset-top),10px)]">
        <Link to="/m/inbox" aria-label="Kembali ke Inbox" className="flex h-11 w-11 items-center justify-center">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <Link to={`/m/kontak/${conv.contact.id}?chat=${conv.id}`} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5">
          <Avatar name={name} size={40} seed={conv.contact.id} />
          <span className="min-w-0">
            <span className="block truncate text-base font-bold">{name}</span>
            <span className="block truncate text-xs text-slate-600">
              {formatWaId(conv.contact.wa_id, conv.contact.username)}
              {conv.channel?.name ? ` · ${conv.channel.name}` : ""}
            </span>
          </span>
        </Link>
        <button aria-label="Menu chat" onClick={() => setMenu(true)} className="flex h-11 w-11 items-center justify-center">
          <MoreVertical className="h-5 w-5 text-slate-700" />
        </button>
      </header>

      {serving && (
        <Banner tone="blue" icon={<Bot className="h-5 w-5 shrink-0 text-blue-800" />} text={<><b>{botName} (AI)</b> sedang melayani chat ini</>}>
          <button onClick={claim} className="min-h-[40px] rounded-xl bg-primary px-3.5 text-[13px] font-bold text-white">
            Ambil alih
          </button>
        </Banner>
      )}
      {!serving && !conv.assignee_id && conv.status !== "resolved" && (
        <Banner tone="amber" icon={<Hand className="h-5 w-5 shrink-0 text-amber-800" />} text={conv.ai_handoff_at && conv.ai_handoff_reason ? <>AI menyerahkan: {conv.ai_handoff_reason}</> : <>Chat ini belum dipegang siapa pun</>}>
          <button onClick={claim} className="min-h-[40px] rounded-xl bg-primary px-3.5 text-[13px] font-bold text-white">
            Ambil chat
          </button>
        </Banner>
      )}
      {takeable && (
        <Banner tone="amber" text={<>Belum dibalas {memberName(assignee)}. Anda boleh mengambil alih.</>}>
          <button onClick={claim} className="min-h-[40px] rounded-xl bg-primary px-3.5 text-[13px] font-bold text-white">
            Ambil alih
          </button>
        </Banner>
      )}
      {mine && (
        <Banner tone="green" text={<><b>Anda</b> memegang chat ini{aiOnNumber ? ". AI berhenti membalas." : "."}</>}>
          {aiOnNumber && (
            <button onClick={handToAi} className="min-h-[40px] rounded-xl border border-green-300 bg-white px-3 text-[13px] font-bold text-green-900">
              Serahkan ke AI
            </button>
          )}
        </Banner>
      )}
      {conv.assignee_id && !mine && !takeable && <Banner tone="slate" text={<>Ditangani {memberName(assignee)}</>} />}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Timeline items={items} members={members} loading={loadingItems} />
      </div>

      <ScheduledList conversationId={conv.id} meId={meId} canManage={profile!.role !== "agent"} />
      {!windowOpen && provider === "cloud_api" && <TemplateSender conversationId={conv.id} orgId={orgId} onSent={addMessage} />}
      <MobileComposer
        snooze={<SnoozeButton conversation={conv} onChanged={refresh} className="h-8 rounded-full text-xs" />}
        conversationId={conv.id}
        orgId={orgId}
        userId={meId}
        contactName={name}
        windowOpen={windowOpen}
        claims={!conv.assignee_id || takeable}
        onSent={(m) => {
          addMessage(m);
          refresh();
        }}
      />

      {menu && (
        <Sheet title={name} onClose={() => setMenu(false)}>
          <SheetLink to={`/m/kontak/${conv.contact.id}?chat=${conv.id}`}>Profil pelanggan</SheetLink>
          <SheetButton
            onClick={() => {
              setMenu(false);
              setTransfer(true);
            }}
          >
            Pindahkan ke agen lain
          </SheetButton>
          {aiOnNumber && !conv.assignee_id && (
            <SheetButton onClick={() => { setMenu(false); toggleAi(); }}>{conv.ai_active ? "Matikan AI untuk chat ini" : "Aktifkan AI untuk chat ini"}</SheetButton>
          )}
          {conv.status === "resolved" ? (
            <SheetButton onClick={() => { setMenu(false); setStatus("open"); }}>Buka lagi chat ini</SheetButton>
          ) : (
            <SheetButton onClick={() => { setMenu(false); setStatus("resolved"); }} className="text-green-800">
              Tandai selesai
            </SheetButton>
          )}
        </Sheet>
      )}
      <TransferDialog
        open={transfer}
        onOpenChange={setTransfer}
        conversationId={conv.id}
        currentAssigneeId={conv.assignee_id}
        members={memberList}
        teams={teams}
        onDone={() => {
          reloadLogs();
          refresh();
        }}
      />
    </div>
  );
}

const BANNER = {
  blue: "bg-blue-100 text-blue-950",
  green: "bg-green-100 text-green-950",
  amber: "bg-amber-100 text-amber-950",
  slate: "bg-slate-200 text-slate-800",
};

function Banner({ tone, icon, text, children }: { tone: keyof typeof BANNER; icon?: React.ReactNode; text: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2.5 px-4 py-2", BANNER[tone])}>
      {icon}
      <p className="min-w-0 flex-1 text-[13px] leading-snug">{text}</p>
      {children}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-900/45" onClick={onClose}>
      <div role="dialog" aria-label={title} className="space-y-1 rounded-t-3xl bg-white px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-2.5" onClick={(e) => e.stopPropagation()}>
        <span className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-slate-300" />
        <p className="truncate px-2 pb-1 text-base font-extrabold">{title}</p>
        {children}
        <button onClick={onClose} className="mt-2 min-h-[50px] w-full rounded-2xl border border-slate-300 text-[15px] font-bold">
          Batal
        </button>
      </div>
    </div>
  );
}

export function SheetButton({ onClick, children, className }: { onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button onClick={onClick} className={cn("flex min-h-[52px] w-full items-center px-2 text-left text-[15px] font-semibold", className)}>
      {children}
    </button>
  );
}

function SheetLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex min-h-[52px] w-full items-center px-2 text-[15px] font-semibold">
      {children}
    </Link>
  );
}

function MobileComposer({
  conversationId,
  orgId,
  userId,
  contactName,
  windowOpen,
  claims,
  onSent,
  snooze,
}: {
  conversationId: string;
  orgId: string;
  userId: string;
  contactName: string;
  windowOpen: boolean;
  claims: boolean;
  onSent: (m: Message) => void;
  snooze: React.ReactNode;
}) {
  const [note, setNote] = useState(!windowOpen);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const { data: quick = [] } = useQuickReplies(orgId);

  useEffect(() => {
    if (!text && box.current) box.current.style.height = "";
  }, [text]);
  const blocked = !note && !windowOpen;

  // "/kata" picks a quick reply as you type.
  const slash = /(^|\s)\/([\w.-]*)$/.exec(text);
  const matches = slash ? quick.filter((q) => q.shortcut.toLowerCase().includes(slash[2].toLowerCase())).slice(0, 6) : quick.slice(0, 8);
  const pickQuick = (body: string) => {
    const filled = body.replace(/\{nama\}/gi, contactName);
    setText(slash ? text.slice(0, text.length - slash[2].length - 1) + filled : text ? `${text} ${filled}` : filled);
  };

  const submit = async () => {
    const typed = text;
    const body = typed.trim();
    if (sending || blocked || (!body && !file)) return;
    setSending(true);
    try {
      if (note) {
        const { error } = await supabase.from("notes").insert({ conversation_id: conversationId, organization_id: orgId, author_id: userId, body, mentions: [] });
        if (error) throw error;
      } else if (file) {
        const path = `${orgId}/outbound/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
        const upload = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
        if (upload.error) throw upload.error;
        const { message } = await callFunction<{ message: Message }>("send-message", {
          conversation_id: conversationId,
          type: mediaTypeFor(file.type),
          media_path: path,
          filename: file.name,
          text: body || undefined,
        });
        onSent(message);
      } else {
        const { message } = await callFunction<{ message: Message }>("send-message", { conversation_id: conversationId, type: "text", text: body });
        onSent(message);
      }
      // Clear what was sent but keep anything typed while it was sending.
      setText((current) => (current.startsWith(typed) ? current.slice(typed.length).trimStart() : current));
      setFile(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn("space-y-2 border-t border-slate-200 px-2.5 pb-[max(env(safe-area-inset-bottom),12px)] pt-2", note ? "bg-yellow-50" : "bg-white")}>
      {!note && matches.length > 0 && (
        <div className="-mx-2.5 flex gap-2 overflow-x-auto px-2.5 pb-0.5" aria-label="Balasan cepat">
          {matches.map((q) => (
            <button
              key={q.id}
              onClick={() => pickQuick(q.body)}
              title={q.body}
              className="min-h-[36px] shrink-0 rounded-full border border-slate-300 bg-slate-50 px-3 text-[13px] font-semibold text-slate-800"
            >
              /{q.shortcut}
            </button>
          ))}
        </div>
      )}
      {file && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <Paperclip className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button aria-label="Hapus lampiran" onClick={() => setFile(null)} className="flex h-8 w-8 items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        {!note && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <button aria-label="Lampirkan foto atau file" disabled={blocked} onClick={() => fileInput.current?.click()} className="flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40">
              <Paperclip className="h-[22px] w-[22px] text-slate-700" />
            </button>
          </>
        )}
        <label htmlFor="m-composer" className="sr-only">
          {note ? "Catatan internal" : "Pesan untuk pelanggan"}
        </label>
        <textarea
          ref={box}
          id="m-composer"
          rows={1}
          value={text}
          disabled={blocked}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
          }}
          placeholder={
            note
              ? "Catatan untuk tim (tidak terkirim)"
              : blocked
                ? "Lewat 24 jam: kirim template di atas"
                : claims
                  ? "Balas (chat jadi milik Anda)"
                  : "Tulis balasan…"
          }
          className={cn(
            "max-h-32 min-h-[44px] min-w-0 flex-1 resize-none rounded-[22px] border px-4 py-[11px] text-[15px] outline-none",
            note ? "border-yellow-600 bg-yellow-50" : "border-slate-300 bg-slate-50 focus:border-primary",
          )}
        />
        <button
          aria-label="Kirim"
          onClick={submit}
          disabled={sending || blocked || (!text.trim() && !file)}
          className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50", note ? "bg-yellow-700" : "bg-primary")}
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>
      <div className="flex gap-1.5 pl-12">
        <button
          onClick={() => setNote(false)}
          disabled={!windowOpen}
          className={cn("min-h-[32px] rounded-full px-3 text-xs font-bold disabled:opacity-40", !note ? "bg-primary text-white" : "border border-slate-300 bg-white text-slate-600")}
        >
          Balas pelanggan
        </button>
        <button
          onClick={() => setNote(true)}
          className={cn("min-h-[32px] rounded-full px-3 text-xs font-bold", note ? "bg-yellow-700 text-white" : "border border-slate-300 bg-white text-slate-600")}
        >
          Catatan internal
        </button>
        {!note && (
          <ScheduleButton
            conversationId={conversationId}
            orgId={orgId}
            userId={userId}
            text={text}
            disabled={sending || blocked || !text.trim() || Boolean(file)}
            onScheduled={() => setText("")}
          />
        )}
        <span className="ml-auto">{snooze}</span>
      </div>
    </div>
  );
}
