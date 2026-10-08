import { Link, NavLink, useNavigate } from "react-router-dom";
import { ChevronLeft, MessageCircle, ShoppingBag, UserRound, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/api";
import { colorFor } from "./helpers";

// Screen frame: header on top, content scrolling in between, optional footer.
export function Screen({
  title,
  back,
  right,
  header,
  footer,
  children,
  className,
}: {
  title?: React.ReactNode;
  back?: string | true;
  right?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex h-[100dvh] flex-col bg-[#f4f6fb] text-slate-900">
      {header ?? (
        <header className="flex min-h-[60px] items-center gap-1 border-b border-slate-200 bg-white px-2 pt-[env(safe-area-inset-top)]">
          {back ? (
            back === true ? (
              <button aria-label="Kembali" onClick={() => navigate(-1)} className="flex h-11 w-11 items-center justify-center">
                <ChevronLeft className="h-6 w-6" />
              </button>
            ) : (
              <Link aria-label="Kembali" to={back} className="flex h-11 w-11 items-center justify-center">
                <ChevronLeft className="h-6 w-6" />
              </Link>
            )
          ) : (
            <span className="w-3" />
          )}
          <h1 className={cn("min-w-0 flex-1 truncate text-lg font-extrabold", back && "text-base font-bold")}>{title}</h1>
          {right}
        </header>
      )}
      <main className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</main>
      {footer}
    </div>
  );
}

const NAV = [
  { to: "/m/inbox", label: "Inbox", icon: MessageCircle },
  { to: "/m/kontak", label: "Kontak", icon: UsersRound },
  { to: "/m/pesanan", label: "Pesanan", icon: ShoppingBag },
  { to: "/m/akun", label: "Akun", icon: UserRound },
];

export function BottomNav({ unread = 0 }: { unread?: number }) {
  return (
    <nav aria-label="Menu utama" className="grid grid-cols-4 border-t border-slate-200 bg-white px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "relative flex min-h-[52px] flex-col items-center justify-center gap-1 text-xs",
              isActive ? "font-bold text-primary" : "font-semibold text-slate-600",
            )
          }
        >
          <Icon className="h-6 w-6" />
          {label}
          {to === "/m/inbox" && unread > 0 && (
            <span className="absolute left-1/2 top-1 ml-2 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function Avatar({ name, url, size = 48, seed, className }: { name: string; url?: string | null; size?: number; seed?: string; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size / 3) };
  if (url) return <img src={url} alt={name} style={style} className={cn("shrink-0 rounded-full object-cover", className)} />;
  return (
    <span
      aria-hidden
      style={{ ...style, background: colorFor(seed ?? name) }}
      className={cn("flex shrink-0 items-center justify-center rounded-full font-bold text-white", className)}
    >
      {initials(name) || "?"}
    </span>
  );
}

const CHANNEL: Record<string, { label: string; color: string }> = {
  cloud_api: { label: "WA", color: "#15803d" },
  qr: { label: "WA", color: "#15803d" },
  instagram: { label: "IG", color: "#be185d" },
  messenger: { label: "FB", color: "#1d4ed8" },
  telegram: { label: "TG", color: "#0369a1" },
  webchat: { label: "WEB", color: "#475569" },
};

export function ChannelBadge({ provider }: { provider?: string | null }) {
  const c = CHANNEL[provider ?? "cloud_api"] ?? CHANNEL.cloud_api;
  return (
    <span
      style={{ background: c.color }}
      className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#f4f6fb] px-0.5 text-[8px] font-extrabold text-white"
    >
      {c.label}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="grid gap-1 rounded-2xl bg-slate-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl text-[13px] font-bold",
              on ? "bg-white text-slate-900 shadow-sm" : "text-slate-600",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn("rounded-lg px-1.5 text-[11px]", on ? "bg-primary text-white" : "bg-slate-200 text-slate-700")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-2xl bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-700">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-6 py-12 text-center text-sm text-slate-500">{children}</p>;
}
