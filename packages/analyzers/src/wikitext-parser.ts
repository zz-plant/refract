export function sanitizeWikitext(value: string): string {
  const withoutRefs = value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<ref[^>/]*?>[\s\S]*?<\/ref>/gi, " ")
    .replace(/<ref[^>]*/gi, (match) => (match.endsWith("/>") ? " " : match))
    .replace(/<ref[^>]*\/>/gi, " ");
  return removeTemplates(withoutRefs, " ")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, "$1")
    .replace(/'''/g, "")
    .replace(/''/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove every balanced `{{…}}`, nested ones included, putting `replacement`
 * where each outermost one stood.
 *
 * One pass of /\{\{[^{}]*?\}\}/ removed only templates with none inside them,
 * so a template that held another kept its own braces and parameters: an
 * infobox with a {{start date}} in it came through whole as prose, and its
 * "| result = …" lines became sentences. Repeating the regex until nothing
 * changes would take one pass per level of nesting. This is one scan: each
 * "{{" marks where the output stood, and its matching "}}" cuts the output
 * back to that mark. An opener that never closes, and a closer with no opener,
 * stay as text, with any balanced templates inside them still removed.
 */
export function removeTemplates(text: string, replacement: string): string {
  if (!text.includes("{{")) return text;
  // Chunks of output; a mark is how many chunks stood before its "{{", so
  // cutting back is setting the array's length, and each chunk is written once.
  const parts: string[] = [];
  const marks: number[] = [];
  let from = 0;
  let i = 0;
  while (i < text.length - 1) {
    const opens = text[i] === "{" && text[i + 1] === "{";
    const closes = !opens && marks.length > 0 && text[i] === "}" && text[i + 1] === "}";
    if (!opens && !closes) {
      i++;
      continue;
    }
    if (i > from) parts.push(text.slice(from, i));
    if (opens) {
      marks.push(parts.length);
      parts.push("{{");
    } else {
      parts.length = marks.pop() as number;
      if (replacement) parts.push(replacement);
    }
    i += 2;
    from = i;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts.join("");
}

/**
 * The names a wiki gives its category namespace: the canonical English one,
 * which every wiki accepts, then the local names of the editions Refract is
 * tested against. Matched without regard to case. To cover another edition,
 * add the name its wiki uses.
 */
const CATEGORY_NAMESPACE_NAMES: readonly string[] = [
  "Category",
  "Kategorie", // German
  "Catégorie", // French
  "カテゴリ", // Japanese
];

const CATEGORY_TAG = new RegExp(`\\[\\[\\s*(?:${CATEGORY_NAMESPACE_NAMES.join("|")})\\s*:[^\\]]*\\]\\]`, "giu");

export interface SectionOffset {
  charOffset: number;
  section: string;
}

export interface StrippedWikitext {
  /** The page's prose: markup removed, and a paragraph break where each heading stood. */
  text: string;
  /**
   * Where each section's prose starts, as an offset into `text` once it is
   * lowercased and its whitespace runs are single spaces, which is the form
   * findSectionForText searches. Starts with "(lead)" at 0.
   */
  sections: SectionOffset[];
}

// Same pattern as sectionDiffer.extractSections, so a sentence's section is
// named as its section event names it. The title is matched whole and trimmed
// after: as \s*([^=]+?)\s*, the spaces on a line of "=" and spaces could be
// split between three quantifiers, which took time cubic in the line's length.
const HEADING_LINE = /^(=+)([^=]+)\1$/;

// Stands in for a heading line while the markup around it is removed. NUL
// cannot occur in a page's text, and any in the input is dropped first.
const HEADING_MARK = "\u0000";
const HEADING_MARKS = new RegExp(`${HEADING_MARK}(\\d+)${HEADING_MARK}`);

/**
 * Strip a page to prose and record where each section's prose starts in it.
 *
 * A heading is a boundary, not prose. Left in the text, "==Planetary status=="
 * opened the sentence after it; removed without a trace, the last line of one
 * section would run into the first of the next. Each heading therefore becomes
 * a paragraph break, and the offsets are taken in the stripped text: measured
 * in the wikitext, as they once were, they ran ahead of it by the markup
 * removed so far and put sentences under a later heading.
 *
 * A heading inside a comment or a template goes with it and opens no section.
 */
export function stripWikitextWithSections(wikitext: string): StrippedWikitext {
  const titles: string[] = [];
  const marked = wikitext
    .replaceAll(HEADING_MARK, "")
    .split("\n")
    .map((line) => {
      const match = HEADING_LINE.exec(line);
      if (!match) return line;
      titles.push(match[2].trim());
      return `${HEADING_MARK}${titles.length - 1}${HEADING_MARK}`;
    })
    .join("\n");

  // split() with one capture group alternates prose and heading index.
  const parts = stripMarkup(marked).split(HEADING_MARKS);
  const sections: SectionOffset[] = [{ charOffset: 0, section: "(lead)" }];
  const blocks: string[] = [];
  let offset = 0;
  for (let i = 0; i < parts.length; i += 2) {
    if (i > 0) sections.push({ charOffset: offset, section: titles[Number(parts[i - 1])] });
    const block = parts[i].replace(/\n{3,}/g, "\n\n").trim();
    if (!block) continue;
    blocks.push(block);
    offset += normalizeForSearch(block).length + 1;
  }
  return { text: blocks.join("\n\n"), sections };
}

/** A page's prose: markup and headings removed, with a paragraph break where each heading stood. */
export function stripWikitext(wikitext: string): string {
  return stripWikitextWithSections(wikitext).text;
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

function stripMarkup(wikitext: string): string {
  let text = wikitext;
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<ref\b[^>]*\/\s*>/gi, "");
  text = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  text = removeTemplates(text, "");
  text = text.replace(/'''(.+?)'''/g, "$1");
  text = text.replace(/''(.+?)''/g, "$1");
  // A category tag is page metadata, not prose. Left in, its name joined the next
  // sentence. A visible link to a category, [[:Category:X]], has its own syntax.
  text = text.replace(CATEGORY_TAG, "");
  // An interlanguage link points at another edition of the wiki; its label is a
  // language code, not prose. Left in, "de:Pluto (Zwergplanet)" landed in sentence
  // events. A visible interlanguage link, [[:de:Pluto]], keeps its leading colon and
  // stays; namespaces such as [[Wikipedia:Notability]] are capitalised, not codes.
  text = text.replace(/\[\[[a-z][a-z0-9_-]*:[^\]]*\]\]/g, "");
  text = text.replace(/\[\[([^\]|]+?)\]\]/g, "$1");
  text = text.replace(/\[\[[^\]]+?\|([^\]]+?)\]\]/g, "$1");
  return text;
}

export interface HeadingPosition {
  position: number;
  heading: string;
}

export function extractHeadingMap(wikitext: string): HeadingPosition[] {
  // A heading is one line that opens with "==" and, after trailing whitespace,
  // closes with "=="; its title is what lies between the runs of "=", trimmed.
  // The runs are stripped by hand rather than by /^==+\s*(.*?)\s*==+\s*$/gm,
  // whose three whitespace-matching quantifiers took time cubic in the length of
  // a line of "==" and spaces, and whose \s could join a heading across lines.
  const headings: HeadingPosition[] = [];
  for (const match of wikitext.matchAll(/^==.*$/gm)) {
    const line = match[0].trimEnd();
    if (line.length < 4 || !line.endsWith("==")) continue;
    let start = 0;
    while (line[start] === "=") start++;
    let end = line.length;
    while (end > start && line[end - 1] === "=") end--;
    headings.push({ position: match.index ?? 0, heading: line.slice(start, end).trim() });
  }
  return headings;
}

export function deriveSectionHeading(wikitext: string, position: number): string | null {
  let selected: string | null = null;
  for (const heading of extractHeadingMap(wikitext)) {
    if (heading.position > position) break;
    selected = heading.heading;
  }
  return selected;
}

export function countCitations(wikitext: string): number {
  return Array.from(wikitext.matchAll(/<ref\b/gi)).length;
}

export function countKeywordMentions(
  wikitext: string,
  phrases: string[],
): { totalMentions: number; matchedPhrases: number } {
  const lowered = wikitext.toLowerCase();
  let totalMentions = 0;
  let matchedPhrases = 0;
  for (const phrase of phrases) {
    const normalized = phrase.trim().toLowerCase();
    if (!normalized) continue;
    let count = 0;
    let fromIndex = 0;
    while (fromIndex < lowered.length) {
      const idx = lowered.indexOf(normalized, fromIndex);
      if (idx === -1) break;
      count++;
      fromIndex = idx + normalized.length;
    }
    totalMentions += count;
    if (count > 0) matchedPhrases += 1;
  }
  return { totalMentions, matchedPhrases };
}

export function extractAnchorSnippet(wikitext: string, phrases: string[], radius = 200): string | null {
  const lowered = wikitext.toLowerCase();
  for (const phrase of phrases) {
    const normalized = phrase.trim().toLowerCase();
    if (!normalized) continue;
    const idx = lowered.indexOf(normalized);
    if (idx === -1) continue;
    const start = Math.max(0, idx - radius);
    const end = Math.min(wikitext.length, idx + normalized.length + radius);
    return wikitext.slice(start, end).trim();
  }
  return null;
}

/**
 * The section a piece of plain text sits in: its heading, or "(lead)" before
 * the first heading and when the text is not found. Pass the page's stripped
 * text and its buildSectionCharMap to locate many sentences on one revision
 * without re-stripping it each time.
 */
export function findSectionForText(
  wikitext: string,
  plainText: string,
  preStripped?: string,
  sectionCharMap?: SectionOffset[],
): string {
  const page = preStripped !== undefined && sectionCharMap ? undefined : stripWikitextWithSections(wikitext);
  const stripped = normalizeForSearch(preStripped ?? page?.text ?? "");
  const sections = sectionCharMap ?? page?.sections ?? [];
  const targetIdx = stripped.indexOf(normalizeForSearch(plainText).trim());

  if (targetIdx < 0) return "(lead)";

  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i].charOffset <= targetIdx) return sections[i].section;
  }
  return "(lead)";
}

/**
 * Where each section's prose starts in the page's stripped text, starting with
 * "(lead)" at 0. The offsets are the ones findSectionForText compares against:
 * see StrippedWikitext.sections.
 */
export function buildSectionCharMap(wikitext: string): SectionOffset[] {
  return stripWikitextWithSections(wikitext).sections;
}
