import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, Loader2, Pencil, Plus, Shuffle, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { percent, periodRange, rpShort } from "@/components/ads/shared";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
// URL parameters per ad platform: campaign, ad set / ad group and ad reach the link.
const AD_PARAMS = [
  {
    platform: "Meta Ads Manager → iklan → Parameter URL",
    value:
      "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}",
  },
  {
    platform: "Google Ads → kampanye → Setelan → Opsi URL kampanye → Akhiran URL final (gclid otomatis bila tag otomatis aktif)",
    value: "utm_source=google&utm_medium=cpc&campaign_id={campaignid}&adset_id={adgroupid}&ad_id={creative}",
  },
  {
    platform: "TikTok Ads Manager → iklan → URL → Tambah parameter (ttclid otomatis)",
    value:
      "utm_source=tiktok&utm_medium=paid&campaign_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&adset_id=__AID__&adset_name=__AID_NAME__&ad_id=__CID__&ad_name=__CID_NAME__",
  },
];

const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Disalin"));
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

type WaLink = {
  id: string;
  name: string;
  slug: string;
  channel_id: string | null;
  channel_ids: string[];
  agent_ids: string[];
  message: string;
  campaign_name: string | null;
};

const EMPTY = { name: "", slug: "", channel_ids: [] as string[], agent_ids: [] as string[], message: "Halo kak, saya mau tanya", campaign_name: "" };

function toggleIn(list: string[], id: string, on: boolean) {
  return on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id);
}

function useRotatorOptions(orgId: string) {
  const channels = useQuery({
    queryKey: ["wa-channels", orgId],
    queryFn: async () =>
      (
        await supabase
          .from("channels")
          .select("id, name, display_phone, provider, connection_status")
          .in("provider", ["cloud_api", "qr"])
          .eq("is_active", true)
          .order("created_at")
      ).data ?? [],
  });
  const agents = useQuery({
    queryKey: ["org-people", orgId],
    queryFn: async () =>
      (await supabase.from("profiles").select("id, full_name, email, status, role").eq("organization_id", orgId).eq("is_active", true).order("full_name"))
        .data ?? [],
  });
  return { channels: channels.data ?? [], agents: agents.data ?? [] };
}

