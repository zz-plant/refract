import {
  analyzeCitationNetwork,
  type CitationNetworkAnalysis,
  citationTracker,
  detectTextPropagation,
  extractCategories,
  extractWikilinks,
  type TextPropagationResult,
} from "@refract-org/analyzers";
import type { EvidenceEvent } from "@refract-org/evidence-graph";
import { type LanguageLink, MediaWikiClient } from "@refract-org/ingestion";
import { runAnalyze } from "./analyze.js";

interface WikiSummary {
  url: string;
  /** The title read on this wiki: the topic, one given with --title, or one found by --resolve-titles. */
  title: string;
  sections: string[];
  eventCounts: Record<string, number>;
  summary: {
    citations: number;
    templates: number;
    reverts: number;
    categories: number;
    wikilinks: number;
  };
  citationNetwork?: CitationNetworkAnalysis;
}

export interface EventTypeDiff {
  eventType: string;
  counts: number[];
  diffs: number[];
}

export interface OutlierEntry {
  wikiIndex: number;
  wikiLabel: string;
  eventType: string;
  count: number;
  mean: number;
  stdDev: number;
  zScore: number;
}

export interface PairwiseTextBorrowing {
  sourceWikiIndex: number;
  sourceWikiLabel: string;
  targetWikiIndex: number;
  targetWikiLabel: string;
  propagation: TextPropagationResult;
}

/** How many of each wiki's current references cite a domain. */
export interface CitedDomainRow {
  domain: string;
  counts: number[];
}

/** A canonical identifier (DOI or ISBN) cited on one or more wikis, comparable across scripts/languages. */
export interface SharedIdentifierRow {
  kind: "doi" | "isbn";
  identifier: string;
  presentOnWikis: boolean[];
  sharedCount: number;
}

/** How many citations of each structural source type (academic, intergovernmental, ngo, news, government) each wiki cites. */
export interface SourceTypeComparisonRow {
  sourceType: string;
  counts: number[];
}

export interface DiffResult {
  pageTitle: string;
  wikis: WikiSummary[];
  comparison: {
    eventTypeDiffs: EventTypeDiff[];
    totalEvents: number[];
    totalSections: number[];
    /**
     * Every domain the latest revisions cite, with each wiki's count, most
     * cited first. Comparable across languages where text is not.
     */
    citedDomains: CitedDomainRow[];
    /**
     * Canonical academic/book identifiers (DOI, ISBN) across wikis, showing
     * cross-language citation overlap even when article text is in different scripts.
     */
    sharedIdentifiers?: SharedIdentifierRow[];
    /**
     * Distribution of structural source categories (academic, intergovernmental, ngo, news, government) across wikis.
     */
    sourceTypes?: SourceTypeComparisonRow[];
  };
  outliers: OutlierEntry[];
  pairwiseBorrowing?: PairwiseTextBorrowing[];
  generatedAt: string;
}

export interface DiffOptions {
  detectBorrowing?: boolean;
  /** A title per wiki, by position; an absent one is the topic, or is resolved with `resolveTitles`. */
  titles?: (string | undefined)[];
  /** Find each other wiki's title through the first wiki's interlanguage links. */
  resolveTitles?: boolean;
}

/** The interwiki prefixes a wiki may go by: its host's first label (such as "ru" in ru.wikipedia.org) and its content language. */
function languagePrefixes(apiUrl: string, contentLanguage: string | undefined): string[] {
  const prefixes: string[] = [];
  try {
    const label = new URL(apiUrl).hostname.split(".")[0]?.toLowerCase();
    if (label) prefixes.push(label);
  } catch {
    // An unparseable URL leaves only the content language to go on.
  }
  if (contentLanguage) prefixes.push(contentLanguage.toLowerCase());
  return prefixes;
}

/**
 * The title to read on each wiki. The first wiki reads its given title or
 * the topic. Each other wiki reads its given title; else, with
 * `resolveTitles`, the title the first wiki's page links to in that wiki's
 * language; else the topic. A wiki the first page has no interlanguage link
 * to is an error naming the --title to give.
 */
