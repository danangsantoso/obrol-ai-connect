import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage, formatWaId } from '@/lib/api';
import { toast } from 'sonner';
import type { Contact } from './types';

const channelOf = (waId: string) =>
  waId.startsWith('ig:') ? 'Instagram' : waId.startsWith('fb:') ? 'Facebook' : waId.startsWith('tg:') ? 'Telegram' : waId.startsWith('web:') ? 'live chat' : 'WhatsApp';

export function ContactPanel({ contactId: chatContactId }: { contactId: string }) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const canMerge = profile?.role !== 'agent';
  // A number merged into another contact shows (and edits) that main contact.
  const { data } = useQuery({
    queryKey: ['contact', chatContactId],
    queryFn: async () => {
      const { data: own, error } = await supabase.from('contacts').select('*').eq('id', chatContactId).single();
      if (error) throw error;
      const mainId = own.merged_into ?? own.id;
      const [{ data: main }, { data: linked }] = await Promise.all([
        own.merged_into ? supabase.from('contacts').select('*').eq('id', mainId).single() : Promise.resolve({ data: own }),
        supabase.from('contacts').select('id, wa_id, username').eq('merged_into', mainId),
      ]);
      return { contact: (main ?? own) as Contact, linked: linked ?? [] };
    },
  });
  const contact = data?.contact;
  const contactId = contact?.id ?? chatContactId;

  const [form, setForm] = useState({ name: '', email: '', company: '', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (contact) {
      setForm({
        name: contact.name ?? '',
        email: contact.email ?? '',
        company: contact.company ?? '',
        notes: contact.notes ?? '',
      });
    }
  }, [contact]);

  if (!contact) return null;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('contacts')
      .update({
        name: form.name.trim() || null,
        email: form.email.trim() || null,
        company: form.company.trim() || null,
        notes: form.notes.trim() || null,
      })
      .eq('id', contactId);
    setSaving(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success('Kontak disimpan');
    queryClient.invalidateQueries({ queryKey: ['contact', chatContactId] });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const setPromo = async (receive: boolean) => {
    const ids = [contactId, ...(data?.linked ?? []).map((l) => l.id)];
    const { error } = await supabase.from('contacts').update({ broadcast_opt_out: !receive }).in('id', ids);
    if (error) return toast.error(errorMessage(error));
    queryClient.invalidateQueries({ queryKey: ['contact', chatContactId] });
  };

  const unmerge = async (id: string) => {
    if (!window.confirm('Pisahkan nomor ini menjadi kontak sendiri lagi?')) return;
    const { error } = await supabase.rpc('unmerge_contact', { p_contact: id });
    if (error) return toast.error(errorMessage(error));
    toast.success('Kontak dipisahkan');
    queryClient.invalidateQueries({ queryKey: ['contact', chatContactId] });
  };

  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4 xl:flex">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kontak</p>
        <p className="mt-1 text-sm">{formatWaId(contact.wa_id, contact.username)}</p>
        {contact.profile_name && (
          <p className="text-xs text-muted-foreground">
            Nama di {channelOf(contact.wa_id)}: {contact.profile_name}
          </p>
        )}
        {(data?.linked.length ?? 0) > 0 && (
          <ul className="mt-2 space-y-1" aria-label="Nomor lain pelanggan ini">
            {data!.linked.map((l) => (
              <li key={l.id} className="flex items-center gap-1.5 text-xs">
                <Link2 className="h-3 w-3 text-muted-foreground" />
                <span className="flex-1">
                  {channelOf(l.wa_id)} {formatWaId(l.wa_id, l.username)}
                </span>
                {canMerge && (
                  <button className="text-primary" onClick={() => unmerge(l.id)}>
                    Pisahkan
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-start justify-between gap-3 rounded-md border p-3">
        <div>
          <Label htmlFor="contact-promo">Terima broadcast promo</Label>
          <p className="text-xs text-muted-foreground">
            {contact.broadcast_opt_out ? 'Pelanggan membalas STOP / berhenti promo.' : 'Pelanggan bisa membalas STOP untuk berhenti, MULAI untuk berlangganan lagi.'}
          </p>
        </div>
        <Switch id="contact-promo" checked={!contact.broadcast_opt_out} onCheckedChange={setPromo} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-name">Nama</Label>
        <Input
          id="contact-name"
          value={form.name}
          placeholder={contact.profile_name ?? undefined}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-email">Email</Label>
        <Input
          id="contact-email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-company">Perusahaan / divisi</Label>
        <Input
          id="contact-company"
          value={form.company}
          onChange={(e) => setForm({ ...form, company: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-notes">Catatan kontak</Label>
        <Textarea
          id="contact-notes"
          rows={4}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>
      <Button onClick={save} disabled={saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Simpan kontak
      </Button>
    </aside>
  );
}
