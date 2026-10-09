import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, isToday, isYesterday } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Search, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { displayName } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConversations, useMembers, useMessageSearch } from "@/components/inbox/useInboxData";
import { isTakeable, memberName, type ConversationRow, type Member } from "@/components/inbox/types";
import { useAiSettings } from "@/components/ai/aiSettings";
import { Avatar, BottomNav, ChannelBadge, Empty, Screen, Segmented } from "./ui";
import { aiServing } from "./helpers";
import { DisconnectedBanner } from "@/components/inbox/DisconnectedBanner";
import { formatWhen, isSnoozed } from "@/components/inbox/Scheduling";

type Tab = "mine" | "queue" | "ai";

const STATUS_DOT: Record<string, string> = { online: "bg-green-600", away: "bg-amber-500", offline: "bg-slate-400" };
const STATUS_TEXT: Record<string, [string, string]> = {
  online: ["Online · menerima chat", "text-green-700"],
  away: ["Istirahat · tidak menerima chat baru", "text-amber-700"],
  offline: ["Offline · ketuk foto untuk mulai menerima chat", "text-slate-500"],
};

function listTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH.mm");
  if (isYesterday(d)) return "Kemarin";
  return format(d, "d MMM", { locale: localeId });
}

type Tag = { text: string; tone: "blue" | "amber" | "red" | "violet" | "slate" };
const TONE: Record<Tag["tone"], string> = {
  blue: "bg-blue-100 text-blue-800",
  amber: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-800",
  violet: "bg-violet-100 text-violet-800",
  slate: "bg-slate-200 text-slate-700",
};

function tagFor(c: ConversationRow, meId: string, members: Map<string, Member>, aiReady: boolean): Tag | null {
  if (isSnoozed(c)) return { text: `Ditunda s/d ${formatWhen(c.snoozed_until!)}`, tone: "slate" };
  if (isTakeable(c, meId)) return { text: `Belum dibalas ${memberName(members.get(c.assignee_id!))} · bisa diambil`, tone: "amber" };
  if (c.assignee_id === meId && c.rotation_deadline && new Date(c.rotation_deadline).getTime() > Date.now()) {
    return { text: `Balas sebelum ${format(new Date(c.rotation_deadline), "HH.mm")}`, tone: "amber" };
  }
  if (aiServing(c, aiReady)) return { text: "AI melayani", tone: "blue" };
  if (!c.assignee_id && c.ai_handoff_at) return { text: "Perlu agen (dari AI)", tone: "red" };
  if (!c.assignee_id && c.last_customer_message_at) {
    const min = Math.max(1, Math.round((Date.now() - new Date(c.last_customer_message_at).getTime()) / 60_000));
    return { text: min < 60 ? `Menunggu ${min} mnt` : min < 1440 ? `Menunggu ${Math.round(min / 60)} jam` : "Menunggu > 1 hari", tone: "amber" };
  }
  if (c.status === "pending") return { text: "Pending", tone: "slate" };
  if (c.assignee_id && c.assignee_id !== meId) return { text: `Ditangani ${memberName(members.get(c.assignee_id))}`, tone: "slate" };
  return null;
}