export async function resolveDiffTitles(
  topic: string,
  wikiUrls: readonly string[],
  options: Pick<DiffOptions, "titles" | "resolveTitles"> = {},
): Promise<string[]> {
  const given = options.titles ?? [];
  const first = given[0] ?? topic;
  let links: LanguageLink[] | undefined;
  const titles: string[] = [first];
  for (let i = 1; i < wikiUrls.length; i++) {
    const explicit = given[i];
    if (explicit !== undefined) {
      titles.push(explicit);
      continue;
    }
    if (!options.resolveTitles || wikiUrls[i] === wikiUrls[0]) {
      titles.push(options.resolveTitles ? first : topic);
      continue;
    }
    links ??= await new MediaWikiClient({ apiUrl: wikiUrls[0] }).fetchLanguageLinks(first);
    const site = await new MediaWikiClient({ apiUrl: wikiUrls[i] }).fetchSiteInfo().catch(() => undefined);
    const prefixes = languagePrefixes(wikiUrls[i], site?.lang);
    const link = prefixes.map((prefix) => links?.find((l) => l.lang.toLowerCase() === prefix)).find(Boolean);
    if (!link) {
      const label = String.fromCharCode(97 + i);
      throw new Error(
        `"${first}" on ${wikiUrls[0]} has no interlanguage link to ${wikiUrls[i]} (tried ${prefixes.join(", ") || "no prefix"}); give its title with --title ${label}=<title>`,
      );
    }
    titles.push(link.title);
  }
  return titles;
}

export async function runDiff(
  topic: string,
  wikiUrls: string[],
  depth?: string,
  options?: DiffOptions,
): Promise<DiffResult> {
  console.log(`Diffing "${topic}" across ${wikiUrls.length} wikis...\n`);

  const resolvedDepth = depth ?? "detailed";

  const labels =
    wikiUrls.length <= 26 ? wikiUrls.map((_, i) => String.fromCharCode(65 + i)) : wikiUrls.map((_, i) => `W${i + 1}`);

  const titles = await resolveDiffTitles(topic, wikiUrls, options);
  for (let i = 0; i < wikiUrls.length; i++) {
    const titleNote = titles[i] === topic ? "" : ` as "${titles[i]}"`;
    console.log(`Analyzing wiki ${labels[i]}: ${wikiUrls[i]}${titleNote}`);
  }

  const results = await Promise.all(wikiUrls.map((url, i) => buildSummary(titles[i], url, resolvedDepth)));
  const summaries = results.map((r) => r.summary);
  const allEvents = results.map((r) => r.events);
  const latestContents = results.map((r) => r.latestContent);

  let pairwiseBorrowing: PairwiseTextBorrowing[] | undefined;
  if (options?.detectBorrowing && wikiUrls.length >= 2) {
    pairwiseBorrowing = [];
    for (let i = 0; i < wikiUrls.length; i++) {
      for (let j = i + 1; j < wikiUrls.length; j++) {
        const prop = detectTextPropagation(latestContents[i], latestContents[j]);
        pairwiseBorrowing.push({
          sourceWikiIndex: i,
          sourceWikiLabel: labels[i],
          targetWikiIndex: j,
          targetWikiLabel: labels[j],
          propagation: prop,
        });
      }
    }
  }

  const result: DiffResult = {
    pageTitle: topic,
    wikis: summaries,
    comparison: {
      eventTypeDiffs: buildEventTypeDiffsMatrix(summaries.map((s) => s.eventCounts)),
      totalEvents: allEvents.map((e) => e.length),
      totalSections: summaries.map((s) => s.sections.length),
      citedDomains: buildCitedDomains(summaries),
      sharedIdentifiers: buildSharedIdentifiers(summaries),
      sourceTypes: buildSourceTypeComparison(summaries),
    },
    outliers: detectOutliers(summaries, labels),
    pairwiseBorrowing,
    generatedAt: new Date().toISOString(),
  };

  return result;
}

async function buildSummary(
  topic: string,
  apiUrl: string,
  depth: string,
): Promise<{ summary: WikiSummary; events: EvidenceEvent[]; latestContent: string }> {
  const { events, revisions } = await runAnalyze(topic, depth, undefined, undefined, undefined, false, apiUrl);

  const sections = new Set<string>();
  for (const e of events) {
    if (e.section) sections.add(e.section);
  }

  const latestContent = revisions.length > 0 ? revisions[revisions.length - 1].content : "";

  const eventCounts: Record<string, number> = {};
  let citationCount = 0;
  let templateCount = 0;
  let revertCount = 0;

  for (const e of events) {
    eventCounts[e.eventType] = (eventCounts[e.eventType] ?? 0) + 1;
    if (e.eventType.startsWith("citation_")) citationCount++;
    if (e.eventType.startsWith("template_")) templateCount++;
    if (e.eventType === "revert_detected") revertCount++;
  }

  const citations = citationTracker.extractCitations(latestContent);
  const citationNetwork = analyzeCitationNetwork(citations);

  return {
    summary: {
      url: apiUrl,
      title: topic,
      sections: [...sections],
      eventCounts,
      summary: {
        citations: citationCount,
        templates: templateCount,
        reverts: revertCount,
        categories: extractCategories(latestContent).length,
        wikilinks: extractWikilinks(latestContent).length,
      },
      citationNetwork,
    },
    events,
    latestContent,
  };
}

