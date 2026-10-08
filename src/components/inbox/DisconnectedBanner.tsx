import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Active QR-linked numbers that lost their WhatsApp session: their chats stop
// arriving until someone scans the code again.
function useDisconnectedChannels(orgId: string) {
  return useQuery({
    queryKey: ["disconnected-channels", orgId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channels")
        .select("id, name, display_phone")
        .eq("organization_id", orgId)
        .eq("provider", "qr")
        .eq("is_active", true)
        .eq("connection_status", "disconnected");
      if (error) throw error;
      return data;
    },
  });
}

export function DisconnectedBanner({ orgId, canFix, className }: { orgId: string; canFix: boolean; className?: string }) {
  const { data: channels = [] } = useDisconnectedChannels(orgId);
  if (!channels.length) return null;
  const names = channels.map((c) => c.name + (c.display_phone ? ` (${c.display_phone})` : "")).join(", ");
  return (
    <div role="alert" className={cn("flex items-start gap-2 bg-red-50 px-4 py-2.5 text-sm text-red-800", className)}>
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <b>Nomor WhatsApp terputus: {names}.</b> Chat dari nomor ini tidak masuk.{" "}
        {canFix ? (
          <Link to="/settings" className="font-semibold underline underline-offset-2">
            Hubungkan ulang (scan QR)
          </Link>
        ) : (
          "Minta admin menghubungkan ulang."
        )}
      </p>
    </div>
  );
}
