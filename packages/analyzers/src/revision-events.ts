import type { DeterministicFact, EvidenceEvent, EvidenceLayer, Revision, Section } from "@refract-org/evidence-graph";
import { EVENT_SCHEMA_VERSION } from "@refract-org/evidence-graph";
import { diffCategories, extractCategories } from "./category-tracker.js";
import {
  type CitationAnchors,
  citationDomain,
  citationKey,
  citationTracker,
  extractCitationAnchors,
  normalizeAnchor,
} from "./citation-tracker.js";
import type { CitationChange, CitationRef, Template, TemplateType } from "./index.js";
import type { ProtectionLogRecord } from "./protection-tracker.js";
import { findIdentityReverts, revertDetector } from "./revert-detector.js";
import { sectionDiffer } from "./section-differ.js";
import {
  computeCertaintyProfile,
  computeContentChange,
  computeDirectionSignal,
  computeEditMagnitude,
  extractKeyTerms,
  extractQuantitativeFindings,
} from "./semantic-enrichment.js";
import { buildParamChangeEvents, templateTracker } from "./template-tracker.js";
import { diffWikilinks, extractWikilinks } from "./wikilink-extractor.js";
import { findSectionForText, type StrippedWikitext, stripWikitextWithSections } from "./wikitext-parser.js";

/** What the per-pair diffs read from one revision's wikitext. */
export interface ParsedContent {
  sections: Section[];
  citations: CitationRef[];
  wikilinks: string[];
  categories: string[];
  templates: Template[];
}

/**
 * How much of each change an event carries. `brief` blanks the before and
 * after text of content events; `forensic` adds both revisions' full wikitext
 * as facts on every event of the pair; `detailed` does neither.
 */
export type RevisionEventDepth = "brief" | "detailed" | "forensic";

export interface RevisionEventOptions {
  /** Default `detailed`. */
  depth?: RevisionEventDepth;
  /** Word-overlap ratio at or above which a changed sentence counts as modified rather than removed and added. Default 0.8. */
  similarityThreshold?: number;
  /** The page's protection log. An entry becomes an event on the pair whose span contains it: after the earlier revision, up to and including the later one. */
  protectionLogs?: readonly ProtectionLogRecord[];
  /**
   * How a heading that disappears while another appears is read. `exact`
   * (default) reports one renamed section when the text under it is identical;
   * `similarity` also when its word overlap reaches `similarityThreshold`;
   * `none` reports a removed and an added section.
   */
  sectionRename?: "exact" | "similarity" | "none";
  /** Edit-summary patterns that mark a revision as a revert. Default: the revert detector's built-in patterns. */
  revertPatterns?: RegExp[];
}

function templateTypeToPolicyDimension(type: TemplateType): string | null {
  switch (type) {
    case "citation":
      return "verifiability";
    case "neutrality":
      return "npov";
    case "blp":
      return "blp";
    case "dispute":
      return "due_weight";
    case "protection":
      return "protection";
    default:
      return null;
  }
}

/**
 * The share of distinct whitespace-separated words two sentences have in
 * common, ignoring case: the measure sentence events compare with
 * `similarityThreshold`. Punctuation stays on its word, so "Sun," and "Sun"
 * differ. Two strings with no words give NaN, which no threshold reaches.
 */
