import { LogOut, User } from "lucide-react";
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
import { ROLE_LABELS, errorMessage, initials } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const AGENT_STATUS: { value: Profile["status"]; label: string; dot: string }[] = [
  { value: "online", label: "Online", dot: "bg-success" },
  { value: "away", label: "Away", dot: "bg-warning" },
  { value: "offline", label: "Offline", dot: "bg-muted-foreground" },
];

export function Header() {
  const { profile, signOut, refreshProfile } = useAuth();
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
    <header className="flex h-14 items-center justify-end border-b border-border bg-card px-6">
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
          <DropdownMenuItem onClick={() => signOut()} className="text-danger">
            <LogOut className="mr-2 h-4 w-4" />
            Keluar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
