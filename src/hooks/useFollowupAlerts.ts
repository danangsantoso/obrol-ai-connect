import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgRouting } from "@/components/team/orgRouting";
import { displayName } from "@/lib/api";
import { toast } from "sonner";

export interface FollowupChat {
  id: string;
  last_message_at: string | null;
  assignee_id: string | null;
  contact: { name: string | null; profile_name: string | null; wa_id: string } | null;
}

// Open chats with no message either way for the organization's follow-up
// period (default 7 days), limited by RLS to what the user may see.
// Only admins and supervisors get these alerts.
export function useFollowupChats(orgId: string, enabled: boolean) {
  const { data: routing } = useOrgRouting(orgId);
  const days = routing?.followup_alert_days ?? 7;
  const query = useQuery({
    queryKey: ["followup", orgId, days],
    enabled: enabled && !!routing,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("conversations")
        .select("id, last_message_at, assignee_id, contact:contacts(name, profile_name, wa_id)")
        .neq("status", "resolved")
        .lt("last_message_at", since)
        .order("last_message_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return data as unknown as FollowupChat[];
    },
    refetchInterval: 5 * 60_000,
  });
  return { ...query, days };
}

// Tells the supervisor once per session about chats that newly crossed the limit.
export function useFollowupAlerts(orgId: string, enabled: boolean) {
  const navigate = useNavigate();
  const { data, days } = useFollowupChats(orgId, enabled);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!data) return;
    const known = seen.current ?? new Set<string>();
    const fresh = data.filter((c) => !known.has(c.id));
    seen.current = new Set([...known, ...data.map((c) => c.id)]);
    if (fresh.length === 0) return;

    const title = `${fresh.length} chat belum di-follow up lebih dari ${days} hari`;
    const body = fresh
      .slice(0, 3)
      .map((c) => (c.contact ? displayName(c.contact) : "Pelanggan"))
      .join(", ");
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, tag: "balas-followup", icon: "/favicon.svg" });
      n.onclick = () => {
        window.focus();
        navigate(`/inbox/${fresh[0].id}`);
        n.close();
      };
    } else {
      toast.warning(title, {
        description: body,
        duration: 15_000,
        action: { label: "Buka", onClick: () => navigate(`/inbox/${fresh[0].id}`) },
      });
    }
  }, [data, days, navigate]);
}