export function wordOverlapRatio(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

/** Extract the sections, citations, wikilinks, categories and templates the diffs compare. */
export function parseContent(wikitext: string): ParsedContent {
  return {
    sections: sectionDiffer.extractSections(wikitext),
    citations: citationTracker.extractCitations(wikitext),
    wikilinks: extractWikilinks(wikitext),
    categories: extractCategories(wikitext),
    templates: templateTracker.extractTemplates(wikitext),
  };
}

/**
 * The section whose text contains `raw`: its title, `(lead)` for the lead, and
 * `body` when no section holds it. A reference repeated verbatim in several
 * sections is placed in the first.
 */
function sectionContaining(sections: Section[], raw: string | undefined): string {
  if (!raw) return "body";
  const holder = sections.find((s) => s.content.includes(raw));
  return holder ? holder.title || "(lead)" : "body";
}

/** At most this many anchors are listed on one citation event; a much-reused named reference would list dozens. */
const MAX_ANCHOR_FACTS = 5;

/**
 * What a citation event says about the source and the prose it supports.
 *
 * `citation_source` names the cited URL's domain and the URL. Each
 * `citation_anchor` is a passage the reference follows: in the later revision
 * for an added or replaced reference, in the earlier one for a removed one.
 * On a removed reference, `citation_anchor_status` says how many of those
 * passages are still in the later revision's prose (`kept`) and how many of
 * those no other reference follows any more (`unsourced`): a passage that
 * outlived its citation. Anchor text is left out at brief depth; the counts
 * are not.
 */
function citationFacts(
  cit: CitationChange,
  before: Revision,
  after: Revision,
  getAnchors: (rev: Revision) => CitationAnchors,
  isBrief: boolean,
): DeterministicFact[] {
  const facts: DeterministicFact[] = [];
  const ref = cit.type === "removed" ? cit.before : cit.after;
  if (!ref) return facts;
  const domain = citationDomain(ref.url);
  if (ref.url) facts.push({ fact: "citation_source", detail: `domain=${domain ?? "unknown"} url=${ref.url}` });

  const own = getAnchors(cit.type === "removed" ? before : after);
  const anchors = own.byKey.get(citationKey(ref)) ?? [];
  if (!isBrief) {
    for (const anchor of anchors.slice(0, MAX_ANCHOR_FACTS)) facts.push({ fact: "citation_anchor", detail: anchor });
    if (anchors.length > MAX_ANCHOR_FACTS)
      facts.push({ fact: "citation_anchors_omitted", detail: String(anchors.length - MAX_ANCHOR_FACTS) });
  }

  if (cit.type === "removed") {
    const later = getAnchors(after);
    let kept = 0;
    let unsourced = 0;
    for (const anchor of anchors) {
      const normalized = normalizeAnchor(anchor);
      if (!later.normalizedProse.includes(normalized)) continue;
      kept++;
      if ((later.citationsPerAnchor.get(normalized) ?? 0) === 0) unsourced++;
    }
    facts.push({
      fact: "citation_anchor_status",
      detail: `anchors=${anchors.length} kept=${kept} unsourced=${unsourced}`,
    });
  }
  return facts;
}

/** Diff sections, citations, wikilinks, categories, and lead structure between two revisions. */
export function computeStructuralDiffs(
  before: Revision,
  after: Revision,
  beforeParsed: ParsedContent,
  afterParsed: ParsedContent,
  isBrief: boolean,
  extraFacts: DeterministicFact[],
  sectionOptions?: { renameDetection?: "exact" | "similarity" | "none"; similarityThreshold?: number },
  getAnchors: (rev: Revision) => CitationAnchors = (rev) => extractCitationAnchors(rev.content),
): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];

  const sectionChanges = sectionDiffer.diffSections(beforeParsed.sections, afterParsed.sections, sectionOptions);
  const citationChanges = citationTracker.diffCitations(beforeParsed.citations, afterParsed.citations);
  const wikilinkChanges = diffWikilinks(beforeParsed.wikilinks, afterParsed.wikilinks);
  const categoryChanges = diffCategories(beforeParsed.categories, afterParsed.categories);

  for (const cit of citationChanges) {
    if (cit.type === "unchanged") continue;
    const layer: EvidenceLayer = "observed";
    // Where the reference sits: in the later revision for one added or
    // replaced, in the earlier one for one removed.
    const section =
      cit.type === "removed"
        ? sectionContaining(beforeParsed.sections, cit.before?.raw)
        : sectionContaining(afterParsed.sections, cit.after?.raw);
    events.push({
      eventType:
        cit.type === "added" ? "citation_added" : cit.type === "removed" ? "citation_removed" : "citation_replaced",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section,
      before: isBrief ? "" : (cit.before?.raw ?? ""),
      after: isBrief ? "" : (cit.after?.raw ?? ""),
      deterministicFacts: [
        { fact: "citation_changed", detail: `type=${cit.type}` },
        ...citationFacts(cit, before, after, getAnchors, isBrief),
        ...extraFacts,
      ],
      layer,
      timestamp: after.timestamp,
    });
  }

  for (const link of wikilinkChanges.added) {
    events.push({
      eventType: "wikilink_added",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: "body",
      before: "",
      after: isBrief ? "" : link,
      deterministicFacts: [{ fact: "wikilink_added", detail: `target=${link}` }, ...extraFacts],
      layer: "observed",
      timestamp: after.timestamp,
    });
  }

  for (const link of wikilinkChanges.removed) {
    events.push({
      eventType: "wikilink_removed",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: "body",
      before: isBrief ? "" : link,
      after: "",
      deterministicFacts: [{ fact: "wikilink_removed", detail: `target=${link}` }, ...extraFacts],
      layer: "observed",
      timestamp: after.timestamp,
    });
  }

  for (const cat of categoryChanges.added) {
    events.push({
      eventType: "category_added",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: "",
      before: "",
      after: isBrief ? "" : cat,
      deterministicFacts: [{ fact: "category_added", detail: `category=${cat}` }, ...extraFacts],
      layer: "observed",
      timestamp: after.timestamp,
    });
  }

  for (const cat of categoryChanges.removed) {
    events.push({
      eventType: "category_removed",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: "",
      before: isBrief ? "" : cat,
      after: "",
      deterministicFacts: [{ fact: "category_removed", detail: `category=${cat}` }, ...extraFacts],
      layer: "observed",
      timestamp: after.timestamp,
    });
  }

  for (const sc of sectionChanges) {
    if (sc.changeType === "unchanged") continue;
    events.push({
      eventType: "section_reorganized",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: sc.section,
      before: isBrief ? "" : (sc.fromContent ?? ""),
      after: isBrief ? "" : (sc.toContent ?? ""),
      deterministicFacts: [
        {
          fact: "section_changed",
          detail: sc.fromSection ? `change=${sc.changeType} from=${sc.fromSection}` : `change=${sc.changeType}`,
        },
        ...extraFacts,
      ],
      layer: "observed",
      timestamp: after.timestamp,
    });
  }

  const leadChange = sectionChanges.find((sc) => sc.section === "(lead)" && sc.changeType === "modified");
  if (leadChange) {
    const fromLen = leadChange.fromContent?.length ?? 0;
    const toLen = leadChange.toContent?.length ?? 0;
    const contentMovedOut = fromLen > toLen && toLen < fromLen * 0.5;
    const contentMovedIn = toLen > fromLen && fromLen < toLen * 0.5;

    if (contentMovedOut) {
      const targetSection = sectionChanges.find(
        (sc) => sc.section !== "(lead)" && (sc.changeType === "added" || sc.changeType === "modified"),
      );
      if (targetSection) {
        events.push({
          eventType: "lead_demotion",
          fromRevisionId: before.revId,
          toRevisionId: after.revId,
          section: targetSection.section,
          before: isBrief ? "" : (leadChange.fromContent ?? ""),
          after: isBrief ? "" : (leadChange.toContent ?? ""),
          deterministicFacts: [
            { fact: "lead_content_moved", detail: `from=lead to=${targetSection.section}` },
            ...extraFacts,
          ],
          layer: "observed",
          timestamp: after.timestamp,
        });
      }
    } else if (contentMovedIn) {
      const sourceSection = sectionChanges.find(
        (sc) => sc.section !== "(lead)" && (sc.changeType === "removed" || sc.changeType === "modified"),
      );
      if (sourceSection) {
        events.push({
          eventType: "lead_promotion",
          fromRevisionId: before.revId,
          toRevisionId: after.revId,
          section: sourceSection.section,
          before: isBrief ? "" : (leadChange.fromContent ?? ""),
          after: isBrief ? "" : (leadChange.toContent ?? ""),
          deterministicFacts: [
            { fact: "lead_content_moved", detail: `from=${sourceSection.section} to=lead` },
            ...extraFacts,
          ],
          layer: "observed",
          timestamp: after.timestamp,
        });
      }
    }
  }

  return events;
}

