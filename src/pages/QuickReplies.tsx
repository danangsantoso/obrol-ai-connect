import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { useQuickReplies } from "@/components/inbox/useInboxData";
import type { QuickReply } from "@/components/inbox/types";
import { toast } from "sonner";

const EMPTY = { shortcut: "", body: "", shared: false };

export default function QuickReplies() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const canShare = profile!.role !== "agent";
  const queryClient = useQueryClient();
  const { data: replies = [] } = useQuickReplies(orgId);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["quick-replies", orgId] });

  const canEdit = (q: QuickReply) => q.owner_id === profile!.id || (q.owner_id === null && canShare);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const values = {
      shortcut: form.shortcut.trim().toLowerCase().replace(/^\//, ""),
      body: form.body.trim(),
      owner_id: form.shared ? null : profile!.id,
    };
    const { error } = editing
      ? await supabase.from("quick_replies").update(values).eq("id", editing)
      : await supabase.from("quick_replies").insert({ ...values, organization_id: orgId });
    if (error) {
      toast.error(
        error.message.includes("quick_replies_shortcut_check")
          ? "Shortcut hanya boleh huruf kecil, angka, - atau _ (maks. 32)"
          : errorMessage(error),
      );
      return;
    }
    toast.success(editing ? "Balasan cepat diperbarui" : "Balasan cepat ditambahkan");
    setForm(EMPTY);
    setEditing(null);
    refresh();
  };

  const remove = async (id: string) => {
    if (!window.confirm("Hapus balasan cepat ini?")) return;
    const { error } = await supabase.from("quick_replies").delete().eq("id", id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Balasan Cepat</h1>
        <p className="text-muted-foreground">
          Ketik <kbd className="rounded border px-1">/</kbd> diikuti shortcut di kolom balasan. Tulis{" "}
          <code>{"{nama}"}</code> untuk menyisipkan nama pelanggan.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{editing ? "Ubah balasan cepat" : "Tambah balasan cepat"}</CardTitle>
          <CardDescription>
            Balasan pribadi hanya terlihat oleh Anda.
            {canShare && " Balasan bersama dipakai seluruh tim."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="max-w-2xl space-y-4">
            <div className="space-y-2">
              <Label htmlFor="qr-shortcut">Shortcut</Label>
              <Input
                id="qr-shortcut"
                placeholder="salam"
                value={form.shortcut}
                onChange={(e) => setForm({ ...form, shortcut: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qr-body">Isi pesan</Label>
              <Textarea
                id="qr-body"
                rows={4}
                placeholder="Halo Kak {nama}, terima kasih sudah menghubungi kami. Ada yang bisa kami bantu?"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
              />
            </div>
            {canShare && (
              <div className="flex items-center gap-3">
                <Switch
                  id="qr-shared"
                  checked={form.shared}
                  onCheckedChange={(v) => setForm({ ...form, shared: v })}
                />
                <Label htmlFor="qr-shared">Bagikan ke seluruh tim</Label>
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit">{editing ? "Simpan" : "Tambah"}</Button>
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setForm(EMPTY);
                  }}
                >
                  Batal
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          {replies.length === 0 && <p className="p-6 text-sm text-muted-foreground">Belum ada balasan cepat.</p>}
          {replies.map((q) => (
            <div key={q.id} className="flex items-start gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="font-semibold text-primary">/{q.shortcut}</code>
                  <Badge variant="outline">{q.owner_id ? "Pribadi" : "Bersama"}</Badge>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{q.body}</p>
              </div>
              {canEdit(q) && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Ubah"
                    onClick={() => {
                      setEditing(q.id);
                      setForm({ shortcut: q.shortcut, body: q.body, shared: q.owner_id === null });
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Hapus" onClick={() => remove(q.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
