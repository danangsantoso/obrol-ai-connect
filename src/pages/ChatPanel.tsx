import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Search, 
  Filter, 
  Send, 
  Paperclip, 
  MoreVertical,
  Bot,
  User,
  Clock,
  CheckCheck
} from "lucide-react";
import { cn } from "@/lib/utils";

const chats = [
  {
    id: 1,
    name: "Sari Dewi",
    platform: "WhatsApp",
    lastMessage: "Terima kasih infonya, saya akan pertimbangkan dulu ya",
    time: "2 menit lalu",
    status: "waiting",
    unread: 0,
    isOnline: true
  },
  {
    id: 2,
    name: "Budi Santoso",
    platform: "Instagram", 
    lastMessage: "Halo, produk ini masih ready stock?",
    time: "5 menit lalu",
    status: "new",
    unread: 2,
    isOnline: false
  },
  {
    id: 3,
    name: "Maya Putri",
    platform: "Facebook",
    lastMessage: "Oke siap, saya transfer sekarang",
    time: "12 menit lalu",
    status: "open",
    unread: 1,
    isOnline: true
  }
];

const messages = [
  {
    id: 1,
    sender: "customer",
    message: "Halo, saya mau tanya tentang produk skincare",
    time: "14:20",
    isRead: true
  },
  {
    id: 2,
    sender: "ai",
    message: "Halo! Terima kasih sudah menghubungi Obrol.AI. Saya siap membantu Anda dengan informasi produk skincare. Produk mana yang ingin Anda ketahui?",
    time: "14:21",
    isRead: true
  },
  {
    id: 3,
    sender: "customer",
    message: "Yang untuk jerawat ada gak?",
    time: "14:22",
    isRead: true
  },
  {
    id: 4,
    sender: "human",
    message: "Tentu! Kami punya beberapa produk untuk mengatasi jerawat. Ada serum niacinamide dan clay mask yang sangat efektif. Mau saya kirimkan detail produknya?",
    time: "14:25",
    isRead: false
  }
];

export default function ChatPanel() {
  const [selectedChat, setSelectedChat] = useState(chats[0]);
  const [newMessage, setNewMessage] = useState("");

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case "WhatsApp": return "bg-green-500";
      case "Instagram": return "bg-pink-500";
      case "Facebook": return "bg-blue-600";
      case "TikTok": return "bg-black";
      default: return "bg-muted";
    }
  };

  return (
    <div className="h-full flex bg-card rounded-xl border border-border overflow-hidden">
      {/* Chat List */}
      <div className="w-80 border-r border-border flex flex-col">
        {/* Chat List Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Chat Panel</h2>
            <Button variant="outline" size="sm">
              <Filter className="w-4 h-4" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input placeholder="Cari chat..." className="pl-10" />
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          {chats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => setSelectedChat(chat)}
              className={cn(
                "p-4 border-b border-border cursor-pointer hover:bg-muted/50 transition-colors",
                selectedChat.id === chat.id && "bg-primary/10 border-r-2 border-r-primary"
              )}
            >
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {chat.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div className={cn(
                    "absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-background",
                    getPlatformColor(chat.platform)
                  )}></div>
                  {chat.isOnline && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-success rounded-full border-2 border-background"></div>
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm truncate">{chat.name}</p>
                    <span className="text-xs text-muted-foreground">{chat.time}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {chat.lastMessage}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <Badge variant="outline" className="text-xs">
                      {chat.platform}
                    </Badge>
                    {chat.unread > 0 && (
                      <Badge className="bg-primary text-primary-foreground text-xs">
                        {chat.unread}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="p-4 border-b border-border bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-primary/10 text-primary">
                  {selectedChat.name.split(' ').map(n => n[0]).join('')}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{selectedChat.name}</p>
                <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                  <span>{selectedChat.platform}</span>
                  <span>•</span>
                  <span className={cn(
                    selectedChat.isOnline ? "text-success" : "text-muted-foreground"
                  )}>
                    {selectedChat.isOnline ? "Online" : "Offline"}
                  </span>
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex",
                message.sender === "customer" ? "justify-start" : "justify-end"
              )}
            >
              <div className={cn(
                "max-w-xs lg:max-w-md px-4 py-2 rounded-lg",
                message.sender === "customer" && "bg-muted text-foreground",
                message.sender === "ai" && "bg-primary/20 text-foreground border border-primary/30",
                message.sender === "human" && "bg-primary text-primary-foreground"
              )}>
                {message.sender !== "customer" && (
                  <div className="flex items-center space-x-1 mb-1">
                    {message.sender === "ai" ? (
                      <Bot className="w-3 h-3" />
                    ) : (
                      <User className="w-3 h-3" />
                    )}
                    <span className="text-xs font-medium">
                      {message.sender === "ai" ? "AI Agent" : "Human Agent"}
                    </span>
                  </div>
                )}
                <p className="text-sm">{message.message}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs opacity-70">{message.time}</span>
                  {message.sender !== "customer" && (
                    <CheckCheck className={cn(
                      "w-3 h-3",
                      message.isRead ? "text-success" : "opacity-50"
                    )} />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Message Input */}
        <div className="p-4 border-t border-border bg-muted/20">
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm">
              <Paperclip className="w-4 h-4" />
            </Button>
            <Input
              placeholder="Ketik pesan..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="flex-1"
              onKeyPress={(e) => {
                if (e.key === 'Enter' && newMessage.trim()) {
                  // Handle send message
                  setNewMessage("");
                }
              }}
            />
            <Button size="sm" disabled={!newMessage.trim()}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}