/** Detect reverts, template changes, parameter changes, and protection log events. */
export function detectEditorialSignals(
  before: Revision,
  after: Revision,
  beforeParsed: ParsedContent,
  afterParsed: ParsedContent,
  isBrief: boolean,
  extraFacts: DeterministicFact[],
  protectionLogs: readonly ProtectionLogRecord[] = [],
  revertPatterns?: RegExp[],
  restoredRevisionId?: number,
): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];

  const templateChanges = templateTracker.diffTemplates(beforeParsed.templates, afterParsed.templates);
  const isRevRevert = revertDetector.isRevert(after.comment, revertPatterns ? { patterns: revertPatterns } : undefined);

  for (const tpl of templateChanges) {
    if (tpl.type === "unchanged") continue;

    if (tpl.template.type === "protection") {
      events.push({
        eventType: "protection_changed",
        fromRevisionId: before.revId,
        toRevisionId: after.revId,
        section: "body",
        before: tpl.type === "removed" ? tpl.template.name : "",
        after: tpl.type === "added" ? tpl.template.name : "",
        deterministicFacts: [
          { fact: "protection_changed", detail: `name=${tpl.template.name} type=${tpl.type}` },
          ...extraFacts,
        ],
        layer: "policy_coded",
        timestamp: after.timestamp,
      });
      continue;
    }

    const policyDimension = templateTypeToPolicyDimension(tpl.template.type);
    const layer: EvidenceLayer = policyDimension ? "policy_coded" : "observed";
    events.push({
      eventType: tpl.type === "added" ? "template_added" : "template_removed",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: "body",
      before: "",
      after: isBrief ? "" : tpl.template.name,
      deterministicFacts: [
        { fact: "template_changed", detail: `name=${tpl.template.name} type=${tpl.type}` },
        ...(policyDimension
          ? [
              {
                fact: "policy_signal",
                detail: `dimension=${policyDimension} signal=${tpl.template.name.toLowerCase().replace(/\s+/g, "_")}`,
              },
            ]
          : []),
        ...extraFacts,
      ],
      layer,
      timestamp: after.timestamp,
    });
  }

  const paramChangeEvents = buildParamChangeEvents(
    beforeParsed.templates,
    afterParsed.templates,
    before.revId,
    after.revId,
    after.timestamp,
  );
  events.push(...paramChangeEvents);

  // A revert is found by its edit summary, by its text being identical to an
  // earlier revision's (restoredRevisionId), or both; one event either way,
  // with a fact for each basis that held.
  if (isRevRevert || restoredRevisionId !== undefined) {
    events.push({
      eventType: "revert_detected",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: "",
      before: "",
      after: isBrief ? "" : after.comment,
      deterministicFacts: [
        ...(isRevRevert ? [{ fact: "revert_detected", detail: after.comment }] : []),
        ...(restoredRevisionId !== undefined
          ? [{ fact: "identity_revert", detail: `restores=${restoredRevisionId}` }]
          : []),
        { fact: "policy_signal", detail: "dimension=edit_warring signal=revert_detected" },
        ...extraFacts,
      ],
      layer: "policy_coded",
      timestamp: after.timestamp,
    });
  }

  const fromTs = new Date(before.timestamp).getTime();
  const toTs = new Date(after.timestamp).getTime();
  const protectionLogsInRange = protectionLogs.filter((l) => {
    const ts = new Date(l.timestamp).getTime();
    return ts > fromTs && ts <= toTs;
  });
  for (const log of protectionLogsInRange) {
    events.push({
      eventType: "protection_changed",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: "",
      before: "",
      after: log.action,
      deterministicFacts: [
        { fact: "protection_log_event", detail: `action=${log.action} logId=${log.logId}` },
        ...(log.comment ? [{ fact: "protection_summary", detail: log.comment }] : []),
        ...extraFacts,
      ],
      layer: "policy_coded",
      timestamp: log.timestamp,
    });
  }

  return events;
}

