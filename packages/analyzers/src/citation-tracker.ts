import { createHash } from "node:crypto";
import type { SourceAuthority, SourceLineage, SourceRecord, SourceType } from "@refract-org/evidence-graph";
import type { CitationChange, CitationRef, CitationTracker } from "./index.js";
import { stripWikitextWithSections } from "./wikitext-parser.js";

// The three scans below replace regexes that took super-linear time on
// unclosed or repeated markup: /<ref\b([^>]*?)>(.*?)<\/ref\s*>/gs and
// /<ref\b([^>]*?)\/\s*>/g re-read the rest of the text from every "<ref" whose
// tag did not close (quadratic in the number of openers), and
// /title\s*=\s*([^|}\]]+?)(?:\s*[|}\]])/i split whitespace between three
// quantifiers (cubic). Each returns exactly what its regex matched; the
// positions of the next ">" and the next delimiter are carried forward rather
// than searched for again.

const WORD_CHAR = /[A-Za-z0-9_]/;
const WHITESPACE = /\s/;

/** Whether "<ref" at `open` ends at a word boundary, as `<ref\b` requires. */
function refTagBoundary(text: string, open: number): boolean {
  const next = open + 4;
  return next >= text.length || !WORD_CHAR.test(text[next]);
}

/** The first `</ref\s*>` starting at or after `from`. */
function findClosingRef(text: string, from: number): { start: number; end: number } | null {
  let at = from;
  for (;;) {
    const start = text.indexOf("</ref", at);
    if (start < 0) return null;
    let i = start + 5;
    while (i < text.length && WHITESPACE.test(text[i])) i++;
    if (text[i] === ">") return { start, end: i + 1 };
    at = start + 1;
  }
}

/** Whether the tag that ends at `gt` closes itself: its last non-space character before ">" is "/". */
function selfCloses(text: string, gt: number): boolean {
  let k = gt - 1;
  while (k >= 0 && WHITESPACE.test(text[k])) k--;
  return text[k] === "/";
}

/**
 * Each `<ref …>…</ref>`, in order, with where it starts and ends.
 *
 * A self-closing `<ref name="x"/>` opens nothing. It was read as an opener,
 * as /<ref\b([^>]*?)>(.*?)<\/ref\s*>/gs reads it, so the match ran on to the
 * next `</ref>` and swallowed the reference after it: on a page that reuses
 * a named reference, the next full reference was never seen.
 */
function matchRefTags(
  text: string,
): Array<{ attrs: string; content: string; raw: string; start: number; end: number }> {
  const tags: Array<{ attrs: string; content: string; raw: string; start: number; end: number }> = [];
  let from = 0;
  let gt = -1;
  for (;;) {
    const open = text.indexOf("<ref", from);
    if (open < 0) break;
    if (!refTagBoundary(text, open)) {
      from = open + 1;
      continue;
    }
    const attrsStart = open + 4;
    if (gt < attrsStart) gt = text.indexOf(">", attrsStart);
    // With no ">" or no closing tag after this opener, none follows a later one.
    if (gt < 0) break;
    if (selfCloses(text, gt)) {
      from = gt + 1;
      continue;
    }
    const close = findClosingRef(text, gt + 1);
    if (!close) break;
    tags.push({
      attrs: text.slice(attrsStart, gt),
      content: text.slice(gt + 1, close.start),
      raw: text.slice(open, close.end),
      start: open,
      end: close.end,
    });
    from = close.end;
  }
  return tags;
}

