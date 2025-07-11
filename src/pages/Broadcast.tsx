import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Send, 
  Calendar, 
  Users, 
  MessageSquare,
  Plus,
  Eye,
  MoreVertical,
  CheckCircle,
  Clock,
  X
} from "lucide-react";

const campaigns = [
  {
    id: 1,
    name: "Promo Akhir Tahun",
    platform: ["WhatsApp", "Instagram"],
    status: "scheduled",
    scheduledAt: "2024-12-31 10:00",
    recipients: 1250,
    sent: 0,
    opened: 0
  },
  {
    id: 2,
    name: "Update Produk Baru",
    platform: ["WhatsApp", "Facebook"],
    status: "completed",
    scheduledAt: "2024-12-15 14:00",
    recipients: 890,
    sent: 890,
    opened: 678
  },
  {
    id: 3,
    name: "Follow Up Abandoned Cart",
    platform: ["WhatsApp"],
    status: "running",
    scheduledAt: "2024-12-20 09:00",
    recipients: 456,
    sent: 234,
    opened: 156
  }
];

export default function Broadcast() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Broadcast Pesan</h1>
          <p className="text-muted-foreground">Kirim pesan massal ke seluruh customer di berbagai platform</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Buat Kampanye Baru
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Kampanye</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">24</div>
            <p className="text-xs text-success">3 aktif, 21 selesai</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pesan Terkirim</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">15.2K</div>
            <p className="text-xs text-success">Bulan ini</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">76%</div>
            <p className="text-xs text-success">↗ +5% dari bulan lalu</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Response Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">23%</div>
            <p className="text-xs text-success">↗ +2% dari bulan lalu</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="campaigns" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="campaigns">Kampanye</TabsTrigger>
          <TabsTrigger value="create">Buat Baru</TabsTrigger>
          <TabsTrigger value="templates">Template</TabsTrigger>
        </TabsList>

        {/* Campaigns Tab */}
        <TabsContent value="campaigns" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Daftar Kampanye</CardTitle>
              <CardDescription>
                Kelola dan pantau performa kampanye broadcast
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {campaigns.map((campaign) => (
                  <div key={campaign.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="font-semibold text-foreground">{campaign.name}</h3>
                        <Badge 
                          variant={
                            campaign.status === "completed" ? "default" :
                            campaign.status === "running" ? "secondary" : "outline"
                          }
                        >
                          {campaign.status === "completed" ? "Selesai" :
                           campaign.status === "running" ? "Berjalan" : "Terjadwal"}
                        </Badge>
                      </div>
                      <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                        <span className="flex items-center space-x-1">
                          <Calendar className="w-4 h-4" />
                          <span>{campaign.scheduledAt}</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <Users className="w-4 h-4" />
                          <span>{campaign.recipients} penerima</span>
                        </span>
                        <div className="flex space-x-1">
                          {campaign.platform.map((platform) => (
                            <Badge key={platform} variant="outline" className="text-xs">
                              {platform}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-6">
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground">{campaign.sent}</p>
                        <p className="text-xs text-muted-foreground">Terkirim</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground">{campaign.opened}</p>
                        <p className="text-xs text-muted-foreground">Dibuka</p>
                      </div>
                      <div className="flex space-x-2">
                        <Button variant="outline" size="sm">
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="sm">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Create Campaign Tab */}
        <TabsContent value="create" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Detail Kampanye</CardTitle>
                <CardDescription>
                  Atur nama, platform, dan penjadwalan kampanye
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="campaign-name">Nama Kampanye</Label>
                  <Input 
                    id="campaign-name"
                    placeholder="Masukkan nama kampanye..."
                  />
                </div>
                <div>
                  <Label>Platform Target</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {["WhatsApp", "Instagram", "Facebook", "TikTok"].map((platform) => (
                      <label key={platform} className="flex items-center space-x-2 p-2 border border-border rounded cursor-pointer hover:bg-muted/50">
                        <input type="checkbox" className="rounded" />
                        <span className="text-sm">{platform}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="schedule">Jadwal Kirim</Label>
                  <Input 
                    id="schedule"
                    type="datetime-local"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Konten Pesan</CardTitle>
                <CardDescription>
                  Tulis pesan yang akan dikirim ke customer
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="message">Pesan</Label>
                  <Textarea 
                    id="message"
                    placeholder="Tulis pesan broadcast..."
                    rows={6}
                  />
                </div>
                <div>
                  <Label>Penerima</Label>
                  <div className="space-y-2 mt-2">
                    <label className="flex items-center space-x-2">
                      <input type="radio" name="recipients" value="all" defaultChecked />
                      <span className="text-sm">Semua kontak (1,234 orang)</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input type="radio" name="recipients" value="label" />
                      <span className="text-sm">Berdasarkan label</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input type="radio" name="recipients" value="custom" />
                      <span className="text-sm">Pilih manual</span>
                    </label>
                  </div>
                </div>
                <Button className="w-full">
                  <Send className="w-4 h-4 mr-2" />
                  Kirim Kampanye
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Template Pesan</CardTitle>
              <CardDescription>
                Template siap pakai untuk berbagai kebutuhan broadcast
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { name: "Promo Flash Sale", category: "Marketing", usage: 45 },
                  { name: "Follow Up Order", category: "Customer Service", usage: 23 },
                  { name: "Reminder Pembayaran", category: "Payment", usage: 67 },
                  { name: "Update Produk", category: "Product", usage: 12 },
                  { name: "Ucapan Selamat", category: "Greeting", usage: 8 },
                  { name: "Survey Kepuasan", category: "Feedback", usage: 34 }
                ].map((template, index) => (
                  <div key={index} className="p-4 border border-border rounded-lg">
                    <h4 className="font-medium mb-2">{template.name}</h4>
                    <div className="flex items-center justify-between mb-3">
                      <Badge variant="outline">{template.category}</Badge>
                      <span className="text-xs text-muted-foreground">{template.usage} kali digunakan</span>
                    </div>
                    <Button variant="outline" size="sm" className="w-full">
                      Gunakan Template
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}