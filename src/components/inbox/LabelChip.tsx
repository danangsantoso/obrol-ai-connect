import { cn } from '@/lib/utils';
import type { Label } from './types';

// Label colors are stored as #RRGGBB; the chip uses a 12% tint of it.
export function LabelChip({ label, className }: { label: Pick<Label, 'name' | 'color'>; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', className)}
      style={{ backgroundColor: `${label.color}1F`, color: label.color }}
    >
      {label.name}
    </span>
  );
}