/** Each match of /<ref\b([^>]*?)\/\s*>/g, in order. */
function matchSelfClosingRefs(text: string): Array<{ attrs: string; raw: string; start: number; end: number }> {
  const tags: Array<{ attrs: string; raw: string; start: number; end: number }> = [];
  let from = 0;
  let gt = -1;
  let slash = -1;
  for (;;) {
    const open = text.indexOf("<ref", from);
    if (open < 0) break;
    if (!refTagBoundary(text, open)) {
      from = open + 1;
      continue;
    }
    const attrsStart = open + 4;
    if (gt < attrsStart) {
      gt = text.indexOf(">", attrsStart);
      if (gt < 0) break;
      // The tag closes itself when the last non-space character before ">" is "/".
      let k = gt - 1;
      while (k >= 0 && WHITESPACE.test(text[k])) k--;
      slash = text[k] === "/" ? k : -1;
    }
    if (slash >= attrsStart) {
      tags.push({ attrs: text.slice(attrsStart, slash), raw: text.slice(open, gt + 1), start: open, end: gt + 1 });
      from = gt + 1;
    } else {
      from = open + 1;
    }
  }
  return tags;
}

/**
 * /title\s*=\s*([^|}\]]+?)(?:\s*[|}\]])/i, trimmed: the value after the first
 * "title" (in any ASCII case) followed by "=" and at least one character before
 * the next "|", "}" or "]".
 */
function extractCitationTitle(content: string): string | undefined {
  const lower = content.replace(/[A-Z]/g, (c) => c.toLowerCase());
  let from = 0;
  let delimiter = -1;
  for (;;) {
    const at = lower.indexOf("title", from);
    if (at < 0) return undefined;
    let i = at + 5;
    while (i < content.length && WHITESPACE.test(content[i])) i++;
    if (content[i] === "=") {
      const valueStart = i + 1;
      if (delimiter < valueStart) {
        delimiter = valueStart;
        while (delimiter < content.length && !"|}]".includes(content[delimiter])) delimiter++;
        if (delimiter === content.length) return undefined;
      }
      if (delimiter > valueStart) return content.slice(valueStart, delimiter).trim();
    }
    from = at + 1;
  }
}

/**
 * The URL a reference cites: its `url=` parameter, or else the first bare
 * http(s) URL in it. Only a parameter named exactly `url` counts, so an
 * `archive-url=` or `chapter-url=` written first is not taken for it; a bare
 * `<ref>https://…</ref>` or `<ref>[https://… Title]</ref>` used to have none.
 */
function citationUrl(content: string): string | undefined {
  const param = content.match(/\|\s*url\s*=\s*([^\s|}\]<]+)/i);
  if (param) return param[1].trim();
  return content.match(/https?:\/\/[^\s|}\]<>"]+/i)?.[0];
}

