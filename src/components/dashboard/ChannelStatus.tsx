import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

const channels = [
  {
    name: "WhatsApp",
    status: "online",
    messages: 24,
    color: "bg-green-500",
    icon: "💬"
  },
  {
    name: "Instagram",
    status: "online", 
    messages: 12,
    color: "bg-pink-500",
    icon: "📷"
  },
  {
    name: "Facebook",
    status: "online",
    messages: 8,
    color: "bg-blue-600",
    icon: "📘"
  },
  {
    name: "TikTok",
    status: "offline",
    messages: 0,
    color: "bg-black",
    icon: "🎵"
  }
];

export function ChannelStatus() {
  return (
    <div className="bg-card rounded-xl p-6 border border-border shadow-card">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground">Status Channel</h3>
        <p className="text-sm text-muted-foreground">Koneksi platform media sosial</p>
      </div>
      
      <div className="space-y-4">
        {channels.map((channel) => (
          <div key={channel.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
            <div className="flex items-center space-x-3">
              <div className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center text-white",
                channel.color
              )}>
                <span className="text-lg">{channel.icon}</span>
              </div>
              <div>
                <p className="font-medium text-foreground">{channel.name}</p>
                <div className="flex items-center space-x-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    channel.status === "online" ? "bg-success animate-pulse-glow" : "bg-muted-foreground"
                  )}></div>
                  <span className={cn(
                    "text-xs font-medium",
                    channel.status === "online" ? "text-success" : "text-muted-foreground"
                  )}>
                    {channel.status === "online" ? "Terhubung" : "Terputus"}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="text-right">
              <p className="text-lg font-bold text-foreground">{channel.messages}</p>
              <p className="text-xs text-muted-foreground">pesan hari ini</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}