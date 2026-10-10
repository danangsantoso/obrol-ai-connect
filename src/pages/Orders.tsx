import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { OrderDetail, StatusBadge } from "@/components/orders/OrderDetail";
import { trackingLabel } from "@/components/orders/orders";
import { ORDER_STATUS, type OrderItem, formatDateTime, rupiah } from "@/components/orders/orders";
import { downloadCsv } from "@/lib/csv";

const PAID = ["paid", "processing", "shipped", "completed"];

export default function Orders() {
  const { profile } = useAuth();
  const orgId = profile!.organization_id!;
  const [status, setStatus] = useState("all");
  const [days, setDays] = useState("30");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: orders = [] } = useQuery({
    queryKey: ["orders", orgId, days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .gte("created_at", new Date(Date.now() - Number(days) * 86_400_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (status === "all" || o.status === status) &&
        (!q || [o.number, o.customer_name, o.phone, o.tracking_number].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [orders, status, search]);

  const paid = orders.filter((o) => PAID.includes(o.status));
  const cards = [
    { label: "Menunggu pembayaran", value: String(orders.filter((o) => o.status === "awaiting_payment").length) },
    { label: "Pesanan lunas", value: String(paid.length) },
    { label: "Omzet (lunas)", value: rupiah(paid.reduce((n, o) => n + Number(o.total), 0)) },
    { label: "Dibuat AI", value: `${orders.filter((o) => o.created_by_ai).length} pesanan` },
  ];

  const exportCsv = () => {
    const header = ["Nomor", "Tanggal", "Status", "Pelanggan", "HP", "Alamat", "Kota", "Kode pos", "Produk", "Subtotal", "Ongkir", "Diskon", "Total", "Kurir", "Resi", "Dibayar"];
    const rows = visible.map((o) => [
      o.number, formatDateTime(o.created_at), ORDER_STATUS[o.status]?.label ?? o.status, o.customer_name, o.phone, o.address, o.city, o.postal_code,
      (o.items as unknown as OrderItem[]).map((i) => `${i.qty}x ${i.name}`).join("; "),
      o.subtotal, o.shipping_cost, o.discount, o.total, [o.courier, o.courier_service].filter(Boolean).join(" "), o.tracking_number, formatDateTime(o.paid_at),
    ]);
    downloadCsv(`pesanan-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Pesanan</h1>
        <p className="text-muted-foreground">Pesanan dari chat, status pembayaran, dan pengiriman.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{c.label}</p>
              <p className="text-2xl font-bold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nomor, nama, HP, resi" className="w-64 pl-8" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Status pesanan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua status</SelectItem>
            {Object.entries(ORDER_STATUS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40" aria-label="Periode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 hari terakhir</SelectItem>
            <SelectItem value="30">30 hari terakhir</SelectItem>
            <SelectItem value="90">90 hari terakhir</SelectItem>
            <SelectItem value="365">1 tahun</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv} disabled={!visible.length} className="ml-auto">
          <Download className="mr-1 h-4 w-4" /> Ekspor CSV
        </Button>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor</TableHead>
                <TableHead>Pelanggan</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tanggal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Belum ada pesanan. Buat dari tombol "Pesanan" di chat, atau izinkan AI membuat pesanan di Pengaturan.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => setOpenId(o.id)} data-testid="order-row">
                  <TableCell className="font-medium">
                    {o.number}
                    {o.created_by_ai && <span className="ml-1 text-xs text-primary">AI</span>}
                  </TableCell>
                  <TableCell>{o.customer_name ?? "-"}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-sm">
                    {(o.items as unknown as OrderItem[]).map((i) => `${i.qty}x ${i.name}`).join(", ")}
                  </TableCell>
                  <TableCell className="text-right">{rupiah(o.total)}</TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                    {o.status === "shipped" && o.tracking_status && <p className="mt-0.5 text-xs text-muted-foreground">{trackingLabel(o.tracking_status)}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{formatDateTime(o.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <OrderDetail orderId={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  );
}
