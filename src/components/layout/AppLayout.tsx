import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { PlanBanner } from "@/components/settings/PlanUsage";
import { useAuth } from "@/contexts/AuthContext";
import { useInboxNotifications } from "@/hooks/useInboxNotifications";
import { useFollowupAlerts } from "@/hooks/useFollowupAlerts";

export function AppLayout() {
  const { profile } = useAuth();
  useInboxNotifications(profile!.organization_id!, profile!.id);
  useFollowupAlerts(profile!.organization_id!, profile!.role !== "agent");

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <PlanBanner />
        <main className="flex-1 overflow-y-auto bg-muted/40">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
