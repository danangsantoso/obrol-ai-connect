import { useState } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, MessageSquare, Contact, Users, Settings, PanelLeftClose, PanelLeftOpen, Zap, SquareKanban, Bot, Plug, CalendarClock, ShoppingBag, Megaphone } from "lucide-react";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { Logo, LogoMark } from "@/components/brand/Logo";
import { useUnreadTotal } from "@/hooks/useInboxNotifications";

const navigation: { name: string; href: string; icon: typeof LayoutDashboard; roles?: AppRole[] }[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Inbox", href: "/inbox", icon: MessageSquare },
  { name: "Pipeline", href: "/pipeline", icon: SquareKanban },
  { name: "Pesanan", href: "/orders", icon: ShoppingBag },
  { name: "Kontak", href: "/contacts", icon: Contact },
  { name: "Balasan Cepat", href: "/quick-replies", icon: Zap },
  { name: "Follow-up", href: "/followup", icon: CalendarClock },
  { name: "Broadcast", href: "/broadcast", icon: Megaphone, roles: ["admin", "supervisor"] },
  { name: "AI Agent", href: "/ai", icon: Bot, roles: ["admin", "supervisor"] },
  { name: "Tim & Agen", href: "/team", icon: Users, roles: ["admin", "supervisor"] },
  { name: "Integrasi", href: "/integrations", icon: Plug, roles: ["admin"] },
  { name: "Pengaturan", href: "/settings", icon: Settings, roles: ["admin", "supervisor"] },
];

export function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { profile } = useAuth();
  const { data: unread = 0 } = useUnreadTotal(profile!.organization_id!);

  const items = navigation.filter((item) => !item.roles || (profile && item.roles.includes(profile.role)));

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-border bg-card transition-all duration-300",
        isCollapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex items-center justify-between border-b border-border p-3">
        {isCollapsed ? <LogoMark className="mx-auto h-7 w-7" /> : <Logo className="px-1" />}
        {!isCollapsed && (
          <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(true)} aria-label="Ciutkan menu">
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.href === "/"}
            title={item.name}
            className={({ isActive }) =>
              cn(
                "group flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-primary-light hover:text-primary-dark",
                isCollapsed && "justify-center px-0",
              )
            }
          >
            <span className="relative">
              <item.icon className="h-5 w-5 shrink-0" />
              {item.href === "/inbox" && unread > 0 && isCollapsed && (
                <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-danger" />
              )}
            </span>
            {!isCollapsed && <span className="ml-3 flex-1">{item.name}</span>}
            {!isCollapsed && item.href === "/inbox" && unread > 0 && (
              <span className="rounded-full bg-danger px-2 text-xs font-semibold text-danger-foreground">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {isCollapsed && (
        <div className="border-t border-border p-3">
          <Button
            variant="ghost"
            size="icon"
            className="w-full"
            onClick={() => setIsCollapsed(false)}
            aria-label="Buka menu"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
      )}
    </aside>
  );
}
