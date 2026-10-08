import { useMemo, useRef, useState } from 'react';
import { Loader2, Paperclip, Send, Sparkles, StickyNote, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import { supabase } from '@/integrations/supabase/client';
import { callFunction, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useQuickReplies } from './useInboxData';
import type { Member, Message } from './types';
import { memberName } from './types';

type Mode = 'reply' | 'note';

type Suggestion =
  | { kind: 'quick'; key: string; title: string; detail: string; insert: string }
  | { kind: 'mention'; key: string; title: string; detail: string; insert: string; memberId: string };

function mediaTypeFor(mime: string) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

// The "/shortcut" or "@name" being typed right before the caret, if any.
function activeToken(text: string, caret: number) {
  const match = /(^|\s)([/@])([\w.-]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { trigger: match[2], query: match[3].toLowerCase(), start: caret - match[3].length - 1 };
}

interface Props {
  conversationId: string;
  orgId: string;
  userId: string;
  contactName: string;
  members: Member[];
  windowOpen: boolean;
  // Shows the "Saran AI" button (AI configured for the organization).
  aiSuggest?: boolean;
  onSent: (message: Message) => void;
}

export function Composer({ conversationId, orgId, userId, contactName, members, windowOpen, aiSuggest, onSent }: Props) {
  const [mode, setMode] = useState<Mode>(windowOpen ? 'reply' : 'note');
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [mentioned, setMentioned] = useState<Map<string, string>>(new Map());
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { data: quickReplies = [] } = useQuickReplies(orgId);

  const replyDisabled = mode === 'reply' && !windowOpen;
  const token = activeToken(text, caret);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!token || dismissed) return [];
    if (token.trigger === '/') {
      return quickReplies
        .filter((q) => q.shortcut.includes(token.query))
        .slice(0, 8)
        .map((q) => ({
          kind: 'quick',
          key: q.id,
          title: `/${q.shortcut}`,
          detail: q.body,
          insert: q.body.replace(/\{nama\}/gi, contactName),
        }));
    }
    if (mode !== 'note') return [];
    return members
      .filter((m) => m.is_active && m.id !== userId && memberName(m).toLowerCase().includes(token.query))
      .slice(0, 8)
      .map((m) => ({
        kind: 'mention',
        key: m.id,
        title: memberName(m),
        detail: m.email,
        insert: `@${memberName(m)} `,
        memberId: m.id,
      }));
  }, [token, dismissed, quickReplies, contactName, mode, members, userId]);

  const updateText = (value: string, position: number) => {
    setText(value);
    setCaret(position);
    setHighlight(0);
    setDismissed(false);
  };

  // Puts the emoji where the caret is (or replaces the selection) and keeps typing there.
  const insertEmoji = (emoji: string) => {
    const el = textarea.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const next = text.slice(0, start) + emoji + text.slice(end);
    const pos = start + emoji.length;
    updateText(next, pos);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const choose = (s: Suggestion) => {
    if (!token) return;
    const next = text.slice(0, token.start) + s.insert + text.slice(caret);
    const position = token.start + s.insert.length;
    updateText(next, position);
    if (s.kind === 'mention') setMentioned((prev) => new Map(prev).set(s.memberId, s.title));
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
    });
  };

  // Fills the box with an AI draft; the agent edits and sends it.
  const draft = async () => {
    setDrafting(true);
    try {
      const result = await callFunction<{ reply: string; handoff: boolean; reason: string }>('ai-reply', {
        action: 'suggest',
        conversation_id: conversationId,
      });
      if (result.reply) {
        setText(result.reply);
        setCaret(result.reply.length);
        textarea.current?.focus();
      }
      if (result.handoff) toast.info(`AI menyarankan ditangani agen: ${result.reason || 'informasi tidak tersedia'}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDrafting(false);
    }
  };

  const submit = async () => {
    const typed = text;
    const body = typed.trim();
    if (sending || (!body && !file) || replyDisabled) return;
    setSending(true);
    try {
      if (mode === 'note') {
        const mentions = [...mentioned].filter(([, name]) => body.includes(`@${name}`)).map(([id]) => id);
        const { error } = await supabase.from('notes').insert({
          conversation_id: conversationId,
          organization_id: orgId,
          author_id: userId,
          body,
          mentions,
        });
        if (error) throw error;
        setMentioned(new Map());
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
      // Clear what was sent but keep anything typed while the request was in flight.
      setText((current) => (current.startsWith(typed) ? current.slice(typed.length).trimStart() : current));
      setFile(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setHighlight((h) => (h + step + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(suggestions[Math.min(highlight, suggestions.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={cn('border-t border-border p-3', mode === 'note' ? 'bg-primary-light' : 'bg-card')}>
      <div className="mb-2 flex items-center gap-1">
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
        {aiSuggest && mode === 'reply' && (
          <Button size="sm" variant="ghost" onClick={draft} disabled={drafting || !windowOpen} title="Buat draf balasan dengan AI">
            {drafting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            Saran AI
          </Button>
        )}
        <span className="ml-auto hidden text-[11px] text-muted-foreground md:inline">
          Ketik <kbd className="rounded border px-1">/</kbd> untuk balasan cepat
          {mode === 'note' && (
            <>
              , <kbd className="rounded border px-1">@</kbd> untuk menyebut rekan
            </>
          )}
        </span>
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

      <div className="relative flex items-end gap-2">
        {suggestions.length > 0 && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 right-12 z-20 mb-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          >
            {suggestions.map((s, i) => (
              <button
                key={s.key}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  'block w-full rounded-md px-3 py-2 text-left',
                  i === highlight ? 'bg-primary-light text-primary-dark' : 'hover:bg-muted',
                )}
              >
                <p className="text-sm font-medium">{s.title}</p>
                <p className="truncate text-xs text-muted-foreground">{s.detail}</p>
              </button>
            ))}
          </div>
        )}
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
        <EmojiPicker onPick={insertEmoji} disabled={replyDisabled} />
        <Textarea
          ref={textarea}
          value={text}
          onChange={(e) => updateText(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
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
