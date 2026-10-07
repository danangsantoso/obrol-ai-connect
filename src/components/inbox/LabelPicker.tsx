import { Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { LabelChip } from './LabelChip';
import type { Label } from './types';

interface Props {
  conversationId: string;
  labels: Label[];
  selectedIds: string[];
  onChanged: () => void;
}

export function LabelPicker({ conversationId, labels, selectedIds, onChanged }: Props) {
  const toggle = async (labelId: string, on: boolean) => {
    const { error } = on
      ? await supabase.from('conversation_labels').insert({ conversation_id: conversationId, label_id: labelId })
      : await supabase
          .from('conversation_labels')
          .delete()
          .eq('conversation_id', conversationId)
          .eq('label_id', labelId);
    if (error) toast.error(errorMessage(error));
    onChanged();
  };

  const selected = labels.filter((l) => selectedIds.includes(l.id));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {selected.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground">
            <Tag className="mr-1 h-3.5 w-3.5" />
            Label
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          {labels.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              Belum ada label. Admin/supervisor dapat membuatnya di Pengaturan.
            </p>
          ) : (
            labels.map((l) => (
              <label
                key={l.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  checked={selectedIds.includes(l.id)}
                  onCheckedChange={(v) => toggle(l.id, v === true)}
                />
                <LabelChip label={l} />
              </label>
            ))
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