/** Compute sentence-level diffs between two revisions (additions, removals, modifications). */
function diffSentences(
  before: Revision,
  after: Revision,
  getStripped: (rev: Revision) => string,
  getSectionCharMap: (rev: Revision) => Array<{ charOffset: number; section: string }>,
  allSeenSentences: Set<string>,
  similarityThreshold: number,
  isBrief: boolean,
  extraFacts: DeterministicFact[],
): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];

  const beforePlain = getStripped(before);
  const afterPlain = getStripped(after);

  // A blank line ends a paragraph, and stripWikitext leaves one where each
  // heading stood, so a sentence cannot run from one block or section into the
  // next when the first ends without punctuation, as a list or a caption does.
  const sentenceSplit = /(?:[.!?]\s+|[。！？؟]\s*|\n{2,})/;
  const beforeSentences = beforePlain.split(sentenceSplit).filter((s) => s.trim().length > 20);
  const afterSentences = afterPlain.split(sentenceSplit).filter((s) => s.trim().length > 20);

  const beforeSecMap = getSectionCharMap(before);
  const afterSecMap = getSectionCharMap(after);

  const matchedBeforeIndices = new Set<number>();

  for (const sentence of afterSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    let bestMatchIdx = -1;
    let bestRatio = 0;
    let bestBeforeSentence = "";

    for (let i = 0; i < beforeSentences.length; i++) {
      if (matchedBeforeIndices.has(i)) continue;
      const beforeTrimmed = beforeSentences[i].trim();
      if (!beforeTrimmed) continue;
      const ratio = wordOverlapRatio(beforeTrimmed, trimmed);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestMatchIdx = i;
        bestBeforeSentence = beforeTrimmed;
      }
    }

    if (bestMatchIdx >= 0 && bestRatio >= similarityThreshold) {
      matchedBeforeIndices.add(bestMatchIdx);
      if (bestBeforeSentence.toLowerCase().replace(/\s+/g, " ") !== trimmed.toLowerCase().replace(/\s+/g, " ")) {
        const section = findSectionForText(after.content, trimmed, afterPlain, afterSecMap);
        events.push({
          eventType: "sentence_modified",
          fromRevisionId: before.revId,
          toRevisionId: after.revId,
          section,
          before: isBrief ? "" : bestBeforeSentence,
          after: isBrief ? "" : trimmed,
          deterministicFacts: [
            { fact: "sentence_modified", detail: `sentence_length=${trimmed.length}` },
            ...extraFacts,
          ],
          layer: "observed",
          timestamp: after.timestamp,
        });
      }
    } else {
      const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
      const wasSeenBefore = allSeenSentences.has(normalized);
      const section = findSectionForText(after.content, trimmed, afterPlain, afterSecMap);
      events.push({
        eventType: wasSeenBefore ? "sentence_reintroduced" : "sentence_first_seen",
        fromRevisionId: before.revId,
        toRevisionId: after.revId,
        section,
        before: "",
        after: isBrief ? "" : trimmed,
        deterministicFacts: [{ fact: "claim_detected", detail: `sentence_length=${trimmed.length}` }, ...extraFacts],
        layer: "observed",
        timestamp: after.timestamp,
      });
    }
  }

  for (let i = 0; i < beforeSentences.length; i++) {
    if (matchedBeforeIndices.has(i)) continue;
    const trimmed = beforeSentences[i].trim();
    if (!trimmed) continue;
    const section = findSectionForText(before.content, trimmed, beforePlain, beforeSecMap);
    events.push({
      eventType: "sentence_removed",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section,
      before: isBrief ? "" : trimmed,
      after: "",
      deterministicFacts: [{ fact: "sentence_removed", detail: `sentence_length=${trimmed.length}` }, ...extraFacts],
      layer: "observed",
      timestamp: after.timestamp,
    });
  }

  for (const s of afterSentences) {
    const normalized = s.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalized) allSeenSentences.add(normalized);
  }

  return events;
}

