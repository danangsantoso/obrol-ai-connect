import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { displayName, formatWaId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Avatar, BottomNav, Empty, Screen } from "./ui";

const KINDS = [
  { value: "all", label: "Semua" },
  { value: "wa", label: "WhatsApp" },
  { value: "ig:", label: "Instagram" },
  { value: "fb:", label: "Messenger" },
  { value: "tg:", label: "Telegram" },
];

export default function ContactsScreen() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const term = search.trim();

  // RLS limits agents to the customers of chats they may see.
  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["m-contacts", term, kind],
    queryFn: async () => {
      let query = supabase.from("contacts").select("id, wa_id, name, profile_name, username").order("name", { nullsFirst: false }).limit(200);
      if (term) {
        const like = `%${term.replace(/[%_,()]/g, "")}%`;
        query = query.or(`name.ilike.${like},profile_name.ilike.${like},wa_id.ilike.${like},username.ilike.${like}`);
      }
      if (kind === "wa") query = query.not("wa_id", "like", "%:%");
      else if (kind !== "all") query = query.like("wa_id", `${kind}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  return (
    <Screen
      header={
        <header className="space-y-3 border-b border-slate-200 bg-white px-4 pb-3.5 pt-[max(env(safe-area-inset-top),16px)]">
          <h1 className="text-[22px] font-extrabold">Kontak</h1>
          <div className="relative">
            <label htmlFor="m-contact-search" className="sr-only">
              Cari kontak
            </label>
            <Search className="absolute left-3.5 top-3.5 h-5 w-5 text-slate-500" />
            <input
              id="m-contact-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, nomor, atau username"
              className="h-12 w-full rounded-2xl border border-slate-300 bg-slate-50 pl-11 pr-4 text-[15px] outline-none focus:border-primary"
            />
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
            {KINDS.map((k) => (
              <button
                key={k.value}
                onClick={() => setKind(k.value)}
                aria-pressed={kind === k.value}
                className={cn(
                  "min-h-[36px] shrink-0 rounded-full px-3.5 text-[13px] font-bold",
                  kind === k.value ? "bg-primary text-white" : "border border-slate-300 bg-white text-slate-700",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
        </header>
      }
      footer={<BottomNav />}
    >
      {isLoading ? (
        <Empty>Memuat kontak…</Empty>
      ) : contacts.length === 0 ? (
        <Empty>{term ? "Tidak ada kontak yang cocok." : "Belum ada kontak."}</Empty>
      ) : (
        <ul className="py-1.5">
          {contacts.map((c) => {
            const name = displayName(c);
            return (
              <li key={c.id}>
                <Link to={`/m/kontak/${c.id}`} className="flex min-h-[56px] items-center gap-3 px-5 py-2.5 active:bg-slate-200/60">
                  <Avatar name={name} size={44} seed={c.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{name}</span>
                    <span className="block truncate text-[13px] text-slate-600">{formatWaId(c.wa_id, c.username)}</span>
                  </span>
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
