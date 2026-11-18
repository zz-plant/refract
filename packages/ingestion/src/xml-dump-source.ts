import { readFileSync } from "node:fs";
import type { Revision } from "@refract-org/evidence-graph";
import type { RevisionOptions, RevisionSource } from "./index.js";

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Titles compare with underscores as spaces, as MediaWiki stores them. */
function sameTitle(a: string, b: string): boolean {
  return a.replace(/_/g, " ").trim() === b.replace(/_/g, " ").trim();
}

// The readers below scan with indexOf rather than lazy regexes. Patterns such
// as /<page>([\s\S]*?)<\/page>/, /<comment>([\s\S]*?)<\/comment>/ and
// /<contributor>[\s\S]*?<username>…/ were retried from every opener in text
// that never closed one, which took time quadratic in its length. Each scan
// here only moves forward.

/** The text between the first `open` at or after `from` and the next `close`, and the index after `close`. */
function between(text: string, open: string, close: string, from = 0): { inner: string; end: number } | undefined {
  const start = text.indexOf(open, from);
  if (start < 0) return undefined;
  const stop = text.indexOf(close, start + open.length);
  if (stop < 0) return undefined;
  return { inner: text.slice(start + open.length, stop), end: stop + close.length };
}

function extractPageXml(text: string, title: string): string | null {
  for (let page = between(text, "<page>", "</page>"); page; page = between(text, "<page>", "</page>", page.end)) {
    const pageTitle = between(page.inner, "<title>", "</title>");
    if (pageTitle && sameTitle(decodeXmlEntities(pageTitle.inner), title)) return page.inner;
  }
  return null;
}

/** The editor a revision's <contributor> names: its <username>, or the <ip> of a logged-out edit. */
function readContributor(xml: string): string | undefined {
  const block = between(xml, "<contributor>", "</contributor>")?.inner;
  if (block === undefined) return undefined;
  return between(block, "<username>", "</username>")?.inner ?? between(block, "<ip>", "</ip>")?.inner;
}

/** The first <text …> tag: its attributes, whether it closes itself, and where it ends. */
function readTextTag(xml: string): { attrs: string; selfClosing: boolean; end: number } | undefined {
  let from = 0;
  for (;;) {
    const open = xml.indexOf("<text", from);
    if (open < 0) return undefined;
    const next = xml[open + 5];
    // "<textarea" or similar is not a <text> tag.
    if (next !== undefined && /[A-Za-z0-9_:-]/.test(next)) {
      from = open + 5;
      continue;
    }
    const gt = xml.indexOf(">", open + 5);
    if (gt < 0) return undefined;
    const inside = xml.slice(open + 5, gt).trimEnd();
    const selfClosing = inside.endsWith("/");
    return { attrs: selfClosing ? inside.slice(0, -1) : inside, selfClosing, end: gt + 1 };
  }
}

function extractRevisions(pageXml: string, pageTitle: string, pageId: number, options?: RevisionOptions): Revision[] {
  const revs: Revision[] = [];

  for (
    let revision = between(pageXml, "<revision>", "</revision>");
    revision;
    revision = between(pageXml, "<revision>", "</revision>", revision.end)
  ) {
    const xml = revision.inner;
    const idMatch = xml.match(/<id>(\d+)<\/id>/);
    const ts = between(xml, "<timestamp>", "</timestamp>")?.inner;
    if (!idMatch || ts === undefined) continue;

    const revId = parseInt(idMatch[1], 10);

    const parentMatch = xml.match(/<parentid>(\d+)<\/parentid>/);
    const commentRaw = between(xml, "<comment>", "</comment>")?.inner;
    const comment = commentRaw !== undefined ? decodeXmlEntities(commentRaw) : "";
    const user = readContributor(xml);

    // A revision whose text was deleted is exported as <text … deleted="deleted" />.
    // Read as empty text, it looked like the page being blanked.
    const textTag = readTextTag(xml);
    const textHidden = textTag ? /\bdeleted\s*=/.test(textTag.attrs) : false;
    const closeAt = textTag && !textTag.selfClosing ? xml.indexOf("</text>", textTag.end) : -1;
    const content = textTag && closeAt >= 0 ? decodeXmlEntities(xml.slice(textTag.end, closeAt)) : "";
    const bytes = textTag?.attrs.match(/\bbytes\s*=\s*"(\d+)"/);

    if (options?.start && new Date(ts) < options.start) continue;
    if (options?.end && new Date(ts) > options.end) continue;

    revs.push({
      revId,
      ...(parentMatch ? { parentId: parseInt(parentMatch[1], 10) } : {}),
      ...(textHidden || !textTag ? { contentAvailable: false } : {}),
      pageId,
      pageTitle,
      timestamp: ts,
      ...(user !== undefined ? { user: decodeXmlEntities(user) } : {}),
      comment,
      content,
      size: bytes ? parseInt(bytes[1], 10) : Buffer.byteLength(content, "utf8"),
      minor: /<minor\s*\/>/.test(xml),
    });

    if (options?.limit && revs.length >= options.limit) break;
  }

  return revs;
}

/**
 * Revisions from a MediaWiki XML export: a Special:Export file or an
 * uncompressed dump. The whole file is read into memory once, on first use,
 * and kept for later pages, so one instance can serve every page in it.
 */
export class XmlDumpRevisionSource implements RevisionSource {
  private filePath: string;
  private text: string | undefined;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async *revisions(pageTitle: string, options?: RevisionOptions): AsyncIterable<Revision> {
    this.text ??= readFileSync(this.filePath, "utf-8");
    const text = this.text;
    const pageXml = extractPageXml(text, pageTitle);
    if (!pageXml) return;

    const idMatch = pageXml.match(/<id>(\d+)<\/id>/);
    const pageId = idMatch ? parseInt(idMatch[1], 10) : 0;

    const revs = extractRevisions(pageXml, pageTitle, pageId, options);
    for (const rev of revs) {
      yield rev;
    }
  }
}