/** The host a URL names, lowercased and without a leading "www.", or undefined when it does not parse. */
export function citationDomain(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** How citations are matched between revisions: by name, or by their whole text when unnamed. */
export function citationKey(ref: CitationRef): string {
  return ref.refName ?? ref.raw;
}

export interface CitationAnchors {
  /**
   * For each citation key (see citationKey), the prose each of its
   * occurrences follows, in page order without repeats: the text from the
   * start of the sentence up to the reference. A reference inside a template,
   * a comment or a heading follows no prose and has none.
   */
  byKey: Map<string, string[]>;
  /** How many distinct citations follow each anchor, keyed by its normalized text (see normalizeAnchor). */
  citationsPerAnchor: Map<string, number>;
  /** The page's prose, normalized as anchors are, to check whether an anchor is still there. */
  normalizedProse: string;
}

/** Lowercase with whitespace runs as single spaces: the form anchors are compared in. */
export function normalizeAnchor(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// Stand in for each reference while the page is stripped to prose. Control
// characters cannot be saved in a page, and any in the input are dropped first.
const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";
const MARK = new RegExp(`${MARK_OPEN}(\\d+)${MARK_CLOSE}`, "g");

// The longest anchor kept. Without a bound, a long line with no sentence
// breaks and many references would be scanned back once per reference.
const MAX_ANCHOR_CHARS = 1000;

/** The text from the start of the sentence that `offset` ends, up to `offset`, at most MAX_ANCHOR_CHARS long. */
function sentenceBefore(text: string, offset: number): string {
  let end = offset;
  while (end > 0 && WHITESPACE.test(text[end - 1])) end--;
  const floor = Math.max(0, end - MAX_ANCHOR_CHARS);
  let start = floor;
  // From the character before the last: the last may be the sentence's own full stop.
  for (let i = end - 2; i >= floor; i--) {
    if (text[i] === "\n") {
      start = i + 1;
      break;
    }
    if ((text[i] === "." || text[i] === "!" || text[i] === "?") && WHITESPACE.test(text[i + 1])) {
      start = i + 1;
      break;
    }
  }
  return text.slice(start, end).trim();
}

/**
 * Which prose each citation follows. Each reference is replaced by a marker,
 * the page is stripped to prose by the same code sentence events read, and
 * the sentence before each surviving marker is the anchor. Markers inside a
 * template or comment are removed with it, so those references have none.
 */
export function extractCitationAnchors(wikitext: string): CitationAnchors {
  const text = wikitext.replaceAll(MARK_OPEN, "").replaceAll(MARK_CLOSE, "");
  const spans: Array<{ start: number; end: number; key: string }> = [];
  for (const tag of matchRefTags(text)) {
    const name = tag.attrs.match(/name\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    spans.push({ start: tag.start, end: tag.end, key: name ?? tag.raw });
  }
  for (const tag of matchSelfClosingRefs(text)) {
    const name = tag.attrs.match(/name\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    if (name) spans.push({ start: tag.start, end: tag.end, key: name });
  }
  spans.sort((a, b) => a.start - b.start);

  const keys: string[] = [];
  let marked = "";
  let at = 0;
  for (const span of spans) {
    if (span.start < at) continue;
    marked += `${text.slice(at, span.start)}${MARK_OPEN}${keys.length}${MARK_CLOSE}`;
    keys.push(span.key);
    at = span.end;
  }
  marked += text.slice(at);

  const stripped = stripWikitextWithSections(marked).text;
  let prose = "";
  let last = 0;
  const found: Array<{ key: string; offset: number }> = [];
  for (const match of stripped.matchAll(MARK)) {
    prose += stripped.slice(last, match.index);
    found.push({ key: keys[Number(match[1])], offset: prose.length });
    last = (match.index ?? 0) + match[0].length;
  }
  prose += stripped.slice(last);

  const byKey = new Map<string, string[]>();
  const keysPerAnchor = new Map<string, Set<string>>();
  for (const { key, offset } of found) {
    const anchor = sentenceBefore(prose, offset);
    if (!anchor) continue;
    const anchors = byKey.get(key) ?? [];
    if (!anchors.includes(anchor)) anchors.push(anchor);
    byKey.set(key, anchors);
    const normalized = normalizeAnchor(anchor);
    const holders = keysPerAnchor.get(normalized) ?? new Set<string>();
    holders.add(key);
    keysPerAnchor.set(normalized, holders);
  }
  const citationsPerAnchor = new Map([...keysPerAnchor].map(([anchor, holders]) => [anchor, holders.size]));
  return { byKey, citationsPerAnchor, normalizedProse: normalizeAnchor(prose) };
}

export const citationTracker: CitationTracker = {
  extractCitations(wikitext: string): CitationRef[] {
    const refs: CitationRef[] = [];
    const seen = new Set<string>();

    for (const tag of matchRefTags(wikitext)) {
      const attrs = tag.attrs;
      const content = tag.content.trim();

      const nameMatch = attrs.match(/name\s*=\s*["']?([^"'\s>]+)/i);
      const url = citationUrl(content);

      const raw = tag.raw;
      const key = nameMatch ? nameMatch[1] : raw;

      if (seen.has(key)) continue;
      seen.add(key);

      refs.push({
        refName: nameMatch?.[1],
        url,
        title: extractCitationTitle(content),
        raw,
      });
    }

    for (const tag of matchSelfClosingRefs(wikitext)) {
      const nameMatch = tag.attrs.match(/name\s*=\s*["']?([^"'\s>]+)/i);
      if (!nameMatch) continue;

      const key = nameMatch[1];
      if (seen.has(key)) continue;
      seen.add(key);

      refs.push({
        refName: key,
        raw: tag.raw,
      });
    }

    return refs;
  },

  /** Diff two citation lists, returning added/removed/replaced/unchanged changes. */
  diffCitations(before: CitationRef[], after: CitationRef[]): CitationChange[] {
    const changes: CitationChange[] = [];
    const beforeMap = indexByKey(before);
    const afterMap = indexByKey(after);

    for (const [key, afterRef] of afterMap) {
      const beforeRef = beforeMap.get(key);
      if (!beforeRef) {
        changes.push({ type: "added", after: afterRef });
      } else if (beforeRef.raw !== afterRef.raw) {
        changes.push({ type: "replaced", before: beforeRef, after: afterRef });
      } else {
        changes.push({ type: "unchanged", after: afterRef });
      }
    }

    for (const [key, beforeRef] of beforeMap) {
      if (!afterMap.has(key)) {
        changes.push({ type: "removed", before: beforeRef });
      }
    }

    return changes;
  },
};

function indexByKey(refs: CitationRef[]): Map<string, CitationRef> {
  const map = new Map<string, CitationRef>();
  for (const ref of refs) {
    const key = citationKey(ref);
    map.set(key, ref);
  }
  return map;
}

export function buildSourceLineage(revisions: { revId: number; timestamp: string; content: string }[]): {
  sources: SourceRecord[];
  lineage: SourceLineage[];
} {
  const sourceMap = new Map<string, SourceRecord>();
  const replacementMap = new Map<string, { replacedById: string; atRevisionId: number; atTimestamp: string }[]>();

  function ensureSource(ref: CitationRef, seenAtRevId: number, seenAtTimestamp: string): string {
    const sourceId = buildSourceId(ref);
    if (!sourceMap.has(sourceId)) {
      sourceMap.set(sourceId, {
        sourceId,
        url: ref.url,
        title: ref.title,
        sourceType: classifySourceType(ref),
        authority: classifyAuthority(ref),
        firstSeenRevisionId: seenAtRevId,
        firstSeenAt: seenAtTimestamp,
        claimsReferencing: [],
      });
    }
    return sourceId;
  }

  const allCitations = revisions.map((r) => citationTracker.extractCitations(r.content));

  // Seed sources from the first revision
  if (revisions.length > 0) {
    for (const ref of allCitations[0]) {
      ensureSource(ref, revisions[0].revId, revisions[0].timestamp);
    }
  }

  for (let i = 0; i < revisions.length - 1; i++) {
    const before = revisions[i];
    const after = revisions[i + 1];

    const beforeRefs = allCitations[i];
    const afterRefs = allCitations[i + 1];
    const changes = citationTracker.diffCitations(beforeRefs, afterRefs);

    for (const change of changes) {
      if (change.after) {
        const id = ensureSource(change.after, after.revId, after.timestamp);
        if (change.type === "replaced" && change.before) {
          const oldId = ensureSource(change.before, after.revId, after.timestamp);
          const replacements = replacementMap.get(oldId) ?? [];
          replacements.push({
            replacedById: id,
            atRevisionId: after.revId,
            atTimestamp: after.timestamp,
          });
          replacementMap.set(oldId, replacements);
        }
      }

      if ((change.type === "removed" || change.type === "replaced") && change.before) {
        const sourceId = ensureSource(change.before, before.revId, before.timestamp);
        const record = sourceMap.get(sourceId);
        if (record) {
          record.lastSeenRevisionId = before.revId;
          record.lastSeenAt = before.timestamp;
        }
      }
    }
  }

  const sources = Array.from(sourceMap.values());
  const lineage: SourceLineage[] = [];
  for (const [sourceId, replacements] of replacementMap) {
    lineage.push({ sourceId, replacements });
  }

  return { sources, lineage };
}

export function buildSourceId(ref: CitationRef): string {
  if (ref.url) {
    return createHash("sha256").update(ref.url).digest("hex").slice(0, 16);
  }
  if (ref.refName) {
    return createHash("sha256").update(`ref:${ref.refName}`).digest("hex").slice(0, 16);
  }
  return createHash("sha256").update(ref.raw).digest("hex").slice(0, 16);
}

const NEWS_DOMAINS = [
  "cnn.com",
  "nytimes.com",
  "bbc.com",
  "reuters.com",
  "apnews.com",
  "washingtonpost.com",
  "wsj.com",
  "theguardian.com",
  "bloomberg.com",
  "npr.org",
  "thehill.com",
  "politico.com",
  "foxnews.com",
  "nbcnews.com",
  "cbsnews.com",
  "abcnews.net",
  "usatoday.com",
  "latimes.com",
  "chicagotribune.com",
  "huffpost.com",
  "buzzfeednews.com",
];

function classifySourceType(ref: CitationRef): SourceType {
  const url = ref.url?.toLowerCase() ?? "";
  if (!url) return "unknown";

  if (url.includes("doi.org") || /journal|jstor|springer|sciencedirect/i.test(url)) {
    return "academic";
  }
  if (url.includes(".gov")) return "government";
  if (url.includes(".edu")) return "secondary";
  if (NEWS_DOMAINS.some((d) => url.includes(d))) return "news";

  return "unknown";
}

function classifyAuthority(ref: CitationRef): SourceAuthority {
  const url = ref.url?.toLowerCase() ?? "";
  if (!url) return "unrated";

  if (url.includes("doi.org") || /journal|jstor|springer/i.test(url)) {
    return "medium";
  }
  if (/\.(edu|gov|org)\b/.test(url)) return "high";
  if (/\.(com|net)\b/.test(url)) return "medium";

  return "unrated";
}

export interface CitationNetworkAnalysis {
  uniqueSourceCount: number;
  domainDistribution: Record<string, number>;
  topSources: Array<{ sourceId: string; url?: string; count: number }>;
  sourceConcentrationIndex: number;
  isHighConcentration: boolean;
}

function extractDomain(url?: string): string {
  if (!url) return "unknown";
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * Analyzes the network structure, domain diversity, and concentration of a collection of citations.
 * High concentration indicates heavy reliance on a narrow set of domains or sources.
 */
export function analyzeCitationNetwork(citations: CitationRef[]): CitationNetworkAnalysis {
  if (citations.length === 0) {
    return {
      uniqueSourceCount: 0,
      domainDistribution: {},
      topSources: [],
      sourceConcentrationIndex: 0,
      isHighConcentration: false,
    };
  }

  const sourceCounts = new Map<string, { ref: CitationRef; count: number }>();
  const domainDistribution: Record<string, number> = {};

  for (const c of citations) {
    const sId = buildSourceId(c);
    const existing = sourceCounts.get(sId);
    if (existing) {
      existing.count++;
    } else {
      sourceCounts.set(sId, { ref: c, count: 1 });
    }

    const domain = extractDomain(c.url);
    domainDistribution[domain] = (domainDistribution[domain] ?? 0) + 1;
  }

  const total = citations.length;
  // Herfindahl-Hirschman concentration index: sum of squared market shares of domains
  let hhi = 0;
  for (const count of Object.values(domainDistribution)) {
    const share = count / total;
    hhi += share * share;
  }

  const topSources = Array.from(sourceCounts.entries())
    .map(([sourceId, { ref, count }]) => ({ sourceId, url: ref.url, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const roundedHhi = Number(hhi.toFixed(4));
  return {
    uniqueSourceCount: sourceCounts.size,
    domainDistribution,
    topSources,
    sourceConcentrationIndex: roundedHhi,
    isHighConcentration: roundedHhi > 0.4 && total >= 3,
  };
}
