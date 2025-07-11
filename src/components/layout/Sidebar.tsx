import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  LayoutDashboard, 
  MessageSquare, 
  Bot, 
  Users, 
  Send, 
  Tags, 
  Package, 
  GitBranch,
  BarChart3,
  Settings,
  Menu,
  X,
  UserCheck,
  LogOut
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Chat Panel", href: "/chat", icon: MessageSquare },
  { name: "AI Agent", href: "/ai-agent", icon: Bot },
  { name: "Human Agent", href: "/human-agent", icon: Users },
  { name: "Broadcast", href: "/broadcast", icon: Send },
  { name: "Kontak & Label", href: "/contacts", icon: Tags },
  { name: "Produk", href: "/products", icon: Package },
  { name: "Affiliate", href: "/affiliate", icon: UserCheck },
  { name: "Auto Funnel", href: "/funnel", icon: GitBranch },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Pengaturan", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();
  const { profile, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className={cn(
      "relative flex flex-col h-screen bg-card border-r border-border transition-all duration-300",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        {!isCollapsed && (
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-primary rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-primary">Obrol.AI</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2"
        >
          {isCollapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          const Icon = item.icon;
          
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                "flex items-center p-3 rounded-lg transition-all duration-200 group hover:bg-primary/10",
                isActive && "bg-primary text-primary-foreground hover:bg-primary",
                isCollapsed && "justify-center"
              )}
            >
              <Icon className={cn(
                "w-5 h-5",
                isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-primary"
              )} />
              {!isCollapsed && (
                <span className={cn(
                  "ml-3 font-medium",
                  isActive ? "text-primary-foreground" : "text-foreground"
                )}>
                  {item.name}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User Info */}
      {!isCollapsed && profile && (
        <div className="p-4 border-t border-border space-y-3">
          <div className="flex items-center space-x-3">
            <Avatar className="w-8 h-8">
              <AvatarImage src={profile.avatar_url} />
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {profile.full_name?.charAt(0)?.toUpperCase() || profile.email.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {profile.full_name || 'User'}
              </p>
              <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
              <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                {profile.role}
              </span>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleSignOut}
            className="w-full"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Keluar
          </Button>
        </div>
      )}
    </div>
  );
}