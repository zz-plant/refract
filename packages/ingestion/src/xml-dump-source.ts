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

function extractPageXml(text: string, title: string): string | null {
  const pattern = /<page>([\s\S]*?)<\/page>/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex loop pattern
  while ((match = pattern.exec(text)) !== null) {
    const titleMatch = match[1].match(/<title>(.*?)<\/title>/);
    if (titleMatch && sameTitle(decodeXmlEntities(titleMatch[1]), title)) {
      return match[1];
    }
  }
  return null;
}

// The two readers below scan with indexOf rather than a regex. Lazy runs
// such as /<contributor>[\s\S]*?<username>…/ and /<text\b([^>]*?)(\/?)>/ were
// retried from every opener in text that never closed one, which took time
// quadratic in its length.

/** The editor a revision's <contributor> names: its <username>, or the <ip> of a logged-out edit. */
function readContributor(xml: string): string | undefined {
  const open = xml.indexOf("<contributor>");
  if (open < 0) return undefined;
  const close = xml.indexOf("</contributor>", open);
  if (close < 0) return undefined;
  const block = xml.slice(open, close);
  for (const tag of ["username", "ip"]) {
    const start = block.indexOf(`<${tag}>`);
    if (start < 0) continue;
    const end = block.indexOf(`</${tag}>`, start);
    if (end >= 0) return block.slice(start + tag.length + 2, end);
  }
  return undefined;
}

/** The first <text …> tag: its attributes, and whether it closes itself. */
function readTextTag(xml: string): { attrs: string; selfClosing: boolean } | undefined {
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
    return { attrs: selfClosing ? inside.slice(0, -1) : inside, selfClosing };
  }
}

function extractRevisions(pageXml: string, pageTitle: string, pageId: number, options?: RevisionOptions): Revision[] {
  const revs: Revision[] = [];
  const re = /<revision>([\s\S]*?)<\/revision>/g;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex loop pattern
  while ((match = re.exec(pageXml)) !== null) {
    const xml = match[1];
    const idMatch = xml.match(/<id>(\d+)<\/id>/);
    const timestampMatch = xml.match(/<timestamp>(.*?)<\/timestamp>/);
    if (!idMatch || !timestampMatch) continue;

    const revId = parseInt(idMatch[1], 10);

    const parentMatch = xml.match(/<parentid>(\d+)<\/parentid>/);
    const commentRaw = xml.match(/<comment>([\s\S]*?)<\/comment>/);
    const comment = commentRaw ? decodeXmlEntities(commentRaw[1]) : "";
    const user = readContributor(xml);

    // A revision whose text was deleted is exported as <text … deleted="deleted" />.
    // Read as empty text, it looked like the page being blanked.
    const textTag = readTextTag(xml);
    const textHidden = textTag ? /\bdeleted\s*=/.test(textTag.attrs) : false;
    const textMatch = textTag && !textTag.selfClosing ? xml.match(/<text[^>]*>([\s\S]*?)<\/text>/) : null;
    const content = textMatch ? decodeXmlEntities(textMatch[1]) : "";
    const bytes = textTag?.attrs.match(/\bbytes\s*=\s*"(\d+)"/);

    const ts = timestampMatch[1];
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
