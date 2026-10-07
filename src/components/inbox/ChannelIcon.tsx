import { Facebook, Instagram, MessageCircle, QrCode } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ChannelProvider = 'cloud_api' | 'qr' | 'messenger' | 'instagram';

// Small mark showing which app a chat comes from.
export function ChannelIcon({ provider, className }: { provider?: ChannelProvider | null; className?: string }) {
  const base = cn('h-3.5 w-3.5 shrink-0', className);
  if (provider === 'messenger') return <Facebook className={cn(base, 'text-[#1877F2]')} aria-label="Messenger" />;
  if (provider === 'instagram') return <Instagram className={cn(base, 'text-[#E1306C]')} aria-label="Instagram" />;
  if (provider === 'qr') return <QrCode className={cn(base, 'text-[#25D366]')} aria-label="WhatsApp (QR)" />;
  return <MessageCircle className={cn(base, 'text-[#25D366]')} aria-label="WhatsApp" />;
}
