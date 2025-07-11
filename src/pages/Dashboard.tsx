import { StatsCard } from "@/components/dashboard/StatsCard";
import { ChatChart } from "@/components/dashboard/ChatChart";
import { ChannelStatus } from "@/components/dashboard/ChannelStatus";
import { RecentChats } from "@/components/dashboard/RecentChats";
import { 
  MessageSquare, 
  Users, 
  TrendingUp, 
  Clock,
  Bot,
  CheckCircle,
  AlertCircle,
  DollarSign
} from "lucide-react";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-dashboard rounded-xl p-6 border border-border">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Selamat datang di Obrol.AI 👋
        </h1>
        <p className="text-muted-foreground">
          Kelola semua percakapan pelanggan Anda dalam satu dashboard yang powerful.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Total Chat Hari Ini"
          value="156"
          change="+12% dari kemarin"
          changeType="positive"
          icon={MessageSquare}
        />
        <StatsCard
          title="Agent Aktif"
          value="8"
          change="3 AI + 5 Human"
          changeType="neutral"
          icon={Users}
        />
        <StatsCard
          title="Tingkat Respons"
          value="94%"
          change="+2% dari minggu lalu"
          changeType="positive"
          icon={TrendingUp}
        />
        <StatsCard
          title="Rata-rata Respons"
          value="2.5 mnt"
          change="-30 detik dari kemarin"
          changeType="positive"
          icon={Clock}
        />
      </div>

      {/* Chart and Channel Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ChatChart />
        </div>
        <div>
          <ChannelStatus />
        </div>
      </div>

      {/* Additional Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="AI Automation"
          value="78%"
          change="Chat ditangani AI"
          changeType="positive"
          icon={Bot}
        />
        <StatsCard
          title="Chat Selesai"
          value="89"
          change="Hari ini"
          changeType="neutral"
          icon={CheckCircle}
        />
        <StatsCard
          title="Pending Response"
          value="12"
          change="Perlu perhatian"
          changeType="negative"
          icon={AlertCircle}
        />
        <StatsCard
          title="Revenue Hari Ini"
          value="Rp 2.5M"
          change="+15% dari kemarin"
          changeType="positive"
          icon={DollarSign}
        />
      </div>

      {/* Recent Chats */}
      <RecentChats />
    </div>
  );
}