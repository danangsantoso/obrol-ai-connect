import { useState } from 'react';
import { Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const GROUPS: { label: string; emoji: string }[] = [
  { label: 'Wajah', emoji: '😊 😀 😁 😂 🤣 😍 🥰 😘 😉 😎 🤩 🥳 🙂 😅 😇 🤗 🤔 😌 😋 😢 😭 😮 😴 😡 😔 🙄' },
  { label: 'Tangan', emoji: '🙏 👍 👎 👌 👏 🙌 💪 🤝 👋 ✌️ 🤞 👉 👆 ☝️ ✍️' },
  { label: 'Hati', emoji: '❤️ 🧡 💛 💚 💙 💜 🤍 💖 💕 💯 ✨ 🔥 ⭐ 🌟' },
  { label: 'Jualan', emoji: '🎉 🎁 🛒 🛍️ 📦 🚚 💰 💳 🏷️ 🧾 ✅ ❌ ⏰ 📞 📍 📷 🎯 🆕 🔖 💡' },
];

interface Props {
  onPick: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
}

// A small emoji panel; keeps the text box focused so the emoji lands at the caret.
export function EmojiPicker({ onPick, disabled, className }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" disabled={disabled} aria-label="Emoji" title="Emoji" className={className}>
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-72 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-64 space-y-2 overflow-y-auto" role="listbox" aria-label="Pilih emoji">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <p className="px-1 text-[11px] font-medium text-muted-foreground">{g.label}</p>
              <div className="grid grid-cols-8">
                {g.emoji.split(' ').map((e) => (
                  <button
                    key={e}
                    type="button"
                    role="option"
                    aria-selected={false}
                    aria-label={e}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => onPick(e)}
                    className={cn('rounded-md p-1 text-xl leading-none hover:bg-muted')}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
