export function sanitizeWikitext(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<ref[^>/]*?>[\s\S]*?<\/ref>/gi, " ")
    .replace(/<ref[^>]*/gi, (match) => (match.endsWith("/>") ? " " : match))
    .replace(/<ref[^>]*\/>/gi, " ")
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, "$1")
    .replace(/'''/g, "")
    .replace(/''/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripWikitext(wikitext: string): string {
  let text = wikitext;
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<ref\b[^>]*\/\s*>/gi, "");
  text = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/\{\{[^{}]*?\}\}/g, "");
  text = text.replace(/'''(.+?)'''/g, "$1");
  text = text.replace(/''(.+?)''/g, "$1");
  // A category tag is page metadata, not prose. Left in, its name joined the next
  // sentence. A visible link to a category, [[:Category:X]], has its own syntax.
  text = text.replace(/\[\[\s*Category\s*:[^\]]*\]\]/gi, "");
  // An interlanguage link points at another edition of the wiki; its label is a
  // language code, not prose. Left in, "de:Pluto (Zwergplanet)" landed in sentence
  // events. A visible interlanguage link, [[:de:Pluto]], keeps its leading colon and
  // stays; namespaces such as [[Wikipedia:Notability]] are capitalised, not codes.
  text = text.replace(/\[\[[a-z][a-z0-9_-]*:[^\]]*\]\]/g, "");
  text = text.replace(/\[\[([^\]|]+?)\]\]/g, "$1");
  text = text.replace(/\[\[[^\]]+?\|([^\]]+?)\]\]/g, "$1");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
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
  sectionCharMap?: Array<{ charOffset: number; section: string }>,
): string {
  const strippedBase = preStripped ?? stripWikitext(wikitext);
  const stripped = strippedBase.toLowerCase().replace(/\s+/g, " ");
  const targetIdx = stripped.indexOf(plainText.toLowerCase().replace(/\s+/g, " ").trim());

  if (targetIdx < 0) return "(lead)";

  if (sectionCharMap) {
    for (let i = sectionCharMap.length - 1; i >= 0; i--) {
      if (sectionCharMap[i].charOffset <= targetIdx) {
        return sectionCharMap[i].section;
      }
    }
    return "(lead)";
  }

  // No g flag: exec on a global regex resumes at lastIndex, so a heading on
  // the line right after another heading was skipped. See buildSectionCharMap
  // for why the title is matched whole and trimmed.
  const headerRegex = /^(=+)([^=]+)\1$/;
  const lines = wikitext.split("\n");
  let currentSection = "(lead)";
  let charCount = 0;

  for (const line of lines) {
    const match = headerRegex.exec(line);
    if (match) {
      if (charCount > targetIdx) return currentSection;
      currentSection = match[2].trim();
    }
    charCount += line.length + 1;
  }

  return currentSection;
}

/** Each heading's character offset in the wikitext, starting with "(lead)" at 0. */
export function buildSectionCharMap(wikitext: string): Array<{ charOffset: number; section: string }> {
  const lines = wikitext.split("\n");
  // The title is matched whole and trimmed after. As \s*([^=]+?)\s*, the
  // spaces on a line of "=" and spaces could be split between three
  // quantifiers, which took time cubic in the line's length: minutes for one
  // line of a few thousand characters.
  const headerRegex = /^(=+)([^=]+)\1$/;
  const map: Array<{ charOffset: number; section: string }> = [{ charOffset: 0, section: "(lead)" }];
  let charCount = 0;
  for (const line of lines) {
    const match = headerRegex.exec(line);
    if (match) {
      map.push({ charOffset: charCount, section: match[2].trim() });
    }
    charCount += line.length + 1;
  }
  return map;
}