export default function InboxScreen() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const meId = profile!.id;
  const [tab, setTab] = useState<Tab>("mine");
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState("");
  const { data: conversations = [], isLoading, live } = useConversations(orgId);
  const { data: memberList = [] } = useMembers(orgId);
  const { data: ai } = useAiSettings(orgId);
  const { data: hits } = useMessageSearch(search);
  const aiReady = Boolean(ai?.enabled && ai.api_key_hint);
  const members = useMemo(() => new Map(memberList.map((m) => [m.id, m])), [memberList]);

  const groups = useMemo(() => {
    const open = conversations.filter((c) => c.status !== "resolved");
    // Snoozed chats wait in "Chat saya" (for whoever snoozed them) until the reminder.
    const active = open.filter((c) => !isSnoozed(c));
    return {
      mine: open.filter((c) => (isSnoozed(c) ? c.snoozed_by === meId || c.assignee_id === meId : c.assignee_id === meId)),
      queue: active.filter((c) => (!c.assignee_id && !aiServing(c, aiReady)) || isTakeable(c, meId)),
      ai: active.filter((c) => aiServing(c, aiReady)),
    };
  }, [conversations, meId, aiReady]);

  const term = search.trim().toLowerCase();
  const rows = term
    ? conversations.filter((c) =>
        `${displayName(c.contact)} ${c.contact.wa_id} ${c.last_message_preview ?? ""}`.toLowerCase().includes(term) || hits?.has(c.id))
    : groups[tab];
  const unread = conversations.reduce((n, c) => n + (c.assignee_id === meId || !c.assignee_id ? c.unread_count : 0), 0);
  const [statusText, statusColor] = STATUS_TEXT[profile!.status] ?? STATUS_TEXT.offline;

  const header = (
    <header className="space-y-3.5 border-b border-slate-200 bg-white px-4 pb-3 pt-[max(env(safe-area-inset-top),16px)]">
      {searching ? (
        <div className="flex items-center gap-2">
          <label htmlFor="m-search" className="sr-only">
            Cari chat
          </label>
          <input
            id="m-search"
            autoFocus
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, nomor, atau isi pesan"
            className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-300 bg-slate-50 px-4 text-[15px] outline-none focus:border-primary"
          />
          <button
            aria-label="Tutup pencarian"
            onClick={() => {
              setSearching(false);
              setSearch("");
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Link to="/m/akun" aria-label="Status dan akun" className="relative">
            <Avatar name={profile!.full_name || profile!.email} url={profile!.avatar_url} size={44} seed={meId} />
            <span className={cn("absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white", STATUS_DOT[profile!.status] ?? STATUS_DOT.offline)} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-extrabold leading-tight">Inbox</h1>
            <p className={cn("text-[13px] font-semibold", statusColor)}>{statusText}</p>
          </div>
          <button aria-label="Cari chat" onClick={() => setSearching(true)} className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200">
            <Search className="h-5 w-5 text-slate-700" />
          </button>
        </div>
      )}
      {!term && (
        <Segmented<Tab>
          label="Daftar chat"
          value={tab}
          onChange={setTab}
          options={[
            { value: "mine", label: "Chat saya", count: groups.mine.length },
            { value: "queue", label: "Antrean", count: groups.queue.length },
            { value: "ai", label: "Dilayani AI", count: groups.ai.length },
          ]}
        />
      )}
    </header>
  );

  return (
    <Screen header={header} footer={<BottomNav unread={unread} />}>
      <DisconnectedBanner orgId={orgId} canFix={profile!.role === "admin"} />
      {!live && (
        <p role="status" className="bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Koneksi terputus sementara. Daftar diperbarui otomatis.
        </p>
      )}
      {tab === "queue" && !term && groups.queue.length > 0 && (
        <p className="mx-4 mt-3 rounded-2xl border border-orange-200 bg-orange-50 px-3.5 py-3 text-[13px] leading-relaxed text-orange-900">
          Chat di Antrean belum dipegang siapa pun. Buka, lalu balas atau ketuk <b>Ambil chat</b>.
        </p>
      )}
      {isLoading ? (
        <Empty>Memuat percakapan…</Empty>
      ) : rows.length === 0 ? (
        <Empty>{term ? "Tidak ada chat yang cocok." : tab === "mine" ? "Belum ada chat yang Anda pegang." : tab === "queue" ? "Antrean kosong." : "Tidak ada chat yang sedang dilayani AI."}</Empty>
      ) : (
        <ul className="py-1">
          {rows.map((c) => {
            const name = displayName(c.contact);
            const tag = tagFor(c, meId, members, aiReady);
            return (
              <li key={c.id}>
                <Link to={`/m/chat/${c.id}`} className="flex items-start gap-3 px-4 py-3 active:bg-slate-200/60">
                  <span className="relative">
                    <Avatar name={name} size={48} seed={c.contact.id} />
                    <ChannelBadge provider={c.channel?.provider} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                      <span className={cn("flex-1 truncate text-[15px]", c.unread_count ? "font-extrabold" : "font-bold")}>{name}</span>
                      <span className={cn("text-xs font-semibold", c.unread_count ? "text-primary" : "text-slate-500")}>{listTime(c.last_message_at)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm text-slate-600">{c.last_message_preview ?? ""}</span>
                      {c.unread_count > 0 && (
                        <span className="min-w-[22px] rounded-full bg-primary px-1.5 text-center text-xs font-bold leading-[22px] text-white">{c.unread_count}</span>
                      )}
                    </span>
                    {tag && <span className={cn("mt-0.5 self-start rounded-lg px-2 py-0.5 text-xs font-semibold", TONE[tag.tone])}>{tag.text}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