function LinkDialog({
  open,
  onOpenChange,
  orgId,
  userId,
  link,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  userId: string;
  link: WaLink | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const { channels, agents } = useRotatorOptions(orgId);

  useEffect(() => {
    if (!open) return;
    setForm(
      link
        ? {
            name: link.name,
            slug: link.slug,
            channel_ids: link.channel_ids.length ? link.channel_ids : link.channel_id ? [link.channel_id] : [],
            agent_ids: link.agent_ids,
            message: link.message,
            campaign_name: link.campaign_name ?? "",
          }
        : EMPTY,
    );
  }, [open, link]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const row = {
      name: form.name.trim(),
      channel_id: form.channel_ids.length === 1 ? form.channel_ids[0] : null,
      channel_ids: form.channel_ids.length > 1 ? form.channel_ids : [],
      agent_ids: form.agent_ids,
      message: form.message.trim(),
      campaign_name: form.campaign_name.trim() || null,
    };
    const { error } = link
      ? await supabase.from("wa_links").update(row).eq("id", link.id)
      : await supabase.from("wa_links").insert({ ...row, organization_id: orgId, slug: form.slug || slugify(form.name), created_by: userId });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "Alamat link sudah dipakai, ganti alamatnya." : errorMessage(error));
    toast.success(link ? "Link disimpan" : "Link dibuat");
    qc.invalidateQueries({ queryKey: ["wa-links"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{link ? `Ubah link · ${link.name}` : "Link WhatsApp baru"}</DialogTitle>
            <DialogDescription>Satu link per landing page atau per kampanye. Pilih beberapa nomor / CS agar chat dibagi rata (rotator).</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="ln-name">Nama link</Label>
            <Input
              id="ln-name"
              required
              maxLength={80}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="mis. Landing Kopi Gayo"
            />
          </div>
          {!link && (
            <div className="space-y-1">
              <Label htmlFor="ln-slug">Alamat</Label>
              <div className="flex items-center gap-1 text-sm">
                <span className="shrink-0 text-muted-foreground">…/wa/</span>
                <Input
                  id="ln-slug"
                  value={form.slug}
                  placeholder={slugify(form.name) || "landing-kopi"}
                  onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })}
                />
              </div>
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Nomor WhatsApp tujuan</legend>
            <p className="text-xs text-muted-foreground">
              {form.channel_ids.length > 1
                ? `Bergiliran ke ${form.channel_ids.length} nomor. Nomor yang terputus dilewati.`
                : form.channel_ids.length === 1
                  ? "Semua klik ke nomor ini."
                  : "Tidak dipilih: nomor WhatsApp pertama."}
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {channels.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={form.channel_ids.includes(c.id)}
                    onCheckedChange={(v) => setForm({ ...form, channel_ids: toggleIn(form.channel_ids, c.id, v === true) })}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {c.name}
                    <span className="block text-xs text-muted-foreground">{c.display_phone ?? "nomor belum tampil"}</span>
                  </span>
                  {c.provider === "qr" && c.connection_status !== "connected" && (
                    <Badge variant="outline" className="text-[10px]">
                      terputus
                    </Badge>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">CS yang menerima chat (opsional)</legend>
            <p className="text-xs text-muted-foreground">
              {form.agent_ids.length
                ? `Chat baru langsung diberikan bergiliran ke ${form.agent_ids.length} CS; yang online didahulukan.`
                : "Tidak dipilih: chat dibagi seperti biasa (AI / rotasi tim)."}
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={form.agent_ids.includes(a.id)}
                    onCheckedChange={(v) => setForm({ ...form, agent_ids: toggleIn(form.agent_ids, a.id, v === true) })}
                  />
                  <span className="min-w-0 flex-1 truncate">{a.full_name || a.email}</span>
                  <span
                    className={cn("h-2 w-2 rounded-full", a.status === "online" ? "bg-success" : "bg-muted-foreground/40")}
                    title={a.status === "online" ? "Online" : "Offline"}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="ln-camp">Nama kampanye (opsional)</Label>
            <Input
              id="ln-camp"
              value={form.campaign_name}
              onChange={(e) => setForm({ ...form, campaign_name: e.target.value })}
              placeholder="dipakai bila iklan tidak mengirim namanya"
            />
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
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {link ? "Simpan" : "Buat link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Clicks, chats and closings per number and CS of a rotator link.
function RotatorStats({ link, orgId, range }: { link: WaLink; orgId: string; range: { p_from: string; p_to: string } }) {
  const { channels, agents } = useRotatorOptions(orgId);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["wa-link-rotation", link.id, range],
    queryFn: async () => (await supabase.rpc("wa_link_rotation_stats", { p_link: link.id, ...range })).data ?? [],
  });
  const group = (key: "channel_id" | "agent_id") => {
    const m = new Map<string, { clicks: number; chats: number; closings: number; revenue: number }>();
    for (const r of rows) {
      const k = r[key] ?? "-";
      const v = m.get(k) ?? { clicks: 0, chats: 0, closings: 0, revenue: 0 };
      m.set(k, {
        clicks: v.clicks + Number(r.clicks),
        chats: v.chats + Number(r.chats),
        closings: v.closings + Number(r.closings),
        revenue: v.revenue + Number(r.revenue),
      });
    }
    return [...m.entries()];
  };
  const name = (key: "channel_id" | "agent_id", id: string) =>
    id === "-"
      ? key === "agent_id"
        ? "Tanpa CS tetap"
        : "—"
      : key === "channel_id"
        ? (channels.find((c) => c.id === id)?.name ?? "Nomor terhapus")
        : (agents.find((a) => a.id === id)?.full_name ?? "CS nonaktif");
  if (isLoading) return <Loader2 className="m-3 h-4 w-4 animate-spin text-muted-foreground" />;
  if (!rows.length) return <p className="p-3 text-sm text-muted-foreground">Belum ada klik di periode ini.</p>;
  return (
    <div className="grid gap-4 p-3 md:grid-cols-2">
      {(["channel_id", "agent_id"] as const).map((key) => (
        <div key={key}>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{key === "channel_id" ? "Per nomor" : "Per CS"}</p>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-normal" />
                <th className="text-right font-normal">Klik</th>
                <th className="text-right font-normal">Chat</th>
                <th className="text-right font-normal">Closing</th>
                <th className="text-right font-normal">Omzet</th>
              </tr>
            </thead>
            <tbody>
              {group(key).map(([id, v]) => (
                <tr key={id} className="border-t">
                  <td className="py-1">{name(key, id)}</td>
                  <td className="text-right tabular-nums">{v.clicks}</td>
                  <td className="text-right tabular-nums">{v.chats}</td>
                  <td className="text-right tabular-nums">{v.closings}</td>
                  <td className="text-right tabular-nums">{rpShort(v.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default function AdLinks() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WaLink | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const range = useMemo(() => periodRange("30"), []);

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["wa-links", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("wa_links").select("*").order("created_at", { ascending: false });
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
          <h1 className="text-2xl font-bold">Link WhatsApp & rotator CS</h1>
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
                Tambahkan parameter URL di iklan (pilih platformnya):
                {AD_PARAMS.map((p) => (
                  <div key={p.platform} className="mt-1.5">
                    <p className="text-xs text-muted-foreground">{p.platform}</p>
                    <div className="flex gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{p.value}</code>
                      <Button size="sm" variant="outline" onClick={() => copy(p.value)} aria-label={`Salin parameter ${p.platform.split(" ")[0]}`}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <p className="mt-1">Dengan ini lead dan closing masuk ke platform, kampanye dan iklan yang tepat, dan biaya iklannya cocok.</p>
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
            <p>
              2. Mereka menekan tombol WhatsApp. Balas.id mencatat klik itu (platform, iklan, UTM, fbclid / gclid / ttclid), memilih nomor & CS gilirannya, dan
              membuat kode, mis. <b>#K7P2</b>.
            </p>
            <p>3. WhatsApp terbuka dengan pesan pembuka + kode. Chat masuk ke Balas.id, ditandai “dari iklan” dan langsung ke CS gilirannya.</p>
            <p>
              4. Balas.id mengirim <b>Lead</b> ke platform iklannya (Meta / Google / TikTok). Saat closing, dikirim <b>Purchase</b> + nilai rupiah.
            </p>
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
                    const rotator = l.channel_ids.length > 1 || l.agent_ids.length > 0;
                    return (
                      <Fragment key={l.id}>
                        <TableRow>
                          <TableCell>
                            <p className="font-medium">
                              {l.name}{" "}
                              {l.campaign_name && (
                                <Badge variant="outline" className="ml-1">
                                  {l.campaign_name}
                                </Badge>
                              )}
                              {rotator && (
                                <button
                                  type="button"
                                  onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                                  className="ml-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
                                  aria-expanded={expanded === l.id}
                                >
                                  <Shuffle className="h-3 w-3" /> Rotator {Math.max(l.channel_ids.length, 1)} nomor
                                  {l.agent_ids.length > 0 && ` · ${l.agent_ids.length} CS`}
                                  <ChevronDown className={cn("h-3 w-3 transition-transform", expanded === l.id && "rotate-180")} />
                                </button>
                              )}
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
                          <TableCell className="whitespace-nowrap">
                            <Button size="sm" variant="ghost" onClick={() => setEditing(l)} aria-label={`Ubah ${l.name}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(l.id, l.name)} aria-label={`Hapus ${l.name}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {expanded === l.id && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={8} className="p-0">
                              <RotatorStats link={l} orgId={orgId} range={range} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <LinkDialog
        open={open || editing !== null}
        onOpenChange={(v) => {
          if (!v) {
            setOpen(false);
            setEditing(null);
          }
        }}
        orgId={orgId}
        userId={profile!.id}
        link={editing}
      />
    </div>
  );
}
