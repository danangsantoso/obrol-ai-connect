import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { useSignedUrl } from "@/components/inbox/useInboxData";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

type AiMedia = Tables<"ai_media">;

const TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
// WhatsApp's limits: images 5 MB; PDFs are kept to 16 MB.
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_PDF = 16 * 1024 * 1024;

const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

function Thumb({ item }: { item: AiMedia }) {
  const url = useSignedUrl(item.mime_type.startsWith("image/") ? item.file_path : null);
  if (item.mime_type === "application/pdf") {
    return (
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700">
        <FileText className="h-6 w-6" />
      </span>
    );
  }
  return url ? <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" /> : <span className="h-14 w-14 shrink-0 animate-pulse rounded-md bg-muted" />;
}

// Photos and PDFs the AI agent may send in a chat.
export function AiMediaCard({ orgId }: { orgId: string }) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const canManage = profile?.role === "admin" || profile?.role === "supervisor";
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["ai-media", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_media").select("*").eq("organization_id", orgId).order("created_at");
      if (error) throw error;
      return data;
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ai-media", orgId] });

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!TYPES.includes(f.type)) return toast.error("Hanya gambar JPG, PNG, WebP, atau PDF");
    if (f.size > (f.type === "application/pdf" ? MAX_PDF : MAX_IMAGE)) {
      return toast.error(f.type === "application/pdf" ? "PDF maksimal 16 MB" : "Gambar maksimal 5 MB");
    }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 120));
  };

  const upload = async () => {
    if (!file || !title.trim()) return;
    setBusy(true);
    try {
      const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${orgId}/ai-media/${crypto.randomUUID()}-${safe}`;
      const up = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
      if (up.error) throw up.error;
      const { error } = await supabase.from("ai_media").insert({
        organization_id: orgId,
        title: title.trim(),
        description: description.trim(),
        file_path: path,
        file_name: file.name.slice(0, 200),
        mime_type: file.type,
        size_bytes: file.size,
        created_by: profile?.id,
      });
      if (error) {
        await supabase.storage.from("media").remove([path]);
        throw error;
      }
      toast.success("File ditambahkan untuk AI");
      setFile(null);
      setTitle("");
      setDescription("");
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item: AiMedia, on: boolean) => {
    const { error } = await supabase.from("ai_media").update({ is_active: on }).eq("id", item.id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };
  const remove = async (item: AiMedia) => {
    if (!window.confirm(`Hapus "${item.title}"? AI tidak akan mengirim file ini lagi.`)) return;
    const { error } = await supabase.from("ai_media").delete().eq("id", item.id);
    if (error) return toast.error(errorMessage(error));
    await supabase.storage.from("media").remove([item.file_path]);
    toast.success("File dihapus");
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gambar &amp; PDF yang bisa dikirim AI</CardTitle>
        <CardDescription>
          Foto produk, katalog, daftar harga, atau brosur. AI mengirimkannya saat pelanggan meminta atau saat sesuai keterangan Anda, tepat setelah
          balasannya. Paling banyak 3 file per balasan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {canManage && (
          <div className="max-w-3xl space-y-3 rounded-lg border border-dashed p-4">
            <input
              ref={fileInput}
              type="file"
              accept={TYPES.join(",")}
              className="hidden"
              aria-label="Pilih gambar atau PDF untuk AI"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
                <Upload className="mr-1 h-4 w-4" /> Pilih file
              </Button>
              <span className="text-sm text-muted-foreground">{file ? `${file.name} · ${sizeLabel(file.size)}` : "JPG, PNG, WebP (maks. 5 MB) atau PDF (maks. 16 MB)"}</span>
            </div>
            {file && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="ai-media-title">Nama file (terlihat AI dan pelanggan)</Label>
                  <Input id="ai-media-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Katalog Kopi Oktober" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ai-media-desc">Kapan dikirim</Label>
                  <Textarea
                    id="ai-media-desc"
                    rows={2}
                    maxLength={500}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Saat pelanggan menanyakan daftar harga atau varian kopi"
                  />
                </div>
                <Button onClick={upload} disabled={busy || !title.trim()}>
                  {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Tambahkan
                </Button>
              </>
            )}
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada file. AI hanya membalas dengan teks.</p>
        ) : (
          <ul className="max-w-3xl divide-y rounded-lg border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 p-3">
                <Thumb item={item} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.mime_type === "application/pdf" ? "PDF" : "Gambar"} · {sizeLabel(item.size_bytes)}
                    {item.description ? ` · ${item.description}` : ""}
                  </p>
                </div>
                {canManage && (
                  <>
                    <Switch checked={item.is_active} onCheckedChange={(v) => toggle(item, v)} aria-label={`AI boleh mengirim ${item.title}`} />
                    <Button variant="ghost" size="icon" onClick={() => remove(item)} aria-label={`Hapus ${item.title}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
