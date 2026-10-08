import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth, type AppRole } from "./contexts/AuthContext";
import { AppLayout } from "./components/layout/AppLayout";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// Each page loads on first visit, keeping the initial download small.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Inbox = lazy(() => import("./pages/Inbox"));
const Contacts = lazy(() => import("./pages/Contacts"));
const QuickReplies = lazy(() => import("./pages/QuickReplies"));
const Followup = lazy(() => import("./pages/Followup"));
const Orders = lazy(() => import("./pages/Orders"));
const Broadcast = lazy(() => import("./pages/Broadcast"));
const Reports = lazy(() => import("./pages/Reports"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const Team = lazy(() => import("./pages/Team"));
const Settings = lazy(() => import("./pages/Settings"));
const AiAgent = lazy(() => import("./pages/AiAgent"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Integrations = lazy(() => import("./pages/Integrations"));
const MasterAdmin = lazy(() => import("./pages/MasterAdmin"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));

const queryClient = new QueryClient();

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  );
}

function SuspendedTenant() {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-bold">Akun organisasi Anda sedang dinonaktifkan</h1>
      <p className="max-w-md text-muted-foreground">Hubungi pengelola Balas.id untuk mengaktifkannya kembali.</p>
      <button className="text-primary underline" onClick={() => signOut()}>
        Keluar
      </button>
    </div>
  );
}

// Signed in + member of an active organization (otherwise: login, onboarding,
// or the Master Admin console), and no longer on the default password.
function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: AppRole[] }) {
  const { user, profile, loading, isMaster, tenantSuspended } = useAuth();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/auth" replace />;
  if (profile?.must_change_password) return <ChangePassword />;
  if (!profile?.organization_id) return <Navigate to={isMaster ? "/master" : "/onboarding"} replace />;
  if (tenantSuspended) return <SuspendedTenant />;
  if (roles && !roles.includes(profile.role)) return <Navigate to="/" replace />;

  return <>{children}</>;
}

// Platform owner only; belongs to no tenant.
function MasterRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, isMaster } = useAuth();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/auth" replace />;
  if (profile?.must_change_password) return <ChangePassword />;
  if (!isMaster) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner position="top-center" />
        <BrowserRouter>
          <Suspense fallback={<FullPageSpinner />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route
                path="/master"
                element={
                  <MasterRoute>
                    <MasterAdmin />
                  </MasterRoute>
                }
              />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="inbox" element={<Inbox />} />
                <Route path="inbox/:conversationId" element={<Inbox />} />
                <Route path="pipeline" element={<Pipeline />} />
                <Route path="contacts" element={<Contacts />} />
                <Route path="quick-replies" element={<QuickReplies />} />
                <Route path="followup" element={<Followup />} />
                <Route path="orders" element={<Orders />} />
                <Route
                  path="reports"
                  element={
                    <ProtectedRoute roles={["admin", "supervisor"]}>
                      <Reports />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="broadcast"
                  element={
                    <ProtectedRoute roles={["admin", "supervisor"]}>
                      <Broadcast />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="ai"
                  element={
                    <ProtectedRoute roles={["admin", "supervisor"]}>
                      <AiAgent />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="team"
                  element={
                    <ProtectedRoute roles={["admin", "supervisor"]}>
                      <Team />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="integrations"
                  element={
                    <ProtectedRoute roles={["admin"]}>
                      <Integrations />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <ProtectedRoute roles={["admin", "supervisor"]}>
                      <Settings />
                    </ProtectedRoute>
                  }
                />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
