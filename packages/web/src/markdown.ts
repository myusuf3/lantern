/** A piece of a paragraph: plain text, a clickable glossary term, or inline code. */
export type Token = { text: string } | { term: string; text: string } | { code: string };
export type Paragraph = Token[];

const INLINE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|`([^`]+)`/g;

export function slugOf(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

/** Minimal markdown: paragraphs split on blank lines, `[[term]]`, `[[term|shown text]]`, and `code`. */
export function parseProse(markdown: string): Paragraph[] {
  return markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map(parseParagraph);
}

function parseParagraph(text: string): Paragraph {
  const tokens: Paragraph = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index) });
    const [, term, shown, code] = m;
    if (code !== undefined) tokens.push({ code });
    else if (term !== undefined) tokens.push({ term: slugOf(term), text: shown ?? term });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens;
}
