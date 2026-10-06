import { useRef, useState } from 'react';
import { Loader2, Paperclip, Send, StickyNote, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { callFunction, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Message } from './types';

type Mode = 'reply' | 'note';

function mediaTypeFor(mime: string) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

interface Props {
  conversationId: string;
  orgId: string;
  userId: string;
  windowOpen: boolean;
  onSent: (message: Message) => void;
}

export function Composer({ conversationId, orgId, userId, windowOpen, onSent }: Props) {
  const [mode, setMode] = useState<Mode>(windowOpen ? 'reply' : 'note');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const replyDisabled = mode === 'reply' && !windowOpen;

  const submit = async () => {
    const typed = text;
    const body = typed.trim();
    if (sending || (!body && !file) || replyDisabled) return;
    setSending(true);
    try {
      if (mode === 'note') {
        const { error } = await supabase.from('notes').insert({
          conversation_id: conversationId,
          organization_id: orgId,
          author_id: userId,
          body,
        });
        if (error) throw error;
      } else if (file) {
        const safeName = file.name.replace(/[^\w.-]+/g, '_');
        const path = `${orgId}/outbound/${crypto.randomUUID()}-${safeName}`;
        const upload = await supabase.storage.from('media').upload(path, file, { contentType: file.type });
        if (upload.error) throw upload.error;
        const { message } = await callFunction<{ message: Message }>('send-message', {
          conversation_id: conversationId,
          type: mediaTypeFor(file.type),
          media_path: path,
          filename: file.name,
          text: body || undefined,
        });
        onSent(message);
      } else {
        const { message } = await callFunction<{ message: Message }>('send-message', {
          conversation_id: conversationId,
          type: 'text',
          text: body,
        });
        onSent(message);
      }
      // Keep anything typed while the request was in flight.
      setText((current) => (current === typed ? '' : current));
      setFile(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn('border-t border-border p-3', mode === 'note' ? 'bg-primary-light' : 'bg-card')}>
      <div className="mb-2 flex gap-1">
        <Button
          size="sm"
          variant={mode === 'reply' ? 'default' : 'ghost'}
          onClick={() => setMode('reply')}
          disabled={!windowOpen}
        >
          Balas
        </Button>
        <Button size="sm" variant={mode === 'note' ? 'default' : 'ghost'} onClick={() => setMode('note')}>
          <StickyNote className="mr-1 h-3.5 w-3.5" />
          Catatan internal
        </Button>
      </div>

      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs">
          <Paperclip className="h-3.5 w-3.5" />
          <span className="flex-1 truncate">{file.name}</span>
          <button onClick={() => setFile(null)} aria-label="Hapus lampiran">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {mode === 'reply' && (
          <>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInput.current?.click()}
              disabled={replyDisabled}
              aria-label="Lampirkan file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </>
        )}
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            mode === 'note'
              ? 'Tulis catatan untuk tim (tidak terkirim ke pelanggan)'
              : 'Ketik balasan... (Enter kirim, Shift+Enter baris baru)'
          }
          rows={2}
          className="min-h-[44px] resize-none bg-card"
          disabled={replyDisabled}
        />
        <Button onClick={submit} disabled={sending || replyDisabled || (!text.trim() && !file)} aria-label="Kirim">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