/**
 * The events between each consecutive pair of revisions: structural diffs,
 * editorial signals and sentence diffs, the per-pair pipeline `refract analyze`
 * runs. Revisions are ordered by timestamp first; the input is not modified.
 * No network or filesystem access, so it runs wherever the revisions are.
 *
 * The events carry no schemaVersion, enrichment fields or eventId yet: pass
 * them, with any others from the same page, through annotateEvents, and use
 * createEventIdentity from @refract-org/evidence-graph for an id.
 */
export function buildRevisionEvents(
  revisions: readonly Revision[],
  options: RevisionEventOptions = {},
): EvidenceEvent[] {
  const sortedRevs = [...revisions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const isBrief = options.depth === "brief";
  const isForensic = options.depth === "forensic";
  const similarityThreshold = options.similarityThreshold ?? 0.8;
  const protectionLogs = options.protectionLogs ?? [];

  const events: EvidenceEvent[] = [];
  const allSeenSentences = new Set<string>();
  const strippedCache = new Map<number, StrippedWikitext>();
  const parsedCache = new Map<number, ParsedContent>();

  const getStrippedPage = (rev: Revision): StrippedWikitext => {
    const cached = strippedCache.get(rev.revId);
    if (cached) return cached;
    const result = stripWikitextWithSections(rev.content);
    strippedCache.set(rev.revId, result);
    return result;
  };
  const getStripped = (rev: Revision): string => getStrippedPage(rev).text;
  const getSectionCharMap = (rev: Revision) => getStrippedPage(rev).sections;

  const anchorCache = new Map<number, CitationAnchors>();
  const getAnchors = (rev: Revision): CitationAnchors => {
    const cached = anchorCache.get(rev.revId);
    if (cached) return cached;
    const result = extractCitationAnchors(rev.content);
    anchorCache.set(rev.revId, result);
    return result;
  };

  const getParsed = (rev: Revision): ParsedContent => {
    const cached = parsedCache.get(rev.revId);
    if (cached) return cached;
    const result = parseContent(rev.content);
    parsedCache.set(rev.revId, result);
    return result;
  };

  const identityReverts = findIdentityReverts(sortedRevs);

  for (let i = 1; i < sortedRevs.length; i++) {
    const before = sortedRevs[i - 1];
    const after = sortedRevs[i];

    const pairExtraFacts = isForensic
      ? [
          { fact: "full_wikitext_before", detail: before.content },
          { fact: "full_wikitext_after", detail: after.content },
        ]
      : [];

    const beforeParsed = getParsed(before);
    const afterParsed = getParsed(after);

    events.push(
      ...computeStructuralDiffs(
        before,
        after,
        beforeParsed,
        afterParsed,
        isBrief,
        pairExtraFacts,
        {
          renameDetection: options.sectionRename,
          similarityThreshold: options.similarityThreshold,
        },
        getAnchors,
      ),
      ...detectEditorialSignals(
        before,
        after,
        beforeParsed,
        afterParsed,
        isBrief,
        pairExtraFacts,
        protectionLogs,
        options.revertPatterns,
        identityReverts.get(after.revId),
      ),
      ...diffSentences(
        before,
        after,
        getStripped,
        getSectionCharMap,
        allSeenSentences,
        similarityThreshold,
        isBrief,
        pairExtraFacts,
      ),
    );
  }

  return events;
}

/**
 * Stamp each event with the current event schema version and the semantic
 * fields `refract analyze` adds to its output: editMagnitude, contentChange,
 * keyTerms, certaintyProfile, directionSignal and quantitativeFindings.
 * Modifies the events in place and returns the same array.
 */
export function annotateEvents(events: EvidenceEvent[]): EvidenceEvent[] {
  for (const e of events) {
    (e as unknown as Record<string, unknown>).schemaVersion = EVENT_SCHEMA_VERSION;
  }

  for (const event of events) {
    const text = event.after || event.before || "";
    event.editMagnitude = computeEditMagnitude((event.before || "").length, (event.after || "").length);
    event.contentChange = computeContentChange(event.eventType, event.before || "", event.after || "");
    event.keyTerms = extractKeyTerms(text);
    event.certaintyProfile = computeCertaintyProfile(text);
    event.directionSignal = computeDirectionSignal(
      computeCertaintyProfile(event.before || ""),
      computeCertaintyProfile(event.after || ""),
    );
    event.quantitativeFindings = extractQuantitativeFindings(text);
  }

  return events;
}
