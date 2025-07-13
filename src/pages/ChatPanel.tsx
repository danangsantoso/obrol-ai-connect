import { useState, useEffect } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";


export default function ChatPanel() {
  const { user } = useAuth();
  const [chatSessions, setChatSessions] = useState<any[]>([]);
  const [selectedChat, setSelectedChat] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (user) {
      loadChatSessions();
    }
  }, [user]);

  useEffect(() => {
    if (selectedChat) {
      loadMessages();
    }
  }, [selectedChat]);

  const loadChatSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('user_id', user?.id)
        .order('last_message_at', { ascending: false });

      if (error) throw error;
      setChatSessions(data || []);
      
      if (data && data.length > 0 && !selectedChat) {
        setSelectedChat(data[0]);
      }
    } catch (error) {
      console.error('Error loading chat sessions:', error);
      toast.error('Gagal memuat sesi chat');
    }
  };

  const loadMessages = async () => {
    if (!selectedChat) return;

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', selectedChat.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error loading messages:', error);
      toast.error('Gagal memuat pesan');
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedChat) return;

    try {
      // Save human agent message
      const { error } = await supabase
        .from('messages')
        .insert({
          session_id: selectedChat.id,
          sender_type: 'human',
          message_text: newMessage
        });

      if (error) throw error;

      // Update session timestamp
      await supabase
        .from('chat_sessions')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', selectedChat.id);

      setNewMessage("");
      loadMessages();
      loadChatSessions();
      
      toast.success('Pesan terkirim');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Gagal mengirim pesan');
    }
  };

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case "whatsapp": return "bg-green-500";
      case "instagram": return "bg-pink-500";
      case "facebook": return "bg-blue-600";
      case "tiktok": return "bg-black";
      default: return "bg-muted";
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRelativeTime = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInMs = now.getTime() - time.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Baru saja';
    if (diffInMinutes < 60) return `${diffInMinutes} menit lalu`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} jam lalu`;
    return `${Math.floor(diffInMinutes / 1440)} hari lalu`;
  };

  const filteredChats = chatSessions.filter(chat =>
    chat.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    chat.whatsapp_phone.includes(searchTerm)
  );

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
            <Input 
              placeholder="Cari chat..." 
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          {filteredChats.length > 0 ? filteredChats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => setSelectedChat(chat)}
              className={cn(
                "p-4 border-b border-border cursor-pointer hover:bg-muted/50 transition-colors",
                selectedChat?.id === chat.id && "bg-primary/10 border-r-2 border-r-primary"
              )}
            >
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {chat.customer_name ? chat.customer_name.split(' ').map((n: string) => n[0]).join('') : 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className={cn(
                    "absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-background",
                    getPlatformColor(chat.platform)
                  )}></div>
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-success rounded-full border-2 border-background"></div>
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm truncate">
                      {chat.customer_name || `Customer ${chat.whatsapp_phone.slice(-4)}`}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {getRelativeTime(chat.last_message_at)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {chat.whatsapp_phone}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <Badge variant="outline" className="text-xs capitalize">
                      {chat.platform}
                    </Badge>
                    <Badge variant={chat.status === 'open' ? 'default' : 'secondary'} className="text-xs">
                      {chat.status}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          )) : (
            <div className="p-8 text-center text-muted-foreground">
              {searchTerm ? 'Tidak ada chat yang ditemukan' : 'Belum ada chat masuk'}
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        {selectedChat && (
          <div className="p-4 border-b border-border bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {selectedChat.customer_name ? selectedChat.customer_name.split(' ').map((n: string) => n[0]).join('') : 'U'}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">
                    {selectedChat.customer_name || `Customer ${selectedChat.whatsapp_phone.slice(-4)}`}
                  </p>
                  <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                    <span className="capitalize">{selectedChat.platform}</span>
                    <span>•</span>
                    <span>{selectedChat.whatsapp_phone}</span>
                    <span>•</span>
                    <span className="text-success">Online</span>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {selectedChat ? (
            messages.length > 0 ? messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.sender_type === "customer" ? "justify-start" : "justify-end"
                )}
              >
                <div className={cn(
                  "max-w-xs lg:max-w-md px-4 py-2 rounded-lg",
                  message.sender_type === "customer" && "bg-muted text-foreground",
                  message.sender_type === "ai" && "bg-primary/20 text-foreground border border-primary/30",
                  message.sender_type === "human" && "bg-primary text-primary-foreground"
                )}>
                  {message.sender_type !== "customer" && (
                    <div className="flex items-center space-x-1 mb-1">
                      {message.sender_type === "ai" ? (
                        <Bot className="w-3 h-3" />
                      ) : (
                        <User className="w-3 h-3" />
                      )}
                      <span className="text-xs font-medium">
                        {message.sender_type === "ai" ? "AI Agent" : "Human Agent"}
                      </span>
                    </div>
                  )}
                  <p className="text-sm">{message.message_text}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs opacity-70">{formatTime(message.created_at)}</span>
                    {message.sender_type !== "customer" && (
                      <CheckCheck className={cn(
                        "w-3 h-3",
                        message.is_read ? "text-success" : "opacity-50"
                      )} />
                    )}
                  </div>
                </div>
              </div>
            )) : (
              <div className="text-center text-muted-foreground py-8">
                Belum ada pesan dalam chat ini
              </div>
            )
          ) : (
            <div className="text-center text-muted-foreground py-8">
              Pilih chat untuk melihat percakapan
            </div>
          )}
        </div>

        {/* Message Input */}
        {selectedChat && (
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
                    sendMessage();
                  }
                }}
              />
              <Button size="sm" disabled={!newMessage.trim()} onClick={sendMessage}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}