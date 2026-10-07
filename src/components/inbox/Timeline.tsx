import { useEffect, useRef } from 'react';
import { format, isSameDay } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { AlertCircle, Check, CheckCheck, FileText, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSignedUrl } from './useInboxData';
import type { AssignmentLog, Member, Message, TimelineItem } from './types';
import { memberName } from './types';
import { ChatText } from "@/components/chat/ChatText";

function StatusIcon({ message }: { message: Message }) {
  if (message.status === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-red-200" />;
  if (message.status === 'read') return <CheckCheck className="h-3.5 w-3.5 text-sky-200" />;
  if (message.status === 'delivered') return <CheckCheck className="h-3.5 w-3.5 opacity-80" />;
  return <Check className="h-3.5 w-3.5 opacity-80" />;
}

function MediaContent({ message }: { message: Message }) {
  const url = useSignedUrl(message.media_path);
  if (!message.media_path) {
    return <p className="text-xs italic opacity-80">[{message.type}] media belum tersedia</p>;
  }
  if (!url) return <div className="h-32 w-48 animate-pulse rounded-md bg-black/10" />;
  if (message.type === 'image' || message.type === 'sticker') {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={message.body ?? 'Gambar'} className="max-h-72 max-w-full rounded-md" />
      </a>
    );
  }
  if (message.type === 'video') return <video src={url} controls className="max-h-72 max-w-full rounded-md" />;
  if (message.type === 'audio') return <audio src={url} controls className="max-w-full" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline underline-offset-2">
      <FileText className="h-4 w-4" />
      {message.media_filename ?? 'Unduh file'}
    </a>
  );
}

// Outbound messages come from an agent, the AI agent, or the linked phone (QR numbers).
function senderLabel(message: Message, sender?: Member) {
  const meta = (message.metadata ?? {}) as { ai?: boolean; bot_name?: string; sent_from_phone?: boolean };
  if (meta.ai) return `🤖 ${meta.bot_name || 'AI'}`;
  if (meta.sent_from_phone) return 'Dari HP';
  return memberName(sender);
}

function MessageBubble({ message, sender }: { message: Message; sender?: Member }) {
  const outbound = message.direction === 'outbound';
  const hasMedia = ['image', 'video', 'audio', 'document', 'sticker'].includes(message.type);
  const error = message.error as { title?: string; message?: string } | null;

  return (
    <div className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] space-y-1 rounded-2xl px-3 py-2 text-sm shadow-sm',
          outbound ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-card',
        )}
      >
        {outbound && (
          <p className="text-[11px] font-semibold opacity-80">
            {message.type === 'template' ? 'Template · ' : ''}
            {senderLabel(message, sender)}
          </p>
        )}
        {hasMedia && <MediaContent message={message} />}
        {message.body && <p className="whitespace-pre-wrap break-words"><ChatText text={message.body} /></p>}
        {!message.body && !hasMedia && <p className="italic opacity-70">[{message.type}]</p>}
        <div className={cn('flex items-center justify-end gap-1 text-[10px]', outbound ? 'opacity-80' : 'text-muted-foreground')}>
          {format(new Date(message.created_at), 'HH:mm')}
          {outbound && <StatusIcon message={message} />}
        </div>
        {message.status === 'failed' && (
          <p className="text-[11px] text-red-100">Gagal terkirim{error?.title ? `: ${error.title}` : ''}</p>
        )}
      </div>
    </div>
  );
}

export function Timeline({
  items,
  members,
  loading,
}: {
  items: TimelineItem[];
  members: Map<string, Member>;
  loading: boolean;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [items.length]);

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Memuat pesan...</p>;

  return (
    <div className="space-y-2 p-4">
      {items.map((item, index) => {
        const previous = items[index - 1];
        const showDay = !previous || !isSameDay(new Date(previous.at), new Date(item.at));
        return (
          <div key={`${item.kind}-${item.kind === 'message' ? item.message.id : item.kind === 'note' ? item.note.id : item.log.id}`}>
            {showDay && (
              <div className="my-3 text-center">
                <span className="rounded-full bg-card px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
                  {format(new Date(item.at), 'EEEE, d MMMM yyyy', { locale: localeId })}
                </span>
              </div>
            )}
            {item.kind === 'message' && (
              <MessageBubble
                message={item.message}
                sender={item.message.sender_id ? members.get(item.message.sender_id) : undefined}
              />
            )}
            {item.kind === 'note' && (
              <div className="mx-auto max-w-[85%] rounded-lg border border-primary/20 bg-primary-light px-3 py-2 text-sm">
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-primary-dark">
                  <StickyNote className="h-3 w-3" />
                  Catatan internal · {item.note.author_id ? memberName(members.get(item.note.author_id)) : '🤖 AI'} ·{' '}
                  {format(new Date(item.note.created_at), 'HH:mm')}
                </p>
                <p className="whitespace-pre-wrap break-words">{item.note.body}</p>
              </div>
            )}
            {item.kind === 'log' && (
              <p className="py-1 text-center text-[11px] text-muted-foreground">
                {describeLog(item.log, members)} · {format(new Date(item.log.created_at), 'HH:mm')}
                {item.log.note && item.log.note !== 'claimed' ? ` — "${item.log.note}"` : ''}
              </p>
            )}
          </div>
        );
      })}
      <div ref={bottom} />
    </div>
  );
}

function describeLog(log: AssignmentLog, members: Map<string, Member>) {
  const actor = memberName(log.actor_id ? members.get(log.actor_id) : undefined);
  if (log.note === 'claimed') return `${actor} mengambil percakapan ini`;
  if (!log.to_assignee_id) return `${actor} mengembalikan percakapan ke antrean`;
  const target = memberName(members.get(log.to_assignee_id));
  if (!log.actor_id) return `Sistem memberikan ke ${target}`;
  return log.actor_id === log.to_assignee_id ? `${actor} mengambil percakapan ini` : `${actor} memindahkan ke ${target}`;
}
