import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Clock, User } from "lucide-react";
import { cn } from "@/lib/utils";

const recentChats = [
  {
    id: 1,
    name: "Sari Dewi",
    platform: "WhatsApp",
    message: "Halo, saya mau tanya tentang produk skincare yang viral itu...",
    time: "2 menit lalu",
    status: "new",
    avatar: "",
    unread: 3
  },
  {
    id: 2,
    name: "Budi Santoso", 
    platform: "Instagram",
    message: "Apakah masih ada stock untuk sepatu size 42?",
    time: "5 menit lalu",
    status: "waiting",
    avatar: "",
    unread: 1
  },
  {
    id: 3,
    name: "Maya Putri",
    platform: "Facebook",
    message: "Terima kasih! Produknya sudah sampai dan sesuai ekspektasi 😊",
    time: "12 menit lalu", 
    status: "resolved",
    avatar: "",
    unread: 0
  },
  {
    id: 4,
    name: "Andi Wijaya",
    platform: "WhatsApp",
    message: "Bisa kirim katalog lengkap produk elektronik?",
    time: "18 menit lalu",
    status: "open",
    avatar: "",
    unread: 2
  },
  {
    id: 5,
    name: "Lisa Chen",
    platform: "TikTok",
    message: "Cara order gimana ya? Saya tertarik dengan video yang kemarin",
    time: "25 menit lalu",
    status: "new",
    avatar: "",
    unread: 1
  }
];

const getStatusColor = (status: string) => {
  switch (status) {
    case "new": return "bg-primary text-primary-foreground";
    case "open": return "bg-warning text-warning-foreground";
    case "waiting": return "bg-orange-500 text-white";
    case "resolved": return "bg-success text-success-foreground";
    default: return "bg-muted text-muted-foreground";
  }
};

const getStatusText = (status: string) => {
  switch (status) {
    case "new": return "Baru";
    case "open": return "Buka";
    case "waiting": return "Menunggu";
    case "resolved": return "Selesai";
    default: return status;
  }
};

const getPlatformIcon = (platform: string) => {
  switch (platform) {
    case "WhatsApp": return "💬";
    case "Instagram": return "📷";
    case "Facebook": return "📘";
    case "TikTok": return "🎵";
    default: return "💬";
  }
};

export function RecentChats() {
  return (
    <div className="bg-card rounded-xl p-6 border border-border shadow-card">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Chat Terbaru</h3>
          <p className="text-sm text-muted-foreground">Percakapan yang perlu perhatian</p>
        </div>
        <Button variant="outline" size="sm">
          <MessageSquare className="w-4 h-4 mr-2" />
          Lihat Semua
        </Button>
      </div>
      
      <div className="space-y-4">
        {recentChats.map((chat) => (
          <div 
            key={chat.id} 
            className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group"
          >
            <div className="relative">
              <Avatar className="w-10 h-10">
                <AvatarImage src={chat.avatar} />
                <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                  {chat.name.split(' ').map(n => n[0]).join('')}
                </AvatarFallback>
              </Avatar>
              {/* Platform indicator */}
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-card border-2 border-background rounded-full flex items-center justify-center text-xs">
                {getPlatformIcon(chat.platform)}
              </div>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2">
                  <p className="font-medium text-foreground truncate">{chat.name}</p>
                  <span className="text-xs text-muted-foreground">{chat.platform}</span>
                </div>
                <div className="flex items-center space-x-2">
                  {chat.unread > 0 && (
                    <Badge variant="secondary" className="bg-primary text-primary-foreground text-xs">
                      {chat.unread}
                    </Badge>
                  )}
                  <Badge className={cn("text-xs", getStatusColor(chat.status))}>
                    {getStatusText(chat.status)}
                  </Badge>
                </div>
              </div>
              
              <p className="text-sm text-muted-foreground truncate mb-1">
                {chat.message}
              </p>
              
              <div className="flex items-center text-xs text-muted-foreground">
                <Clock className="w-3 h-3 mr-1" />
                {chat.time}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total chat aktif: 47</span>
          <span className="text-muted-foreground">Menunggu respons: 12</span>
        </div>
      </div>
    </div>
  );
}