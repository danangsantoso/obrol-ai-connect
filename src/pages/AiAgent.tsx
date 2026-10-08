import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { AiSettingsTab } from "@/components/ai/AiSettingsTab";
import { KnowledgeTab } from "@/components/ai/KnowledgeTab";
import { PlaygroundTab } from "@/components/ai/PlaygroundTab";
import { RunsTab } from "@/components/ai/RunsTab";
import { GapsTab } from "@/components/ai/GapsTab";

export default function AiAgent() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">AI Agent</h1>
        <p className="text-muted-foreground">
          AI membalas chat pelanggan berdasarkan pengetahuan produk Anda, dan menyerahkan ke agen saat perlu.
        </p>
      </div>
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Pengaturan</TabsTrigger>
          <TabsTrigger value="knowledge">Produk & Pengetahuan</TabsTrigger>
          <TabsTrigger value="gaps">Belum terjawab</TabsTrigger>
          <TabsTrigger value="playground">Uji coba</TabsTrigger>
          <TabsTrigger value="runs">Riwayat</TabsTrigger>
        </TabsList>
        <TabsContent value="settings" className="pt-2">
          <AiSettingsTab orgId={orgId} isAdmin={profile!.role === "admin"} />
        </TabsContent>
        <TabsContent value="knowledge" className="pt-2">
          <KnowledgeTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="gaps" className="pt-2">
          <GapsTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="playground" className="pt-2">
          <PlaygroundTab />
        </TabsContent>
        <TabsContent value="runs" className="pt-2">
          <RunsTab orgId={orgId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
