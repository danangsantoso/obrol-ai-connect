import { Link } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { useState } from "react";
import { CalendarClock, LogOut, ShieldCheck, User } from "lucide-react";
import { SecurityDialog } from "@/components/auth/SecurityDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFollowupChats } from "@/hooks/useFollowupAlerts";
import { PushControl } from "./PushControl";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, type Profile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, displayName, errorMessage, initials } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const AGENT_STATUS: { value: Profile["status"]; label: string; dot: string }[] = [
  { value: "online", label: "Online", dot: "bg-success" },
  { value: "away", label: "Away", dot: "bg-warning" },
  { value: "offline", label: "Offline", dot: "bg-muted-foreground" },
];

export function Header() {
  const { profile, signOut, refreshProfile } = useAuth();
  const [security, setSecurity] = useState(false);
  if (!profile) return null;

  const name = profile.full_name || profile.email;
  const current = AGENT_STATUS.find((s) => s.value === profile.status) ?? AGENT_STATUS[2];

  const setStatus = async (status: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ status: status as Profile["status"] })
      .eq("id", profile.id);
    if (error) toast.error(errorMessage(error));
    await refreshProfile();
  };

  return (
    <header className="flex h-14 items-center justify-end gap-3 border-b border-border bg-card px-6">
      <PushControl />
      {profile.role !== "agent" && <FollowupBell orgId={profile.organization_id!} />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-3 px-2">
            <div className="relative">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                  {initials(name) || <User className="h-4 w-4" />}
                </AvatarFallback>
              </Avatar>
              <span
                className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card", current.dot)}
              />
            </div>
            <div className="hidden text-left md:block">
              <p className="text-sm font-medium leading-tight">{name}</p>
              <p className="text-xs leading-tight text-muted-foreground">{ROLE_LABELS[profile.role]}</p>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">{profile.email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Status</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={profile.status} onValueChange={setStatus}>
            {AGENT_STATUS.map((s) => (
              <DropdownMenuRadioItem key={s.value} value={s.value}>
                <span className={cn("mr-2 h-2 w-2 rounded-full", s.dot)} />
                {s.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setSecurity(true)}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            Verifikasi 2 langkah
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => signOut()} className="text-danger">
            <LogOut className="mr-2 h-4 w-4" />
            Keluar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SecurityDialog open={security} onOpenChange={setSecurity} />
    </header>
  );
}

// Browsers only allow notification prompts from a user gesture.
// Supervisors and admins: open chats nobody has followed up for the set number of days.
function FollowupBell({ orgId }: { orgId: string }) {
  const { data = [], days } = useFollowupChats(orgId, true);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Chat belum di-follow up: ${data.length}`}>
          <CalendarClock className="h-5 w-5" />
          {data.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-white">
              {data.length > 99 ? "99+" : data.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b p-3">
          <p className="text-sm font-semibold">Belum di-follow up &gt; {days} hari</p>
          <p className="text-xs text-muted-foreground">Chat terbuka tanpa pesan masuk maupun keluar selama {days} hari.</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {data.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">Semua chat sudah di-follow up 👍</p>}
          {data.map((c) => (
            <Link key={c.id} to={`/inbox/${c.id}`} className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm hover:bg-muted">
              <span className="truncate">{c.contact ? displayName(c.contact) : "Pelanggan"}</span>
              <span className="shrink-0 text-xs text-warning">
                {c.last_message_at ? formatDistanceToNowStrict(new Date(c.last_message_at), { locale: localeId }) : ""}
              </span>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
