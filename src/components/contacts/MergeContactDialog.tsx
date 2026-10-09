import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Merge, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { displayName, errorMessage, formatWaId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Pick = { id: string; wa_id: string; name: string | null; profile_name: string | null; username: string | null };

// One customer who chats from two numbers or accounts (e.g. WhatsApp and
// Instagram): the other contact joins this one. Each number keeps its own
// chats, so replies still reach the right number.
export function MergeContactDialog({
  keep,
  open,
  onOpenChange,
  onDone,
}: {
  keep: Pick | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Pick | null>(null);
  const [busy, setBusy] = useState(false);
  const term = search.trim();

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["merge-candidates", keep?.id, term],
    enabled: open && !!keep && term.length >= 2,
    queryFn: async () => {
      const like = `%${term.replace(/[%_,()]/g, "")}%`;
      const { data, error } = await supabase
        .from("contacts")
        .select("id, wa_id, name, profile_name, username")
        .is("merged_into", null)
        .neq("id", keep!.id)
        .or(`name.ilike.${like},profile_name.ilike.${like},wa_id.ilike.${like},username.ilike.${like},email.ilike.${like}`)
        .limit(20);
      if (error) throw error;
      return data as Pick[];
    },
  });

  const close = (v: boolean) => {
    if (!v) {
      setSearch("");
      setChosen(null);
    }
    onOpenChange(v);
  };

  const merge = async () => {
    if (!keep || !chosen) return;
    setBusy(true);
    const { error } = await supabase.rpc("merge_contacts", { p_keep: keep.id, p_merge: chosen.id });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`${displayName(chosen)} digabung ke ${displayName(keep)}`);
    close(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Gabungkan kontak ke {keep ? displayName(keep) : ""}</DialogTitle>
          <DialogDescription>
            Untuk pelanggan yang sama dengan nomor atau akun berbeda. Data yang kosong diisi dari kontak lain, label dan
            pesanan disatukan. Chat tiap nomor tetap terpisah agar balasan sampai ke nomor yang benar.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari kontak lain: nama, nomor, username" className="pl-9" />
        </div>
        <ul className="max-h-64 divide-y overflow-y-auto rounded-md border" aria-label="Kontak yang bisa digabung">
          {term.length < 2 ? (
            <li className="p-3 text-sm text-muted-foreground">Ketik minimal 2 huruf.</li>
          ) : isFetching ? (
            <li className="p-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </li>
          ) : results.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground">Tidak ada kontak yang cocok.</li>
          ) : (
            results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setChosen(c)}
                  className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted", chosen?.id === c.id && "bg-primary/10")}
                  aria-pressed={chosen?.id === c.id}
                >
                  <span className="font-medium">{displayName(c)}</span>
                  <span className="text-xs text-muted-foreground">{formatWaId(c.wa_id, c.username)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Batal
          </Button>
          <Button onClick={merge} disabled={!chosen || busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Merge className="mr-2 h-4 w-4" />}
            Gabungkan{chosen ? ` ${displayName(chosen)}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
