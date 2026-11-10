export type CsvValue = string | number | boolean | null | undefined;

/**
 * Excel PL: UTF-8 with BOM, `;` separator, CRLF. A text cell that a spreadsheet would read as a formula
 * (`=`, `+`, `-`, `@`, TAB, CR, also after leading blanks) gets a leading apostrophe; numbers and booleans are never text.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const guarded = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): Buffer {
  const lines = [header.map(csvCell).join(";"), ...rows.map((row) => row.map(csvCell).join(";"))];
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
}
