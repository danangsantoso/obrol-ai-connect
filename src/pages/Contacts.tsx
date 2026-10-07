import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { displayName } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ImportContactsDialog } from "@/components/contacts/ImportContactsDialog";

export default function Contacts() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const term = search.trim();

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["contacts", term],
    queryFn: async () => {
      let query = supabase
        .from("contacts")
        .select("id, wa_id, name, profile_name, email, company, created_at, conversations(id)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (term) {
        const like = `%${term.replace(/[%_,()]/g, "")}%`;
        query = query.or(
          `name.ilike.${like},profile_name.ilike.${like},wa_id.ilike.${like},email.ilike.${like},company.ilike.${like}`,
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Kontak</h1>
          <p className="text-muted-foreground">Pelanggan yang pernah menghubungi nomor WhatsApp Anda.</p>
        </div>
        <div className="flex w-full max-w-lg gap-2">
          <ImportContactsDialog
            orgId={profile!.organization_id!}
            onDone={() => queryClient.invalidateQueries({ queryKey: ["contacts"] })}
          />
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, nomor, email, perusahaan"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Nomor WhatsApp</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Perusahaan</TableHead>
                <TableHead>Pertama kali chat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Memuat kontak...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && contacts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Belum ada kontak.
                  </TableCell>
                </TableRow>
              )}
              {contacts.map((c) => {
                const conversationId = c.conversations?.[0]?.id;
                return (
                  <TableRow
                    key={c.id}
                    className={conversationId ? "cursor-pointer" : undefined}
                    onClick={() => conversationId && navigate(`/inbox/${conversationId}`)}
                  >
                    <TableCell className="font-medium">{displayName(c)}</TableCell>
                    <TableCell>+{c.wa_id}</TableCell>
                    <TableCell>{c.email ?? "–"}</TableCell>
                    <TableCell>{c.company ?? "–"}</TableCell>
                    <TableCell>{format(new Date(c.created_at), "d MMM yyyy", { locale: localeId })}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
