import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useOrgRouting(orgId: string) {
  return useQuery({
    queryKey: ["org-routing", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("auto_rotate, rotate_timeout_minutes, followup_alert_days")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data;
    },
  });
}
