import { ChatError } from "./errors";

/** D-04: 4 000 Unicode code points of NFC text. The same function is meant for UI and server. */
export const MAX_CHAT_CHARACTERS = 4000;
// Raw input far above any NFC-reducible size is refused before normalisation work.
const MAX_RAW_UNITS = 40_000;
// C0/C1 controls except TAB and LF (CR is folded into LF first). NUL is among them.
const forbiddenControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function countCodePoints(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) index += 1;
    count += 1;
  }
  return count;
}

/**
 * Returns the exact text that is stored: raw characters, never HTML-escaped or interpreted (rendering escapes
 * on output). Refuses empty text, control characters, lone surrogates and more than 4 000 code points.
 */
export function normalizeChatBody(raw: unknown): string {
  if (typeof raw !== "string") throw new ChatError("CHAT_INVALID_INPUT");
  if (raw.length > MAX_RAW_UNITS) throw new ChatError("MESSAGE_TOO_LONG");
  if (loneSurrogate.test(raw)) throw new ChatError("CHAT_INVALID_MESSAGE");
  const text = raw.replace(/\r\n?/g, "\n").normalize("NFC");
  if (forbiddenControls.test(text) || text.trim() === "") throw new ChatError("CHAT_INVALID_MESSAGE");
  if (countCodePoints(text) > MAX_CHAT_CHARACTERS) throw new ChatError("MESSAGE_TOO_LONG");
  return text;
}
