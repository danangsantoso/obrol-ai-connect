import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FileUp, Loader2, Package, Pencil, Plus, Trash2, Upload } from "lucide-react";
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
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { errorMessage } from "@/lib/api";
import { parseCsv } from "@/lib/csv";
import { extractText, KNOWLEDGE_ACCEPT, MAX_KNOWLEDGE_CHARS } from "@/lib/extractText";
import { toast } from "sonner";

type Product = Tables<"products">;
type Doc = Pick<Tables<"knowledge_docs">, "id" | "product_id" | "title" | "source" | "file_name" | "updated_at" | "char_count">;

const GENERAL = "__general__";

const rupiah = (n: number | null) => (n === null ? "–" : `Rp${Number(n).toLocaleString("id-ID")}`);

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const EMPTY_PRODUCT = { name: "", sku: "", price: "", summary: "", keywords: "", is_active: true };

function ProductDialog({
  orgId,
  product,
  open,
  onOpenChange,
  onSaved,
}: {
  orgId: string;
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [saving, setSaving] = useState(false);
  const [lastOpened, setLastOpened] = useState<Product | null | undefined>(undefined);
  if (open && lastOpened !== product) {
    setLastOpened(product);
    setForm(
      product
        ? {
          name: product.name,
          sku: product.sku ?? "",
          price: product.price === null ? "" : String(product.price),
          summary: product.summary,
          keywords: product.keywords,
          is_active: product.is_active,
        }
        : EMPTY_PRODUCT,
    );
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const row = {
      organization_id: orgId,
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      price: form.price.trim() ? Number(form.price.replace(/[^\d.]/g, "")) : null,
      summary: form.summary.trim(),
      keywords: form.keywords.trim(),
      is_active: form.is_active,
    };
    const { error } = product
      ? await supabase.from("products").update(row).eq("id", product.id)
      : await supabase.from("products").insert(row);
    setSaving(false);
    if (error) {
      toast.error(error.code === "23505" ? "Nama produk sudah ada" : errorMessage(error));
      return;
    }
    toast.success("Produk disimpan");
    setLastOpened(undefined);
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setLastOpened(undefined); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product ? "Ubah produk" : "Tambah produk"}</DialogTitle>
          <DialogDescription>Ringkasan produk selalu dibaca AI. Detail panjang taruh di dokumen pengetahuan.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="p-name">Nama produk</Label>
              <Input id="p-name" value={form.name} maxLength={160} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-price">Harga (Rp)</Label>
              <Input id="p-price" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-sku">SKU</Label>
              <Input id="p-sku" value={form.sku} maxLength={80} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-summary">Ringkasan</Label>
            <Textarea id="p-summary" rows={3} maxLength={2000} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Ukuran, varian, keunggulan utama" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-keywords">Nama lain / kata kunci</Label>
            <Input id="p-keywords" value={form.keywords} maxLength={500} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="contoh: madu, honey, madu kalimantan" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            Aktif (dijual dan dibahas AI)
          </label>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PRODUCT_COLUMNS: Record<string, string[]> = {
  name: ["nama", "name", "produk", "nama produk", "product"],
  price: ["harga", "price"],
  sku: ["sku", "kode"],
  summary: ["deskripsi", "description", "ringkasan", "summary", "keterangan"],
  keywords: ["kata kunci", "keywords", "alias"],
};

async function importProductsCsv(orgId: string, file: File): Promise<number> {
  const rows = parseCsv(await file.text());
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const index = (key: string) => header.findIndex((h) => PRODUCT_COLUMNS[key].includes(h));
  const col = { name: index("name"), price: index("price"), sku: index("sku"), summary: index("summary"), keywords: index("keywords") };
  if (col.name === -1) throw new Error('Kolom nama produk tidak ditemukan. Beri judul kolom "nama".');
  const value = (row: string[], i: number) => (i >= 0 ? row[i]?.trim() ?? "" : "");
  const byName = new Map<string, TablesInsert<"products">>();
  for (const row of rows.slice(1)) {
    const name = value(row, col.name);
    if (!name) continue;
    const price = value(row, col.price).replace(/[^\d]/g, "");
    byName.set(name.toLowerCase(), {
      organization_id: orgId,
      name: name.slice(0, 160),
      price: price ? Number(price) : null,
      sku: value(row, col.sku) || null,
      summary: value(row, col.summary).slice(0, 2000),
      keywords: value(row, col.keywords).slice(0, 500),
    });
  }
  const list = [...byName.values()];
  if (!list.length) throw new Error("Tidak ada baris produk.");
  const { error } = await supabase.from("products").upsert(list, { onConflict: "organization_id,name" });
  if (error) throw error;
  return list.length;
}

// ---------------------------------------------------------------------------
// Knowledge documents
// ---------------------------------------------------------------------------

function DocDialog({
  orgId,
  products,
  doc,
  defaultProductId,
  open,
  onOpenChange,
  onSaved,
}: {
  orgId: string;
  products: Product[];
  doc: Doc | null;
  defaultProductId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [productId, setProductId] = useState(GENERAL);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  const key = open ? doc?.id ?? `new:${defaultProductId}` : null;
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setProductId(doc?.product_id ?? defaultProductId ?? GENERAL);
    setTitle(doc?.title ?? "");
    setFileName(doc?.file_name ?? null);
    setContent("");
    if (doc) {
      supabase
        .from("knowledge_docs")
        .select("content")
        .eq("id", doc.id)
        .single()
        .then(({ data }) => setContent(data?.content ?? ""));
    }
  }

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const text = await extractText(file);
      setContent(text.slice(0, MAX_KNOWLEDGE_CHARS));
      setFileName(file.name);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 200));
      if (text.length > MAX_KNOWLEDGE_CHARS) toast.warning("File terlalu panjang, hanya 300.000 karakter pertama yang dipakai");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReading(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const row = {
      organization_id: orgId,
      product_id: productId === GENERAL ? null : productId,
      title: title.trim(),
      content: content.trim(),
      source: fileName ? "file" : "text",
      file_name: fileName,
    };
    const { error } = doc
      ? await supabase.from("knowledge_docs").update(row).eq("id", doc.id)
      : await supabase.from("knowledge_docs").insert({ ...row, created_by: profile!.id });
    setSaving(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success("Pengetahuan disimpan");
    setLoadedFor(undefined);
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setLoadedFor(undefined); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{doc ? "Ubah pengetahuan" : "Tambah pengetahuan"}</DialogTitle>
          <DialogDescription>
            Unggah PDF, Word (DOCX), TXT, MD, atau CSV, atau tempel teksnya. Contoh: spesifikasi, FAQ, cara pakai, garansi,
            ongkir, cara bayar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Untuk produk</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger aria-label="Produk">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GENERAL}>Umum (semua produk)</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-title">Judul</Label>
              <Input id="doc-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                {reading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />}
                Pilih file
                <input
                  type="file"
                  accept={KNOWLEDGE_ACCEPT}
                  className="sr-only"
                  data-testid="knowledge-file"
                  onChange={(e) => {
                    readFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="doc-content">Isi</Label>
            <Textarea
              id="doc-content"
              rows={12}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Tempel teks di sini, atau pilih file di atas"
              required
            />
            <p className="text-xs text-muted-foreground">{content.length.toLocaleString("id-ID")} karakter</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || reading || !content.trim()}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function KnowledgeTab({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [productDialog, setProductDialog] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [docDialog, setDocDialog] = useState<{ open: boolean; doc: Doc | null; productId: string | null }>({ open: false, doc: null, productId: null });
  const [importing, setImporting] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["products", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: docs = [] } = useQuery({
    queryKey: ["knowledge-docs", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_docs")
        .select("id, product_id, title, source, file_name, updated_at, char_count")
        .order("title");
      if (error) throw error;
      return data as Doc[];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["products", orgId] });
    queryClient.invalidateQueries({ queryKey: ["knowledge-docs", orgId] });
  };

  const docsByProduct = useMemo(() => {
    const map = new Map<string, Doc[]>();
    for (const d of docs) {
      const k = d.product_id ?? GENERAL;
      map.set(k, [...(map.get(k) ?? []), d]);
    }
    return map;
  }, [docs]);

  const removeProduct = async (p: Product) => {
    if (!window.confirm(`Hapus produk "${p.name}" beserta dokumen pengetahuannya?`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };
  const removeDoc = async (d: Doc) => {
    if (!window.confirm(`Hapus "${d.title}"?`)) return;
    const { error } = await supabase.from("knowledge_docs").delete().eq("id", d.id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };
  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const n = await importProductsCsv(orgId, file);
      toast.success(`${n} produk diimpor`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  const docList = (list: Doc[] | undefined) =>
    (list ?? []).map((d) => (
      <div key={d.id} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {d.title}
          <span className="ml-2 text-xs text-muted-foreground">
            {d.file_name ? `${d.file_name} · ` : ""}
            {(d.char_count ?? 0).toLocaleString("id-ID")} karakter
          </span>
        </span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDocDialog({ open: true, doc: d, productId: d.product_id })} aria-label={`Ubah ${d.title}`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeDoc(d)} aria-label={`Hapus ${d.title}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    ));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Pengetahuan umum</CardTitle>
            <CardDescription>Berlaku untuk semua produk: profil toko, pengiriman, pembayaran, garansi, jam buka.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setDocDialog({ open: true, doc: null, productId: null })}>
            <Plus className="mr-1 h-4 w-4" /> Tambah
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {docList(docsByProduct.get(GENERAL))}
          {!docsByProduct.get(GENERAL)?.length && <p className="text-sm text-muted-foreground">Belum ada.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Produk ({products.length})</CardTitle>
            <CardDescription>
              Daftar produk selalu dibaca AI. Tiap produk bisa punya dokumen pengetahuan sendiri.
              Impor CSV: kolom <code>nama</code>, <code>harga</code>, <code>sku</code>, <code>deskripsi</code>, <code>kata kunci</code>.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <label className="cursor-pointer">
                {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
                Impor CSV
                <input
                  type="file"
                  accept=".csv"
                  className="sr-only"
                  data-testid="products-csv"
                  onChange={(e) => {
                    importCsv(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            <Button size="sm" onClick={() => setProductDialog({ open: true, product: null })}>
              <Plus className="mr-1 h-4 w-4" /> Produk
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>Harga</TableHead>
                <TableHead>Pengetahuan</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Belum ada produk.
                  </TableCell>
                </TableRow>
              )}
              {products.map((p) => (
                <TableRow key={p.id} className="align-top">
                  <TableCell className="w-1/3">
                    <div className="flex items-center gap-2 font-medium">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      {p.name}
                      {!p.is_active && <Badge variant="outline">Nonaktif</Badge>}
                    </div>
                    {p.summary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.summary}</p>}
                  </TableCell>
                  <TableCell>{rupiah(p.price)}</TableCell>
                  <TableCell className="space-y-1">
                    {docList(docsByProduct.get(p.id))}
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDocDialog({ open: true, doc: null, productId: p.id })}>
                      <Plus className="mr-1 h-3 w-3" /> Dokumen
                    </Button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => setProductDialog({ open: true, product: p })} aria-label={`Ubah ${p.name}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => removeProduct(p)} aria-label={`Hapus ${p.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProductDialog
        orgId={orgId}
        product={productDialog.product}
        open={productDialog.open}
        onOpenChange={(open) => setProductDialog((s) => ({ ...s, open }))}
        onSaved={refresh}
      />
      <DocDialog
        orgId={orgId}
        products={products}
        doc={docDialog.doc}
        defaultProductId={docDialog.productId}
        open={docDialog.open}
        onOpenChange={(open) => setDocDialog((s) => ({ ...s, open }))}
        onSaved={refresh}
      />
    </div>
  );
}
