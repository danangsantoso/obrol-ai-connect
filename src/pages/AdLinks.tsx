import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { toast } from "sonner";
import { percent, periodRange, rpShort } from "@/components/ads/shared";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const AUTO = "auto";
const AD_PARAMS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}";

const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Disalin"));
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function NewLinkDialog({ open, onOpenChange, orgId, userId }: { open: boolean; onOpenChange: (v: boolean) => void; orgId: string; userId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", slug: "", channel_id: AUTO, message: "Halo kak, saya mau tanya", campaign_name: "" });
  const [busy, setBusy] = useState(false);
  const { data: channels = [] } = useQuery({
    queryKey: ["wa-channels", orgId],
    queryFn: async () =>
      (await supabase.from("channels").select("id, name, display_phone").in("provider", ["cloud_api", "qr"]).eq("is_active", true).order("created_at")).data ?? [],
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("wa_links").insert({
      organization_id: orgId,
      name: form.name.trim(),
      slug: form.slug || slugify(form.name),
      channel_id: form.channel_id === AUTO ? null : form.channel_id,
      message: form.message.trim(),
      campaign_name: form.campaign_name.trim() || null,
      created_by: userId,
    });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "Alamat link sudah dipakai, ganti alamatnya." : errorMessage(error));
    toast.success("Link dibuat");
    qc.invalidateQueries({ queryKey: ["wa-links"] });
    setForm({ name: "", slug: "", channel_id: AUTO, message: "Halo kak, saya mau tanya", campaign_name: "" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Link WhatsApp baru</DialogTitle>
            <DialogDescription>Satu link per landing page atau per kampanye.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="ln-name">Nama link</Label>
            <Input id="ln-name" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Landing Kopi Gayo" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ln-slug">Alamat</Label>
            <div className="flex items-center gap-1 text-sm">
              <span className="shrink-0 text-muted-foreground">…/wa/</span>
              <Input id="ln-slug" value={form.slug} placeholder={slugify(form.name) || "landing-kopi"} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ln-channel">Nomor tujuan</Label>
              <Select value={form.channel_id} onValueChange={(v) => setForm({ ...form, channel_id: v })}>
                <SelectTrigger id="ln-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>Nomor WhatsApp pertama</SelectItem>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.display_phone ? ` · ${c.display_phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ln-camp">Nama kampanye (opsional)</Label>
              <Input id="ln-camp" value={form.campaign_name} onChange={(e) => setForm({ ...form, campaign_name: e.target.value })} placeholder="dipakai bila iklan tidak mengirim namanya" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ln-msg">Pesan pembuka di WhatsApp</Label>
            <Textarea id="ln-msg" rows={2} required maxLength={480} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            <p className="text-xs text-muted-foreground">Kode pelacak ditambahkan otomatis di akhir, mis. “… (#K7P2)”. Agen tidak melihat kodenya.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Buat link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdLinks() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const range = useMemo(() => periodRange("30"), []);

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["wa-links", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("wa_links").select("*, channel:channels(name)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: stats = [] } = useQuery({
    queryKey: ["wa-link-stats", orgId, range],
    queryFn: async () => (await supabase.rpc("wa_link_stats", range)).data ?? [],
  });
  const statOf = (id: string) => stats.find((s) => s.link_id === id);

  const toggle = async (id: string, is_active: boolean) => {
    const { error } = await supabase.from("wa_links").update({ is_active }).eq("id", id);
    if (error) toast.error(errorMessage(error));
    qc.invalidateQueries({ queryKey: ["wa-links"] });
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Hapus link "${name}"? Tombol yang masih memakainya tidak akan bisa dibuka.`)) return;
    const { error } = await supabase.from("wa_links").delete().eq("id", id);
    if (error) toast.error(errorMessage(error));
    qc.invalidateQueries({ queryKey: ["wa-links"] });
  };

  const script = `<script src="${FUNCTIONS_URL}/wa/t.js" defer></script>`;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <Link to="/ads" className="text-sm font-medium text-primary">
            ← Iklan
          </Link>
          <h1 className="text-2xl font-bold">Link WhatsApp untuk landing page</h1>
          <p className="max-w-3xl text-muted-foreground">
            Pasang link ini di tombol WhatsApp landing page. Balas.id mencatat klik dari iklan, lalu membuka WhatsApp dengan kode pendek, sehingga chat yang
            masuk tersambung ke iklannya.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Link baru
        </Button>
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cara pasang</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Buat link, lalu ganti link tombol WhatsApp di landing page dengan link itu.</li>
              <li>
                Tempel 1 baris ini di bagian <code>&lt;head&gt;</code> landing page (WordPress: plugin header/footer; builder lain: “custom code”). Gunanya
                meneruskan data klik Facebook ke link:
                <div className="mt-1 flex gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{script}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(script)} aria-label="Salin script">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </li>
              <li>
                Di Ads Manager, pada iklan → <b>Parameter URL</b>, tempel:
                <div className="mt-1 flex gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{AD_PARAMS}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(AD_PARAMS)} aria-label="Salin parameter URL">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                Dengan ini lead dan closing masuk ke kampanye dan iklan yang tepat, dan biaya iklannya cocok.
              </li>
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cara kerjanya</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>1. Orang klik iklan dan masuk ke landing page.</p>
            <p>2. Mereka menekan tombol WhatsApp. Balas.id mencatat klik itu (iklan, UTM, fbclid) dan membuat kode, mis. <b>#K7P2</b>.</p>
            <p>3. WhatsApp terbuka dengan pesan pembuka + kode. Chat masuk ke Balas.id dan langsung ditandai “dari iklan”.</p>
            <p>4. Balas.id mengirim <b>Lead</b> ke Meta. Saat closing, dikirim <b>Purchase</b> + nilai rupiah.</p>
            <p className="rounded-md border border-orange-200 bg-orange-50 p-2 text-orange-900">
              Iklan yang langsung ke WhatsApp (tanpa landing page) tidak perlu link ini: data iklannya ikut otomatis bersama pesan pertama.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Link · 30 hari terakhir</CardTitle>
          <CardDescription>Klik → chat menunjukkan berapa pengunjung yang benar-benar mengirim chat.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <Loader2 className="m-6 h-5 w-5 animate-spin text-muted-foreground" />
          ) : links.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Belum ada link. Klik “Link baru”.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Link</TableHead>
                    <TableHead className="text-right">Klik</TableHead>
                    <TableHead className="text-right">Chat</TableHead>
                    <TableHead className="text-right">Klik → chat</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Omzet</TableHead>
                    <TableHead>Aktif</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {links.map((l) => {
                    const st = statOf(l.id);
                    const url = `${FUNCTIONS_URL}/wa/${l.slug}`;
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          <p className="font-medium">
                            {l.name} {l.campaign_name && <Badge variant="outline" className="ml-1">{l.campaign_name}</Badge>}
                          </p>
                          <div className="flex items-center gap-1">
                            <code className="truncate text-xs text-muted-foreground">{url}</code>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy(url)} aria-label={`Salin link ${l.name}`}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{Number(st?.clicks ?? 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(st?.chats ?? 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{percent(Number(st?.chats ?? 0), Number(st?.clicks ?? 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(st?.closings ?? 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rpShort(st?.revenue ?? 0)}</TableCell>
                        <TableCell>
                          <Switch checked={l.is_active} onCheckedChange={(v) => toggle(l.id, v)} aria-label={`Aktifkan ${l.name}`} />
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(l.id, l.name)} aria-label={`Hapus ${l.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <NewLinkDialog open={open} onOpenChange={setOpen} orgId={orgId} userId={profile!.id} />
    </div>
  );
}
