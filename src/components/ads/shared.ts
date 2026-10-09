import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Dates as the organization sees them (YYYY-MM-DD in Asia/Jakarta).
const day = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

export const PERIODS = [
  { value: "7", label: "7 hari terakhir" },
  { value: "30", label: "30 hari terakhir" },
  { value: "month", label: "Bulan ini" },
  { value: "prev", label: "Bulan lalu" },
] as const;

export function periodRange(period: string) {
  const now = new Date();
  const today = day(now);
  if (period === "month") return { p_from: `${today.slice(0, 7)}-01`, p_to: today };
  if (period === "prev") {
    const first = new Date(`${today.slice(0, 7)}-01T00:00:00+07:00`);
    const lastPrev = new Date(first.getTime() - 86_400_000);
    return { p_from: `${day(lastPrev).slice(0, 7)}-01`, p_to: day(lastPrev) };
  }
  return { p_from: day(new Date(now.getTime() - (Number(period) - 1) * 86_400_000)), p_to: today };
}

// Rp12,45 jt · Rp9.696
export function rpShort(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1_000_000_000) return `Rp${(v / 1_000_000_000).toFixed(2).replace(".", ",")} M`;
  if (Math.abs(v) >= 1_000_000) return `Rp${(v / 1_000_000).toFixed(2).replace(".", ",")} jt`;
  return `Rp${Math.round(v).toLocaleString("id-ID")}`;
}

export const ratio = (a: number, b: number, digits = 2) => (b ? (a / b).toFixed(digits).replace(".", ",") : "–");
export const percent = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1).replace(".", ",")}%` : "–");

export function useAdSettings(orgId: string) {
  return useQuery({
    queryKey: ["ad-settings", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("ad_settings").select("*").eq("organization_id", orgId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export const SOURCE_LABEL: Record<string, string> = { ctwa: "Iklan → WhatsApp", link: "Landing page" };
