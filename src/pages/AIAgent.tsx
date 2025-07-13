import { useState, useEffect } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function AIAgent() {
  const { user } = useAuth();
  const [isAIActive, setIsAIActive] = useState(true);
  const [responseTime, setResponseTime] = useState("5");
  const [greeting, setGreeting] = useState("Halo! Saya adalah asisten AI Obrol.AI. Ada yang bisa saya bantu?");
  const [knowledgeBase, setKnowledgeBase] = useState<any[]>([]);
  const [trainingData, setTrainingData] = useState<any[]>([]);
  const [stats, setStats] = useState({
    chatAnswered: 0,
    avgResponse: "0 detik",
    accuracy: "0%",
    escalation: "0%"
  });
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testResponse, setTestResponse] = useState("");

  useEffect(() => {
    if (user) {
      loadKnowledgeBase();
      loadTrainingData();
      loadStats();
    }
  }, [user]);

  const loadKnowledgeBase = async () => {
    try {
      const { data, error } = await supabase
        .from('ai_knowledge_base')
        .select('*')
        .eq('created_by', user?.id)
        .eq('is_active', true);
      
      if (error) throw error;
      setKnowledgeBase(data || []);
    } catch (error) {
      console.error('Error loading knowledge base:', error);
      toast.error('Gagal memuat knowledge base');
    }
  };

  const loadTrainingData = async () => {
    try {
      const { data, error } = await supabase
        .from('ai_training_data')
        .select('*')
        .eq('created_by', user?.id);
      
      if (error) throw error;
      setTrainingData(data || []);
    } catch (error) {
      console.error('Error loading training data:', error);
    }
  };

  const loadStats = async () => {
    try {
      // Get chat statistics
      const { data: sessions, error: sessionsError } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('user_id', user?.id);

      if (sessionsError) throw sessionsError;

      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('*, chat_sessions!inner(*)')
        .eq('chat_sessions.user_id', user?.id);

      if (messagesError) throw messagesError;

      // Calculate stats
      const totalMessages = messages?.length || 0;
      const aiMessages = messages?.filter(m => m.sender_type === 'ai')?.length || 0;
      const humanMessages = messages?.filter(m => m.sender_type === 'human')?.length || 0;
      
      const chatAnsweredPercent = totalMessages > 0 ? Math.round((aiMessages / totalMessages) * 100) : 0;
      const escalationPercent = totalMessages > 0 ? Math.round((humanMessages / totalMessages) * 100) : 0;

      setStats({
        chatAnswered: chatAnsweredPercent,
        avgResponse: "1.2 detik", // This would need real calculation in production
        accuracy: "94%", // This would need real calculation in production
        escalation: `${escalationPercent}%`
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const addTrainingData = async () => {
    if (!newQuestion.trim() || !newAnswer.trim()) {
      toast.error('Pertanyaan dan jawaban tidak boleh kosong');
      return;
    }

    try {
      const { error } = await supabase
        .from('ai_training_data')
        .insert({
          question: newQuestion,
          answer: newAnswer,
          created_by: user?.id,
          category: 'manual'
        });

      if (error) throw error;

      toast.success('Data training berhasil ditambahkan');
      setNewQuestion("");
      setNewAnswer("");
      loadTrainingData();
    } catch (error) {
      console.error('Error adding training data:', error);
      toast.error('Gagal menambahkan data training');
    }
  };

  const testAIResponse = async () => {
    if (!testMessage.trim()) {
      toast.error('Masukkan pesan untuk ditest');
      return;
    }

    try {
      // Simple test logic - check knowledge base
      const relevantKnowledge = knowledgeBase.find(kb => 
        testMessage.toLowerCase().includes(kb.question.toLowerCase()) ||
        kb.question.toLowerCase().includes(testMessage.toLowerCase())
      );

      if (relevantKnowledge) {
        setTestResponse(relevantKnowledge.answer);
      } else {
        setTestResponse("Maaf, saya belum memiliki informasi tentang hal tersebut. Apakah Anda ingin saya hubungkan dengan customer service kami?");
      }
    } catch (error) {
      console.error('Error testing AI response:', error);
      toast.error('Gagal menguji respons AI');
    }
  };

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
            <div className="text-2xl font-bold text-foreground">{stats.chatAnswered}%</div>
            <p className="text-xs text-success">Real-time data</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Rata-rata Respons</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.avgResponse}</div>
            <p className="text-xs text-success">Auto response</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tingkat Akurasi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.accuracy}</div>
            <p className="text-xs text-success">Berdasarkan feedback</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Escalasi ke Human</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.escalation}</div>
            <p className="text-xs text-muted-foreground">Butuh bantuan manusia</p>
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
                    value={newQuestion}
                    onChange={(e) => setNewQuestion(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="answer">Jawaban</Label>
                  <Textarea 
                    id="answer"
                    placeholder="Masukkan jawaban yang ingin AI berikan..."
                    rows={4}
                    value={newAnswer}
                    onChange={(e) => setNewAnswer(e.target.value)}
                  />
                </div>
                <Button className="w-full" onClick={addTrainingData}>
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
                {knowledgeBase.length > 0 ? knowledgeBase.map((kb) => (
                  <div key={kb.id} className="p-4 border border-border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">{kb.category}</h4>
                      <Badge variant="default">Aktif</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      Q: {kb.question}
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      A: {kb.answer.substring(0, 50)}...
                    </p>
                    <Button variant="outline" size="sm" className="w-full">
                      Edit
                    </Button>
                  </div>
                )) : (
                  <div className="col-span-full text-center py-8 text-muted-foreground">
                    Belum ada knowledge base. Tambahkan data training untuk memulai.
                  </div>
                )}
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
                  {testMessage && (
                    <div className="flex justify-start">
                      <div className="bg-muted p-3 rounded-lg max-w-xs">
                        <p className="text-sm">{testMessage}</p>
                        <span className="text-xs text-muted-foreground">Test • {new Date().toLocaleTimeString()}</span>
                      </div>
                    </div>
                  )}
                  {testResponse && (
                    <div className="flex justify-end">
                      <div className="bg-primary text-primary-foreground p-3 rounded-lg max-w-xs">
                        <div className="flex items-center space-x-1 mb-1">
                          <Bot className="w-3 h-3" />
                          <span className="text-xs">AI Agent</span>
                        </div>
                        <p className="text-sm">{testResponse}</p>
                        <span className="text-xs opacity-70">AI • {new Date().toLocaleTimeString()}</span>
                      </div>
                    </div>
                  )}
                  {!testMessage && !testResponse && (
                    <div className="text-center text-muted-foreground py-8">
                      Ketik pesan di bawah untuk menguji respons AI
                    </div>
                  )}
                </div>
              </div>
              <div className="flex space-x-2">
                <Input 
                  placeholder="Ketik pertanyaan untuk test AI..." 
                  className="flex-1"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && testMessage.trim()) {
                      testAIResponse();
                    }
                  }}
                />
                <Button onClick={testAIResponse} disabled={!testMessage.trim()}>
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