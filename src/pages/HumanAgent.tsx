import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Users, 
  UserPlus, 
  Clock, 
  MessageSquare, 
  Star,
  Plus,
  MoreVertical,
  Activity
} from "lucide-react";

const agents = [
  {
    id: 1,
    name: "Sarah Johnson",
    role: "Senior Agent",
    status: "online",
    activeChats: 8,
    totalChats: 145,
    rating: 4.9,
    responseTime: "1.2 mnt"
  },
  {
    id: 2,
    name: "Budi Hartono", 
    role: "Agent",
    status: "online",
    activeChats: 12,
    totalChats: 89,
    rating: 4.7,
    responseTime: "2.1 mnt"
  },
  {
    id: 3,
    name: "Maya Sari",
    role: "Agent",
    status: "away",
    activeChats: 0,
    totalChats: 156,
    rating: 4.8,
    responseTime: "1.8 mnt"
  }
];

export default function HumanAgent() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Human Agent</h1>
          <p className="text-muted-foreground">Kelola tim customer service dan assignment chat</p>
        </div>
        <Button>
          <UserPlus className="w-4 h-4 mr-2" />
          Tambah Agent
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Agent</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">12</div>
            <p className="text-xs text-success">8 Online, 4 Offline</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Chat Aktif</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">47</div>
            <p className="text-xs text-muted-foreground">Ditangani human agent</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Rata-rata Rating</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">4.8</div>
            <p className="text-xs text-success">↗ +0.1 dari bulan lalu</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Escalation Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">22%</div>
            <p className="text-xs text-muted-foreground">Dari AI ke human</p>
          </CardContent>
        </Card>
      </div>

      {/* Agent List */}
      <Card>
        <CardHeader>
          <CardTitle>Daftar Agent</CardTitle>
          <CardDescription>
            Kelola performa dan assignment tim customer service
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {agents.map((agent) => (
              <div key={agent.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="relative">
                    <Avatar className="w-12 h-12">
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {agent.name.split(' ').map(n => n[0]).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-background ${
                      agent.status === 'online' ? 'bg-success' : 
                      agent.status === 'away' ? 'bg-warning' : 'bg-muted-foreground'
                    }`}></div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{agent.name}</h3>
                    <p className="text-sm text-muted-foreground">{agent.role}</p>
                    <div className="flex items-center space-x-4 mt-1">
                      <Badge variant={agent.status === 'online' ? 'default' : 'secondary'}>
                        {agent.status === 'online' ? 'Online' : 
                         agent.status === 'away' ? 'Away' : 'Offline'}
                      </Badge>
                      <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                        <Star className="w-3 h-3 fill-warning text-warning" />
                        <span>{agent.rating}</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-6">
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{agent.activeChats}</p>
                    <p className="text-xs text-muted-foreground">Chat Aktif</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{agent.totalChats}</p>
                    <p className="text-xs text-muted-foreground">Total Chat</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{agent.responseTime}</p>
                    <p className="text-xs text-muted-foreground">Avg Response</p>
                  </div>
                  <Button variant="outline" size="sm">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}