import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label as FieldLabel } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { displayName, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { LabelChip } from "@/components/inbox/LabelChip";
import { useConversations, useLabels, useMembers } from "@/components/inbox/useInboxData";
import { ALL, memberName, type ConversationRow, type Label, type Member } from "@/components/inbox/types";

const NO_LABEL = "__none__";

interface Column {
  id: string; // label id, or NO_LABEL
  name: string;
  color: string;
}

function PipelineCard({
  conv,
  columnId,
  otherLabels,
  assignee,
  onOpen,
}: {
  conv: ConversationRow;
  columnId: string;
  otherLabels: Label[];
  assignee?: Member;
  onOpen: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/json", JSON.stringify({ convId: conv.id, from: columnId }));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      className="cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-semibold">{displayName(conv.contact)}</p>
        {conv.unread_count > 0 && (
          <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
            {conv.unread_count}
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{conv.last_message_preview ?? ""}</p>
      {otherLabels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {otherLabels.map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="truncate">{assignee ? memberName(assignee) : "Belum di-assign"}</span>
        <span className="shrink-0">
          {conv.status === "resolved" ? "Selesai" : conv.status === "pending" ? "Pending" : "Open"}
        </span>
      </div>
    </div>
  );
}

export default function Pipeline() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: conversations = [], isLoading } = useConversations(orgId);
  const { data: labels = [] } = useLabels(orgId);
  const { data: members = [] } = useMembers(orgId);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState(ALL);
  const [showResolved, setShowResolved] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const canFilterAgents = profile!.role !== "agent";
  const canManageLabels = profile!.role !== "agent";

  const stages = useMemo(() => labels.filter((l) => l.in_pipeline), [labels]);
  const stageIds = useMemo(() => new Set(stages.map((l) => l.id)), [stages]);
  const labelMap = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);

  const columns = useMemo<Column[]>(
    () => [
      { id: NO_LABEL, name: "Tanpa label", color: "#64748B" },
      ...stages.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    ],
    [stages],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (!showResolved && c.status === "resolved") return false;
      if (agentFilter !== ALL && c.assignee_id !== agentFilter) return false;
      if (term) {
        const haystack = `${displayName(c.contact)} ${c.contact.wa_id} ${c.last_message_preview ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [conversations, search, agentFilter, showResolved]);

  const byColumn = useMemo(() => {
    const map = new Map<string, ConversationRow[]>(columns.map((c) => [c.id, []]));
    for (const conv of visible) {
      const ids = conv.conversation_labels.map((l) => l.label_id).filter((id) => stageIds.has(id));
      if (ids.length === 0) map.get(NO_LABEL)!.push(conv);
      for (const id of ids) map.get(id)?.push(conv);
    }
    return map;
  }, [visible, columns, stageIds]);

  const move = async (convId: string, from: string, to: string) => {
    if (from === to) return;
    const fromLabel = from === NO_LABEL ? null : from;
    const toLabel = to === NO_LABEL ? null : to;

    // Optimistic: update the cached list so the card jumps right away.
    const key = ["conversations", orgId];
    const previous = queryClient.getQueryData<ConversationRow[]>(key);
    queryClient.setQueryData<ConversationRow[]>(key, (rows) =>
      rows?.map((c) => {
        if (c.id !== convId) return c;
        const kept = c.conversation_labels.filter((l) => l.label_id !== fromLabel && l.label_id !== toLabel);
        return { ...c, conversation_labels: toLabel ? [...kept, { label_id: toLabel }] : kept };
      }),
    );

    const { error } = await supabase.rpc("move_conversation_label", {
      conv_id: convId,
      from_label: fromLabel,
      to_label: toLabel,
    });
    if (error) {
      queryClient.setQueryData(key, previous);
      toast.error(errorMessage(error));
    }
    queryClient.invalidateQueries({ queryKey: key });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Chat dikelompokkan per label. Geser kartu ke kolom lain untuk mengganti labelnya.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau nomor"
              className="pl-9"
            />
          </div>
          {canFilterAgents && (
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Semua agen</SelectItem>
                {members
                  .filter((m) => m.is_active)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {memberName(m)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-2">
            <Switch id="show-resolved" checked={showResolved} onCheckedChange={setShowResolved} />
            <FieldLabel htmlFor="show-resolved" className="text-sm">
              Tampilkan yang selesai
            </FieldLabel>
          </div>
          {canManageLabels && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings">
                <Settings2 className="mr-1 h-4 w-4" />
                Atur tahap
              </Link>
            </Button>
          )}
        </div>
      </div>

      {!isLoading && stages.length === 0 && (
        <div className="m-6 rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          Belum ada label yang dijadikan tahap pipeline.{" "}
          {canManageLabels
            ? "Buat label di Pengaturan, misalnya Prospek, Negosiasi, Order, Komplain."
            : "Minta admin atau supervisor membuat label di Pengaturan."}
        </div>
      )}

      <div className="flex flex-1 gap-4 overflow-x-auto p-6">
        {columns.map((col) => {
          const cards = byColumn.get(col.id) ?? [];
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTarget(col.id);
              }}
              onDragLeave={() => setDropTarget((t) => (t === col.id ? null : t))}
              onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                const raw = e.dataTransfer.getData("application/json");
                if (!raw) return;
                const { convId, from } = JSON.parse(raw) as { convId: string; from: string };
                move(convId, from, col.id);
              }}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-xl border bg-muted/60 transition-colors",
                dropTarget === col.id ? "border-primary bg-primary-light" : "border-transparent",
              )}
            >
              <div className="flex items-center gap-2 px-3 py-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                <p className="flex-1 truncate text-sm font-semibold">{col.name}</p>
                <span className="rounded-full bg-card px-2 text-xs text-muted-foreground">{cards.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                {cards.map((conv) => (
                  <PipelineCard
                    key={`${col.id}-${conv.id}`}
                    conv={conv}
                    columnId={col.id}
                    otherLabels={conv.conversation_labels
                      .map((l) => labelMap.get(l.label_id))
                      .filter((l): l is Label => !!l && !l.in_pipeline)}
                    assignee={conv.assignee_id ? memberMap.get(conv.assignee_id) : undefined}
                    onOpen={() => navigate(`/inbox/${conv.id}`)}
                  />
                ))}
                {cards.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    Tarik chat ke sini
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
