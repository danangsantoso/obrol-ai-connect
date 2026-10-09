import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const PAGE = 50;

const ACTIONS: Record<string, string> = {
  create: "menambah",
  update: "mengubah",
  delete: "menghapus",
  login: "masuk ke aplikasi",
  export: "mengekspor",
  merge: "menggabungkan",
};
const ENTITIES: Record<string, string> = {
  organization: "pengaturan organisasi",
  member: "anggota tim",
  channel: "nomor / kanal",
  ai_settings: "pengaturan AI",
  payment_settings: "pengaturan pembayaran",
  api_key: "API key",
  webhook: "webhook",
  product: "produk",
  order: "pesanan",
  broadcast: "broadcast",
  followup: "urutan follow-up",
  team: "tim",
  knowledge: "pengetahuan AI",
  ai_media: "file untuk AI",
  contact: "kontak",
  contacts: "data kontak",
  report: "laporan",
  file: "file",
  session: "",
};
const FIELDS: Record<string, string> = {
  is_active: "aktif",
  ai_enabled: "dijawab AI",
  enabled: "aktif",
  role: "peran",
  full_name: "nama",
  max_open_chats: "batas chat",
  name: "nama",
  price: "harga",
  status: "status",
  require_mfa: "wajib 2FA",
  retention_days: "masa simpan chat (hari)",
  auto_rotate: "rotasi otomatis",
  agent_wait_minutes: "waktu tunggu agen (menit)",
  api_key_hint: "API key",
  model: "model",
  provider: "penyedia",
  instructions: "instruksi",
  persona: "persona",
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : typeof v === "boolean" ? (v ? "ya" : "tidak") : typeof v === "object" ? JSON.stringify(v) : String(v));

type Entry = {
  id: number;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_name: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  created_at: string;
};

export default function ActivityLog() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const [entity, setEntity] = useState("all");

  const log = useInfiniteQuery({
    queryKey: ["audit-log", orgId, entity],
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from("audit_log")
        .select("id, actor_name, action, entity, entity_name, changes, created_at")
        .eq("organization_id", orgId)
        .order("id", { ascending: false })
        .limit(PAGE);
      if (entity === "login") q = q.eq("action", "login");
      else if (entity === "export") q = q.eq("action", "export");
      else if (entity !== "all") q = q.eq("entity", entity);
      if (pageParam) q = q.lt("id", pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return data as Entry[];
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  });
  const rows = log.data?.pages.flat() ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <History className="h-6 w-6" /> Riwayat aktivitas
        </h1>
        <p className="text-muted-foreground">
          Siapa mengubah apa dan kapan: pengaturan, nomor, tim, AI, produk, pesanan, broadcast, integrasi, kontak yang dihapus, ekspor data, dan login.
        </p>
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Aktivitas terbaru</CardTitle>
            <CardDescription>Hanya terlihat oleh Admin. Catatan tidak bisa diubah atau dihapus.</CardDescription>
          </div>
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="w-56" aria-label="Saring aktivitas">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua aktivitas</SelectItem>
              <SelectItem value="login">Login</SelectItem>
              <SelectItem value="export">Ekspor data</SelectItem>
              {Object.entries(ENTITIES)
                .filter(([k]) => !["session", "contacts", "report", "file"].includes(k))
                .map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label[0].toUpperCase() + label.slice(1)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {log.isLoading ? (
            <Loader2 className="m-6 h-5 w-5 animate-spin text-muted-foreground" />
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Belum ada aktivitas tercatat.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id} className="flex gap-4 px-6 py-3 text-sm">
                  <time className="w-32 shrink-0 tabular-nums text-muted-foreground" dateTime={r.created_at}>
                    {format(new Date(r.created_at), "d MMM yy HH.mm", { locale: localeId })}
                  </time>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p>
                      <b>{r.actor_name ?? "Sistem"}</b> {ACTIONS[r.action] ?? r.action} {ENTITIES[r.entity] ?? r.entity}
                      {r.entity_name && r.action !== "login" && <> <b className="break-words">{r.entity_name}</b></>}
                    </p>
                    {r.action === "login" && r.entity_name && <p className="truncate text-xs text-muted-foreground">{r.entity_name}</p>}
                    {r.changes && (
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {Object.entries(r.changes).map(([k, c]) => (
                          <li key={k} className="break-words">
                            {FIELDS[k] ?? k.replace(/_/g, " ")}: <s>{show(c.from)}</s> → <span className="text-foreground">{show(c.to)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {log.hasNextPage && (
            <div className="border-t p-4 text-center">
              <Button variant="outline" onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage}>
                {log.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Muat lebih banyak
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
