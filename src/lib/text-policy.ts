// One control-character policy for every user-entered text (company settings #30, chat #50).
// Cc (C0 and C1, including NEL and CSI), line/paragraph separators and bidirectional controls.
const hidden = "\\u202A-\\u202E\\u2066-\\u2069\\u2028\\u2029";
/** Single-line fields: no control character at all. */
export const singleLineControl = new RegExp(`[\\p{Cc}${hidden}]`, "u");
/** Multi-line fields: TAB, LF and CR are allowed. */
export const multilineControl = new RegExp(`(?![\\t\\n\\r])[\\p{Cc}${hidden}]`, "u");
