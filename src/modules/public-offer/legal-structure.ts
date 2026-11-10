/**
 * D-36 (#232): the only structure of a company's plain-text document. A line that starts with "## " is a section
 * heading; every other block of text is a paragraph. Nothing is interpreted as HTML or any other markdown, so the
 * result can be rendered as escaped React text. A document without headings has no table of contents.
 */
export type LegalSection = { id: string; number: number; title: string; paragraphs: string[] };
export type LegalStructure = { intro: string[]; sections: LegalSection[] };

const MAX_HEADING = 200;

function paragraphsOf(lines: string[]): string[] {
  const result: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length) result.push(current.join("\n"));
      current = [];
    } else current.push(line);
  }
  if (current.length) result.push(current.join("\n"));
  return result;
}

export function parseLegalText(text: string): LegalStructure {
  const intro: string[] = [];
  const sections: LegalSection[] = [];
  let buffer: string[] = [];
  let open: LegalSection | null = null;
  const flush = () => {
    (open ? open.paragraphs : intro).push(...paragraphsOf(buffer));
    buffer = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^## +(\S.*)$/.exec(line);
    const title = heading ? heading[1].trim().slice(0, MAX_HEADING) : null;
    if (title) {
      flush();
      const number = sections.length + 1;
      open = { id: `sekcja-${number}`, number, title, paragraphs: [] };
      sections.push(open);
    } else buffer.push(line);
  }
  flush();
  return { intro, sections };
}
