import { Fragment, type ReactNode } from "react";

// WhatsApp-style formatting: *bold*, _italic_, ~strikethrough~. A marker only
// counts when it hugs a word, so "5 * 3" or snake_case stay as written.
// Same rule as supabase/functions/_shared/format.ts.
const FORMAT = /(^|[^\p{L}\p{N}])([*_~])(?=\S)([^*_~\n]*?\S)\2(?![\p{L}\p{N}])/gu;
const TAGS = { "*": "strong", _: "em", "~": "s" } as const;

function formatChatText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(FORMAT)) {
    const start = (m.index ?? 0) + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    const Tag = TAGS[m[2] as keyof typeof TAGS];
    out.push(<Tag key={start}>{m[3]}</Tag>);
    last = start + m[0].length - m[1].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ChatText({ text }: { text: string }) {
  return <Fragment>{formatChatText(text)}</Fragment>;
}
