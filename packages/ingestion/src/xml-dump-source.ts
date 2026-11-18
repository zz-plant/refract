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
    const userMatch = xml.match(
      /<contributor>[\s\S]*?<(?:username|ip)>([\s\S]*?)<\/(?:username|ip)>[\s\S]*?<\/contributor>/,
    );

    // A revision whose text was deleted is exported as <text … deleted="deleted" />.
    // Read as empty text, it looked like the page being blanked.
    const textTag = xml.match(/<text\b([^>]*?)(\/?)>/);
    const textHidden = textTag ? /\bdeleted\s*=/.test(textTag[1]) : false;
    const textMatch = textTag && textTag[2] !== "/" ? xml.match(/<text[^>]*>([\s\S]*?)<\/text>/) : null;
    const content = textMatch ? decodeXmlEntities(textMatch[1]) : "";
    const bytes = textTag?.[1].match(/\bbytes\s*=\s*"(\d+)"/);

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
      ...(userMatch ? { user: decodeXmlEntities(userMatch[1]) } : {}),
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
