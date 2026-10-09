// Customer segments computed by the database (contact_segment).
export const SEGMENTS = [
  { value: "baru", label: "Pelanggan baru", description: "1 pesanan, masih aktif", className: "bg-primary/10 text-primary" },
  { value: "langganan", label: "Langganan", description: "2+ pesanan, masih aktif", className: "bg-success/15 text-success" },
  { value: "tidur", label: "Tidur", description: "pernah pesan, lama tidak pesan lagi", className: "bg-warning/15 text-warning" },
  { value: "prospek", label: "Prospek", description: "chat 30 hari terakhir, belum pernah pesan", className: "bg-muted text-foreground" },
] as const;
export const segmentOf = (v: string | null | undefined) => SEGMENTS.find((s) => s.value === v);
