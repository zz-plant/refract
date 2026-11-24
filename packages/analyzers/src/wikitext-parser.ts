/**
 * A fragment of wikitext as plain text: comments and references removed,
 * list templates reduced to their items and every other template removed,
 * links reduced to their labels, bold and italic markers dropped, line breaks
 * and whitespace runs as single spaces.
 *
 * Each step is a forward scan. The regexes these replace, such as
 * /<!--[\s\S]*?-->/ and /\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/, were retried from
 * every opener in text that never closed one, which took time quadratic in
 * its length; `refract field` passes values read from wiki revisions here.
 */
export function sanitizeWikitext(value: string): string {
  const withoutMarkup = replaceExternalLinks(
    replaceWikilinks(removeTemplates(expandListTemplates(removeRefTags(removeComments(value, " "), " ")), " ")),
  );
  return withoutMarkup
    .replaceAll("'''", "")
    .replaceAll("''", "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^· /, "");
}

/**
 * Templates whose arguments are the words a reader sees, one list item each.
 * plainlist and flatlist take one argument holding a "*" list. Matched by
 * name without regard to case, with "_" as a space.
 */
const LIST_TEMPLATES = new Set([
  "blist",
  "bulleted list",
  "ubl",
  "ubil",
  "unbulleted list",
  "plainlist",
  "plain list",
  "flatlist",
  "hlist",
]);

/** Longer than any name in LIST_TEMPLATES or "nowrap", so a template's name is read in bounded time. */
const LONGEST_KEPT_NAME = 24;

/** Lists nested deeper than this are left to removeTemplates, so no input can exhaust the call stack. */
const DEEPEST_LIST = 16;

/**
 * Each list template replaced by its items, each after " · ", and each
 * {{nowrap|…}} by its text. Removing them with every other template, as
 * removeTemplates does, emptied an infobox value such as
 * "Ongoing<br>{{blist|Strait of Hormuz crisis|…}}" down to "Ongoing", so an
 * item added or removed read as a change to markup alone.
 *
 * Named arguments, such as class= and style=, set layout and are dropped: an
 * argument is named when it has an "=" outside the templates and links inside
 * it, as MediaWiki reads it. Within an argument, each line is an item, with
 * its "*" or "#" markers removed. Every other template is left as it stands,
 * for removeTemplates. Braces are paired in one scan, so each template's text
 * is read once however deeply lists nest, and pairing follows removeTemplates:
 * an opener that never closes, and a closer with no opener, stay as text.
 * Lists nested more than DEEPEST_LIST deep are removed, as they were before.
 */
function expandListTemplates(text: string): string {
  if (!text.includes("{{")) return text;
  const closeOf = new Map<number, number>();
  const openers: number[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "{" && text[i + 1] === "{") {
      openers.push(i);
      i++;
    } else if (text[i] === "}" && text[i + 1] === "}" && openers.length > 0) {
      closeOf.set(openers.pop() as number, i);
      i++;
    }
  }

  type Arg = { from: number; to: number; named: boolean; lines: number[] };

  // The template's top-level arguments, from just after its "{{" to its "}}".
  const splitArgs = (from: number, to: number): Arg[] => {
    const args: Arg[] = [];
    let current: Arg = { from, to, named: false, lines: [] };
    let links = 0;
    for (let i = from; i < to; i++) {
      const close = text[i] === "{" && text[i + 1] === "{" ? closeOf.get(i) : undefined;
      if (close !== undefined) {
        i = close + 1;
      } else if (text[i] === "[" && text[i + 1] === "[") {
        links++;
        i++;
      } else if (text[i] === "]" && text[i + 1] === "]" && links > 0) {
        links--;
        i++;
      } else if (links === 0 && text[i] === "|") {
        current.to = i;
        args.push(current);
        current = { from: i + 1, to, named: false, lines: [] };
      } else if (links === 0 && text[i] === "=") {
        current.named = true;
      } else if (links === 0 && text[i] === "\n") {
        current.lines.push(i);
      }
    }
    args.push(current);
    return args;
  };

  const expand = (from: number, to: number, depth: number): string | undefined => {
    if (depth > DEEPEST_LIST) return undefined;
    let nameEnd = from;
    while (nameEnd < to && text[nameEnd] !== "|" && nameEnd - from <= LONGEST_KEPT_NAME) nameEnd++;
    if (nameEnd - from > LONGEST_KEPT_NAME) return undefined;
    const name = text.slice(from, nameEnd).replaceAll("_", " ").replace(/\s+/g, " ").trim().toLowerCase();
    const isList = LIST_TEMPLATES.has(name);
    if (!isList && name !== "nowrap") return undefined;
    const positional = splitArgs(from, to)
      .slice(1)
      .filter((arg) => !arg.named);
    if (!isList) return positional[0] ? render(positional[0].from, positional[0].to, depth) : " ";
    const items: string[] = [];
    for (const arg of positional) {
      let start = arg.from;
      for (const end of [...arg.lines, arg.to]) {
        // A list nested as the item brings its own leading separator.
        const item = render(start, end, depth)
          .replace(/^\s*[*#]+/, "")
          .trim()
          .replace(/^· /, "");
        if (item) items.push(item);
        start = end + 1;
      }
    }
    return `${items.map((item) => ` · ${item}`).join("")} `;
  };

  const render = (from: number, to: number, depth: number): string => {
    let out = "";
    let at = from;
    for (let i = from; i < to - 1; i++) {
      const close = text[i] === "{" && text[i + 1] === "{" ? closeOf.get(i) : undefined;
      if (close === undefined) continue;
      const expanded = expand(i + 2, close, depth + 1);
      if (expanded !== undefined) {
        out += text.slice(at, i) + expanded;
        at = close + 2;
      }
      i = close + 1;
    }
    return out + text.slice(at, to);
  };

  return render(0, text.length, 0);
}

/** Remove each `<!-- … -->`, putting `replacement` where it stood; an opener with no `-->` after it stays. */
function removeComments(text: string, replacement: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("<!--", at);
    if (open < 0) break;
    const close = text.indexOf("-->", open + 4);
    if (close < 0) break;
    out += text.slice(at, open) + replacement;
    at = close + 3;
  }
  return out + text.slice(at);
}

/** The next index at or after `from` where `needle`, lowercase ASCII, starts in `text` in any case. */
function indexOfIgnoreCase(text: string, needle: string, from: number): number {
  const first = needle[0];
  for (let i = text.indexOf(first, from); i >= 0; i = text.indexOf(first, i + 1)) {
    if (text.slice(i, i + needle.length).toLowerCase() === needle) return i;
  }
  return -1;
}

/**
 * Remove each `<ref …>…</ref>` whose opening tag has no "/", and each
 * self-closing `<ref …/>`, as /<ref[^>/]*?>[\s\S]*?<\/ref>/gi and
 * /<ref[^>]*\/>/gi did, in any case.
 */
function removeRefTags(text: string, replacement: string): string {
  let out = "";
  let at = 0;
  let from = 0;
  // Cached across openers, so no stretch of text is searched twice: the ">"
  // ending the current tag, the last "/" before it, and the next "</ref>"
  // (-1 once none is left).
  let gt = -1;
  let lastSlash = -1;
  let closeRef = -2;
  for (;;) {
    const open = indexOfIgnoreCase(text, "<ref", from);
    if (open < 0) break;
    if (gt < open + 4) {
      gt = text.indexOf(">", open + 4);
      if (gt < 0) break;
      lastSlash = -1;
      for (let k = gt - 1; k >= open + 4; k--) {
        if (text[k] === "/") {
          lastSlash = k;
          break;
        }
      }
    }
    let end = -1;
    if (gt - 1 >= open + 4 && text[gt - 1] === "/") end = gt + 1;
    else if (lastSlash < open + 4) {
      if (closeRef !== -1 && closeRef < gt + 1) closeRef = indexOfIgnoreCase(text, "</ref>", gt + 1);
      if (closeRef >= 0) end = closeRef + 6;
    }
    if (end < 0) {
      from = open + 4;
      continue;
    }
    out += text.slice(at, open) + replacement;
    at = from = end;
  }
  return out + text.slice(at);
}

/**
 * `[[target|label]]` as its label and `[[target]]` as its target, as
 * /\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g did: the link runs to its first "]",
 * which must be followed by another, and the label is what follows the first
 * "|" unless nothing does.
 */
function replaceWikilinks(text: string): string {
  let out = "";
  let at = 0;
  let close = -1;
  for (let open = text.indexOf("[[", 0); open >= 0; open = text.indexOf("[[", open + 1)) {
    if (open < at) continue;
    // Every opener before the same "]" shares it, so it is found once for all of them.
    if (close < open + 2) close = text.indexOf("]", open + 2);
    if (close < 0) break;
    if (close === open + 2 || text[close + 1] !== "]") continue;
    const inner = text.slice(open + 2, close);
    const pipe = inner.indexOf("|");
    out += text.slice(at, open) + (pipe >= 0 && pipe < inner.length - 1 ? inner.slice(pipe + 1) : inner);
    at = close + 2;
    open = close + 1;
  }
  return out + text.slice(at);
}

/**
 * `[https://… label]` as its label, as /\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g
 * did: the URL runs to the first whitespace and the label from there to the
 * first "]".
 */
function replaceExternalLinks(text: string): string {
  let out = "";
  let at = 0;
  let close = -1;
  for (let open = text.indexOf("[http", 0); open >= 0; open = text.indexOf("[http", open + 1)) {
    if (open < at) continue;
    const scheme = text.startsWith("[https://", open) ? 9 : text.startsWith("[http://", open) ? 8 : 0;
    if (!scheme) continue;
    const urlStart = open + scheme;
    if (close < urlStart) close = text.indexOf("]", urlStart);
    if (close < 0) break;
    // Checked before slicing: openers that share a "]" would otherwise copy the same text again and again.
    if (close === urlStart || /\s/.test(text[urlStart])) continue;
    const body = text.slice(urlStart, close);
    let urlEnd = 0;
    while (urlEnd < body.length && !/\s/.test(body[urlEnd])) urlEnd++;
    let labelStart = urlEnd;
    while (labelStart < body.length && /\s/.test(body[labelStart])) labelStart++;
    out += text.slice(at, open) + body.slice(labelStart);
    at = close + 1;
    open = close;
  }
  return out + text.slice(at);
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
