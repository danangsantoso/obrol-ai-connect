import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { FollowupTracking } from "@/components/followup/FollowupTracking";
import { SequenceEditor } from "@/components/followup/SequenceEditor";

export default function Followup() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const canEdit = profile!.role !== "agent";
  const { data: org } = useQuery({
    queryKey: ["org-name", orgId],
    queryFn: async () => (await supabase.from("organizations").select("name").eq("id", orgId).single()).data,
  });
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Follow-up</h1>
        <p className="text-muted-foreground">
          Kirim pesan follow-up berlapis (misalnya 7 hari berturut-turut) ke pelanggan yang belum membalas. Berhenti otomatis saat
          pelanggan membalas.
        </p>
      </div>
      <Tabs defaultValue="tracking">
        <TabsList>
          <TabsTrigger value="tracking">Pelacakan</TabsTrigger>
          <TabsTrigger value="sequences">Urutan pesan</TabsTrigger>
        </TabsList>
        <TabsContent value="tracking" className="pt-2">
          <FollowupTracking orgId={orgId} />
        </TabsContent>
        <TabsContent value="sequences" className="pt-2">
          <SequenceEditor orgId={orgId} orgName={org?.name ?? "Toko"} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
