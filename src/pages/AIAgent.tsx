import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Bot, 
  Brain, 
  Upload, 
  Play, 
  Pause, 
  Settings, 
  FileText,
  MessageSquare,
  Zap,
  CheckCircle,
  Send
} from "lucide-react";

export default function AIAgent() {
  const [isAIActive, setIsAIActive] = useState(true);
  const [responseTime, setResponseTime] = useState("5");
  const [greeting, setGreeting] = useState("Halo! Saya adalah asisten AI Obrol.AI. Ada yang bisa saya bantu?");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">AI Agent</h1>
          <p className="text-muted-foreground">Kelola dan latih bot AI untuk respons otomatis 24/7</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Switch 
              checked={isAIActive} 
              onCheckedChange={setIsAIActive}
              id="ai-toggle"
            />
            <Label htmlFor="ai-toggle" className="text-sm font-medium">
              AI Agent {isAIActive ? "Aktif" : "Nonaktif"}
            </Label>
          </div>
          <Badge className={isAIActive ? "bg-success" : "bg-muted"}>
            {isAIActive ? "ONLINE" : "OFFLINE"}
          </Badge>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Chat Dijawab AI</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">78%</div>
            <p className="text-xs text-success">↗ +5% dari minggu lalu</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Rata-rata Respons</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">1.2 detik</div>
            <p className="text-xs text-success">↗ -0.3 detik</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tingkat Akurasi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">94%</div>
            <p className="text-xs text-success">↗ +2% dari minggu lalu</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Escalasi ke Human</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">22%</div>
            <p className="text-xs text-muted-foreground">↘ -3% dari minggu lalu</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="training" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="training">Training Bot</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
          <TabsTrigger value="settings">Pengaturan</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        {/* Training Tab */}
        <TabsContent value="training" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Brain className="w-5 h-5" />
                  <span>Upload FAQ</span>
                </CardTitle>
                <CardDescription>
                  Upload file FAQ untuk melatih AI memahami pertanyaan umum
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-2">
                    Drag & drop file FAQ atau klik untuk upload
                  </p>
                  <Button variant="outline">
                    <Upload className="w-4 h-4 mr-2" />
                    Pilih File
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    Format: .txt, .csv, .xlsx (Max 10MB)
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center space-x-2">
                      <FileText className="w-4 h-4" />
                      <span>faq-produk.txt</span>
                    </span>
                    <Badge variant="outline">Trained</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center space-x-2">
                      <FileText className="w-4 h-4" />
                      <span>panduan-pemesanan.csv</span>
                    </span>
                    <Badge variant="outline">Trained</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Zap className="w-5 h-5" />
                  <span>Training Manual</span>
                </CardTitle>
                <CardDescription>
                  Tambahkan pengetahuan khusus untuk respons yang lebih akurat
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="question">Pertanyaan</Label>
                  <Input 
                    id="question"
                    placeholder="Contoh: Bagaimana cara melakukan refund?"
                  />
                </div>
                <div>
                  <Label htmlFor="answer">Jawaban</Label>
                  <Textarea 
                    id="answer"
                    placeholder="Masukkan jawaban yang ingin AI berikan..."
                    rows={4}
                  />
                </div>
                <Button className="w-full">
                  <Brain className="w-4 h-4 mr-2" />
                  Tambah ke Training
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Knowledge Base Tab */}
        <TabsContent value="knowledge" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Knowledge Base</CardTitle>
              <CardDescription>
                Kelola database pengetahuan AI untuk respons yang lebih baik
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { title: "Informasi Produk", items: 45, status: "active" },
                  { title: "Kebijakan Toko", items: 12, status: "active" },
                  { title: "Panduan Pembayaran", items: 8, status: "active" },
                  { title: "FAQ Pengiriman", items: 23, status: "active" },
                  { title: "Promo & Diskon", items: 15, status: "updating" },
                  { title: "Customer Service", items: 18, status: "active" }
                ].map((kb, index) => (
                  <div key={index} className="p-4 border border-border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">{kb.title}</h4>
                      <Badge variant={kb.status === "active" ? "default" : "secondary"}>
                        {kb.status === "active" ? "Aktif" : "Update"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {kb.items} item pengetahuan
                    </p>
                    <Button variant="outline" size="sm" className="w-full">
                      Edit
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Pengaturan Umum</CardTitle>
                <CardDescription>
                  Konfigurasi dasar AI Agent
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="greeting-message">Pesan Sambutan</Label>
                  <Textarea 
                    id="greeting-message"
                    value={greeting}
                    onChange={(e) => setGreeting(e.target.value)}
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="response-time">Waktu Respons (detik)</Label>
                  <Input 
                    id="response-time"
                    type="number"
                    value={responseTime}
                    onChange={(e) => setResponseTime(e.target.value)}
                    min="1"
                    max="60"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-escalation ke Human</Label>
                    <p className="text-xs text-muted-foreground">
                      Pindahkan chat ke human agent jika AI tidak bisa menjawab
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pengaturan Lanjutan</CardTitle>
                <CardDescription>
                  Konfigurasi behavior AI yang lebih detail
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Deteksi Emosi</Label>
                    <p className="text-xs text-muted-foreground">
                      AI akan menyesuaikan tone berdasarkan emosi customer
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Learning Mode</Label>
                    <p className="text-xs text-muted-foreground">
                      AI akan belajar dari interaksi untuk meningkatkan respons
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Multilingual Support</Label>
                    <p className="text-xs text-muted-foreground">
                      Mendukung bahasa Indonesia, Inggris, dan daerah
                    </p>
                  </div>
                  <Switch />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Preview Tab */}
        <TabsContent value="preview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <MessageSquare className="w-5 h-5" />
                <span>Test AI Response</span>
              </CardTitle>
              <CardDescription>
                Preview bagaimana AI akan merespons pertanyaan customer
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/20 rounded-lg p-4 h-80 overflow-y-auto mb-4">
                <div className="space-y-4">
                  <div className="flex justify-start">
                    <div className="bg-muted p-3 rounded-lg max-w-xs">
                      <p className="text-sm">Halo, ada produk skincare untuk jerawat?</p>
                      <span className="text-xs text-muted-foreground">You • 14:20</span>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-primary text-primary-foreground p-3 rounded-lg max-w-xs">
                      <div className="flex items-center space-x-1 mb-1">
                        <Bot className="w-3 h-3" />
                        <span className="text-xs">AI Agent</span>
                      </div>
                      <p className="text-sm">
                        Halo! Tentu, kami memiliki beberapa produk skincare yang efektif untuk mengatasi jerawat. 
                        Kami punya serum niacinamide dan clay mask yang sangat recommended. 
                        Mau saya kirimkan detail lengkapnya?
                      </p>
                      <span className="text-xs opacity-70">AI • 14:20</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex space-x-2">
                <Input placeholder="Ketik pertanyaan untuk test AI..." className="flex-1" />
                <Button>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}