/** Each domain cited on any wiki, with every wiki's count; references without a URL are left out. */
export function buildCitedDomains(summaries: readonly Pick<WikiSummary, "citationNetwork">[]): CitedDomainRow[] {
  const domains = new Set<string>();
  for (const s of summaries) {
    for (const domain of Object.keys(s.citationNetwork?.domainDistribution ?? {})) {
      if (domain !== "unknown") domains.add(domain);
    }
  }
  const rows = [...domains].map((domain) => ({
    domain,
    counts: summaries.map((s) => s.citationNetwork?.domainDistribution[domain] ?? 0),
  }));
  const total = (row: CitedDomainRow) => row.counts.reduce((a, b) => a + b, 0);
  return rows.sort((a, b) => total(b) - total(a) || (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
}

/** Compare DOIs and ISBNs cited across wikis (e.g., Arabic vs. English Wikipedia). */
export function buildSharedIdentifiers(
  summaries: readonly Pick<WikiSummary, "citationNetwork">[],
): SharedIdentifierRow[] {
  const allDois = new Set<string>();
  const allIsbns = new Set<string>();
  for (const s of summaries) {
    for (const doi of s.citationNetwork?.sharedIdentifiers?.dois ?? []) allDois.add(doi);
    for (const isbn of s.citationNetwork?.sharedIdentifiers?.isbns ?? []) allIsbns.add(isbn);
  }
  const rows: SharedIdentifierRow[] = [];
  for (const doi of allDois) {
    const presentOnWikis = summaries.map((s) => (s.citationNetwork?.sharedIdentifiers?.dois ?? []).includes(doi));
    rows.push({
      kind: "doi",
      identifier: doi,
      presentOnWikis,
      sharedCount: presentOnWikis.filter(Boolean).length,
    });
  }
  for (const isbn of allIsbns) {
    const presentOnWikis = summaries.map((s) => (s.citationNetwork?.sharedIdentifiers?.isbns ?? []).includes(isbn));
    rows.push({
      kind: "isbn",
      identifier: isbn,
      presentOnWikis,
      sharedCount: presentOnWikis.filter(Boolean).length,
    });
  }
  return rows.sort((a, b) => b.sharedCount - a.sharedCount || a.identifier.localeCompare(b.identifier));
}

/** Compare structural source type counts across wikis. */
export function buildSourceTypeComparison(
  summaries: readonly Pick<WikiSummary, "citationNetwork">[],
): SourceTypeComparisonRow[] {
  const types = new Set<string>();
  for (const s of summaries) {
    for (const t of Object.keys(s.citationNetwork?.sourceTypeDistribution ?? {})) {
      types.add(t);
    }
  }
  return [...types]
    .map((sourceType) => ({
      sourceType,
      counts: summaries.map(
        (s) => (s.citationNetwork?.sourceTypeDistribution as Record<string, number> | undefined)?.[sourceType] ?? 0,
      ),
    }))
    .sort((a, b) => {
      const sumA = a.counts.reduce((x, y) => x + y, 0);
      const sumB = b.counts.reduce((x, y) => x + y, 0);
      return sumB - sumA || a.sourceType.localeCompare(b.sourceType);
    });
}

function buildEventTypeDiffsMatrix(allCounts: Record<string, number>[]): EventTypeDiff[] {
  const allTypes = new Set<string>();
  for (const counts of allCounts) {
    for (const key of Object.keys(counts)) {
      allTypes.add(key);
    }
  }

  const baseline = allCounts[0];
  const withSortKey = [...allTypes].map((eventType) => {
    const counts = allCounts.map((c) => c[eventType] ?? 0);
    const diffs = counts.map((c) => c - (baseline[eventType] ?? 0));
    const maxAbs = Math.max(...diffs.map(Math.abs));
    return { eventType, counts, diffs, maxAbs };
  });
  withSortKey.sort((a, b) => b.maxAbs - a.maxAbs);
  return withSortKey.map(({ eventType, counts, diffs }) => ({ eventType, counts, diffs }));
}

function detectOutliers(summaries: WikiSummary[], labels: string[]): OutlierEntry[] {
  const allTypes = new Set<string>();
  for (const s of summaries) {
    for (const key of Object.keys(s.eventCounts)) {
      allTypes.add(key);
    }
  }

  const outliers: OutlierEntry[] = [];
  for (const eventType of allTypes) {
    const values = summaries.map((s) => s.eventCounts[eventType] ?? 0);
    const n = values.length;
    if (n < 3) continue;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) continue;

    for (let i = 0; i < n; i++) {
      const zScore = (values[i] - mean) / stdDev;
      if (Math.abs(zScore) > 2) {
        outliers.push({
          wikiIndex: i,
          wikiLabel: labels[i],
          eventType,
          count: values[i],
          mean: Math.round(mean * 100) / 100,
          stdDev: Math.round(stdDev * 100) / 100,
          zScore: Math.round(zScore * 100) / 100,
        });
      }
    }
  }

  return outliers.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}
