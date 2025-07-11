import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import ChatPanel from "./pages/ChatPanel";
import AIAgent from "./pages/AIAgent";
import HumanAgent from "./pages/HumanAgent";
import Broadcast from "./pages/Broadcast";
import Contacts from "./pages/Contacts";
import Products from "./pages/Products";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="chat" element={<ChatPanel />} />
            <Route path="ai-agent" element={<AIAgent />} />
            <Route path="human-agent" element={<HumanAgent />} />
            <Route path="broadcast" element={<Broadcast />} />
            <Route path="contacts" element={<Contacts />} />
            <Route path="products" element={<Products />} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
