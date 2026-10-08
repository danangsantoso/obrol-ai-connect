// Chat formatting is stored the WhatsApp way (*bold*, _italic_, ~strike~), which
// WhatsApp renders itself. Other channels get the same look in their own terms.

// A marker only counts when it hugs a word, so "5 * 3" or snake_case stay as written.
const FORMAT = /(^|[^\p{L}\p{N}])([*_~])(?=\S)([^*_~\n]*?\S)\2(?![\p{L}\p{N}])/gu;

function convert(text: string, wrap: (marker: string, inner: string) => string, plain: (s: string) => string = (s) => s) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(FORMAT)) {
    const start = (m.index ?? 0) + m[1].length;
    out += plain(text.slice(last, start)) + wrap(m[2], plain(m[3]));
    last = start + m[0].length - m[1].length;
  }
  return out + plain(text.slice(last));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const HTML_TAGS: Record<string, string> = { "*": "b", _: "i", "~": "s" };

// Telegram (parse_mode HTML).
export function toTelegramHtml(text: string): string {
  return convert(text, (marker, inner) => `<${HTML_TAGS[marker]}>${inner}</${HTML_TAGS[marker]}>`, escapeHtml);
}

// Messenger and Instagram have no formatting: bold becomes Unicode sans-serif
// bold letters (𝗕𝘂𝗱𝗶); italic and strikethrough markers are just removed.
export function toUnicodeBold(text: string): string {
  return convert(text, (marker, inner) => (marker === "*" ? boldLetters(inner) : inner));
}

function boldLetters(s: string): string {
  return Array.from(s, (ch) => {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48);
    return ch;
  }).join("");
}
