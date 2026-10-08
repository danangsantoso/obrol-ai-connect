import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Sequence = Tables<"followup_sequences">;
export type Step = Tables<"followup_steps">;
export type Enrollment = Tables<"followup_enrollments">;
export type SequenceWithSteps = Sequence & { followup_steps: Step[] };

export interface StepDraft {
  delay_days: number;
  delay_hours: number;
  message: string;
  template_name: string | null;
  template_language: string | null;
}

export const MAX_STEPS = 10;

export const VARIABLES: { key: string; label: string }[] = [
  { key: "{sapaan}", label: "Kak/Bapak/Ibu + nama" },
  { key: "{nama}", label: "Nama depan" },
  { key: "{agen}", label: "Nama agen" },
  { key: "{bot}", label: "Nama bot AI" },
  { key: "{toko}", label: "Nama bisnis" },
];

// Seven prepared, gentle daily follow-ups for a customer who asked and went quiet.
export const EXAMPLE_SEQUENCE: { name: string; description: string; steps: StepDraft[] } = {
  name: "Prospek diam 7 lapis",
  description: "Untuk pelanggan yang sudah bertanya tetapi belum membalas lagi. Berhenti otomatis saat pelanggan membalas.",
  steps: [
    [1, "Halo *{sapaan}* 👋 {agen} dari {toko} di sini. Kemarin sempat ngobrol soal kebutuhannya, apakah masih ada yang ingin ditanyakan? Saya siap bantu 😊"],
    [1, "Selamat pagi *{sapaan}* ☀️ Sekadar mengingatkan, produk yang kemarin ditanyakan masih tersedia ya. Mau saya bantu cekkan stok dan ongkirnya?"],
    [1, "Halo *{sapaan}* 🙏 Banyak pelanggan kami awalnya juga ragu, tapi setelah mencoba mereka puas. Kalau ada yang bikin ragu (harga, kualitas, atau pengiriman), cerita saja ke saya ya."],
    [2, "*{sapaan}*, kalau butuh, saya bisa bantu carikan pilihan atau paket yang paling hemat sesuai budget 🎁 Boleh tahu kisaran budgetnya?"],
    [2, "Halo *{sapaan}* 😊 Apakah ada pertanyaan yang belum terjawab? Saya bisa bantu pilihkan yang paling cocok dengan kebutuhan {nama}."],
    [3, "*{sapaan}*, saya tidak ingin {nama} kehabisan 🙏 Kalau berkenan, balas *YA* dan saya bantu proses pesanannya sekarang juga."],
    [7, "Terima kasih sudah menghubungi {toko}, *{sapaan}* 🙏 Ini pesan terakhir dari saya supaya tidak mengganggu. Kapan pun butuh, tinggal balas chat ini ya, {agen} siap membantu 😊"],
  ].map(([days, message]) => ({
    delay_days: days as number,
    delay_hours: 0,
    message: message as string,
    template_name: null,
    template_language: null,
  })),
};

// Same substitution as the server (supabase/functions/_shared/followup.ts).
export function renderFollowup(
  text: string,
  ctx: { name: string | null; salutation?: string | null; agent?: string | null; bot: string; shop: string },
): string {
  const first = ctx.name?.trim().split(/\s+/)[0] || null;
  const call = !first
    ? "Kak"
    : ctx.salutation === "name_only"
      ? first
      : ctx.salutation === "bapak_ibu"
        ? `Bapak/Ibu ${first}`
        : `Kak ${first}`;
  const values: Record<string, string> = {
    nama: first ?? "Kak",
    sapaan: call,
    agen: ctx.agent || ctx.bot,
    bot: ctx.bot,
    toko: ctx.shop,
  };
  return text.replace(/\{(nama|sapaan|agen|bot|toko)\}/gi, (_, key: string) => values[key.toLowerCase()]);
}

export const STATUS_INFO: Record<string, { label: string; className: string }> = {
  active: { label: "Berjalan", className: "bg-primary/10 text-primary" },
  replied: { label: "Membalas", className: "bg-success/15 text-success" },
  completed: { label: "Selesai, tanpa balasan", className: "bg-muted text-muted-foreground" },
  stopped: { label: "Dihentikan", className: "bg-warning/15 text-warning" },
  failed: { label: "Gagal", className: "bg-destructive/10 text-destructive" },
};

export function delayLabel(days: number, hours: number, first: boolean) {
  const parts = [days ? `${days} hari` : "", hours ? `${hours} jam` : ""].filter(Boolean).join(" ");
  if (!parts) return first ? "Langsung saat mulai" : "Langsung setelah lapis sebelumnya";
  return first ? `${parts} setelah mulai` : `${parts} setelah lapis sebelumnya`;
}

export function useSequences(orgId: string) {
  return useQuery({
    queryKey: ["followup-sequences", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("followup_sequences")
        .select("*, followup_steps(*)")
        .order("created_at");
      if (error) throw error;
      return (data as SequenceWithSteps[]).map((s) => ({
        ...s,
        followup_steps: [...s.followup_steps].sort((a, b) => a.position - b.position),
      }));
    },
  });
}

export function formatWhen(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
