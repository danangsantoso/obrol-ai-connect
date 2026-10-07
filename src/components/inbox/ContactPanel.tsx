import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage } from '@/lib/api';
import { toast } from 'sonner';
import type { Contact } from './types';

export function ContactPanel({ contactId }: { contactId: string }) {
  const queryClient = useQueryClient();
  const { data: contact } = useQuery({
    queryKey: ['contact', contactId],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('*').eq('id', contactId).single();
      if (error) throw error;
      return data as Contact;
    },
  });

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
    queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4 xl:flex">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kontak</p>
        <p className="mt-1 text-sm">+{contact.wa_id}</p>
        {contact.profile_name && (
          <p className="text-xs text-muted-foreground">Nama di WhatsApp: {contact.profile_name}</p>
        )}
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
