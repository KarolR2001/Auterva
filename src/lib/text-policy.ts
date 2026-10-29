// One control-character policy for every user-entered text (company settings #30, chat #50).
// Cc (C0 and C1, including NEL and CSI), line/paragraph separators and bidirectional controls.
const hidden = "\\u202A-\\u202E\\u2066-\\u2069\\u2028\\u2029";
/** Single-line fields: no control character at all. */
export const singleLineControl = new RegExp(`[\\p{Cc}${hidden}]`, "u");
/** Multi-line fields: TAB, LF and CR are allowed. */
export const multilineControl = new RegExp(`(?![\\t\\n\\r])[\\p{Cc}${hidden}]`, "u");

/** True when the text carries a character the policy refuses (#176: NUL would otherwise reach PostgreSQL as a 500). */
export function hasControlCharacter(value: string, multiline = false): boolean {
  return (multiline ? multilineControl : singleLineControl).test(value);
}

export const INVALID_CHARACTERS = "INVALID_CHARACTERS";

/** A refused control character, with the field path(s) the route reports as `fieldErrors` (#176). */
export class InvalidCharactersError extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string>) { super(INVALID_CHARACTERS); this.fieldErrors = fieldErrors; }
}

/** Throws InvalidCharactersError for the Zod issues raised by a text refinement; other issues are left to the caller. */
export function throwIfInvalidCharacters(issues: ReadonlyArray<{ message: string; path: PropertyKey[] }>): void {
  const found = issues.filter((issue) => issue.message === INVALID_CHARACTERS);
  if (found.length) throw new InvalidCharactersError(Object.fromEntries(found.map((issue) => [issue.path.map(String).join("."), INVALID_CHARACTERS])));
}
