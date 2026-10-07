import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { callFunction, errorMessage } from '@/lib/api';
import { toast } from 'sonner';
import type { Message } from './types';

function bodyText(components: unknown): string {
  if (!Array.isArray(components)) return '';
  const body = components.find((c) => (c as { type?: string }).type === 'BODY') as { text?: string } | undefined;
  return body?.text ?? '';
}

function parameterCount(text: string) {
  const numbers = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return numbers.length ? Math.max(...numbers) : 0;
}

export function TemplateSender({
  conversationId,
  orgId,
  onSent,
}: {
  conversationId: string;
  orgId: string;
  onSent: (message: Message) => void;
}) {
  const [selected, setSelected] = useState<string>('');
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ['templates', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('templates')
        .select('id, name, language, components, status')
        .eq('status', 'APPROVED')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const template = templates.find((t) => t.id === selected);
  const text = template ? bodyText(template.components) : '';
  const count = parameterCount(text);
  const preview = useMemo(
    () => text.replace(/\{\{(\d+)\}\}/g, (match, n) => params[Number(n) - 1] || match),
    [text, params],
  );

  const send = async () => {
    if (!template) return;
    setSending(true);
    try {
      const { message } = await callFunction<{ message: Message }>('send-message', {
        conversation_id: conversationId,
        type: 'template',
        template: { name: template.name, language: template.language, parameters: params.slice(0, count) },
      });
      onSent(message);
      setSelected('');
      setParams([]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">
        Lebih dari 24 jam sejak pesan terakhir pelanggan. Gunakan template yang disetujui Meta, atau tulis catatan
        internal.
      </p>
      {templates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Belum ada template. Admin dapat menyinkronkan template di menu Pengaturan.
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <Select
            value={selected}
            onValueChange={(value) => {
              setSelected(value);
              setParams([]);
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Pilih template" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {Array.from({ length: count }, (_, i) => (
            <Input
              key={i}
              className="w-40"
              placeholder={`{{${i + 1}}}`}
              value={params[i] ?? ''}
              onChange={(e) => {
                const next = params.slice();
                next[i] = e.target.value;
                setParams(next);
              }}
            />
          ))}
          <Button onClick={send} disabled={!template || sending || params.filter(Boolean).length < count}>
            {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            Kirim template
          </Button>
        </div>
      )}
      {template && <p className="rounded-md bg-muted p-2 text-sm whitespace-pre-wrap">{preview}</p>}
    </div>
  );
}
