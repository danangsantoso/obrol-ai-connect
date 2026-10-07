import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { normalizePhone, parseCsv } from "@/lib/csv";
import { toast } from "sonner";

const COLUMNS: Record<string, string[]> = {
  phone: ["nomor", "no", "telepon", "phone", "hp", "whatsapp", "wa", "wa_id", "nomor whatsapp", "no hp"],
  name: ["nama", "name", "nama lengkap"],
  email: ["email", "e-mail"],
  company: ["perusahaan", "company", "divisi", "instansi"],
};

interface ParsedContact {
  wa_id: string;
  name: string | null;
  email: string | null;
  company: string | null;
}

function toContacts(rows: string[][]): { contacts: ParsedContact[]; skipped: number } {
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const index = (key: string) => header.findIndex((h) => COLUMNS[key].includes(h));
  const col = { phone: index("phone"), name: index("name"), email: index("email"), company: index("company") };
  if (col.phone === -1) throw new Error('Kolom nomor tidak ditemukan. Beri judul kolom "nomor" atau "phone".');

  const seen = new Set<string>();
  const contacts: ParsedContact[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const waId = normalizePhone(row[col.phone] ?? "");
    if (!waId || seen.has(waId)) {
      skipped++;
      continue;
    }
    seen.add(waId);
    const value = (i: number) => (i >= 0 ? row[i]?.trim() || null : null);
    contacts.push({ wa_id: waId, name: value(col.name), email: value(col.email), company: value(col.company) });
  }
  return { contacts, skipped };
}

export function ImportContactsDialog({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<{ contacts: ParsedContact[]; skipped: number } | null>(null);
  const [importing, setImporting] = useState(false);

  const readFile = async (file: File | undefined) => {
    setParsed(null);
    if (!file) return;
    try {
      setParsed(toContacts(parseCsv(await file.text())));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const importAll = async () => {
    if (!parsed) return;
    setImporting(true);
    try {
      let added = 0;
      for (let i = 0; i < parsed.contacts.length; i += 500) {
        const batch = parsed.contacts.slice(i, i + 500).map((c) => ({ ...c, organization_id: orgId }));
        // Existing contacts are left untouched; only new numbers are added.
        const { data, error } = await supabase
          .from("contacts")
          .upsert(batch, { onConflict: "organization_id,wa_id", ignoreDuplicates: true })
          .select("id");
        if (error) throw error;
        added += data.length;
      }
      const existing = parsed.contacts.length - added;
      toast.success(`${added} kontak baru diimpor${existing ? `, ${existing} sudah ada` : ""}`);
      setOpen(false);
      setParsed(null);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Impor CSV
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Impor kontak dari CSV</DialogTitle>
            <DialogDescription>
              Baris pertama berisi judul kolom: <code>nama</code>, <code>nomor</code>, <code>email</code>,{" "}
              <code>perusahaan</code>. Nomor seperti 0812… otomatis diubah ke format 62812…. File dari Excel (pemisah
              titik koma) juga bisa.
            </DialogDescription>
          </DialogHeader>
          <Input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} />
          {parsed && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p>
                <strong>{parsed.contacts.length}</strong> kontak siap diimpor
                {parsed.skipped > 0 && `, ${parsed.skipped} baris dilewati (nomor kosong/tidak valid/duplikat)`}.
              </p>
              {parsed.contacts.slice(0, 3).map((c) => (
                <p key={c.wa_id} className="text-xs text-muted-foreground">
                  +{c.wa_id} · {c.name ?? "tanpa nama"}
                </p>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button onClick={importAll} disabled={!parsed?.contacts.length || importing}>
              {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Impor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
