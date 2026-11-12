import type { DeterministicFact, EvidenceEvent, EvidenceLayer, Revision, Section } from "@refract-org/evidence-graph";
import { EVENT_SCHEMA_VERSION } from "@refract-org/evidence-graph";
import { diffCategories, extractCategories } from "./category-tracker.js";
import { citationTracker } from "./citation-tracker.js";
import type { CitationRef, Template, TemplateType } from "./index.js";
import type { ProtectionLogRecord } from "./protection-tracker.js";
import { revertDetector } from "./revert-detector.js";
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
import { buildSectionCharMap, findSectionForText, stripWikitext } from "./wikitext-parser.js";

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

function wordOverlapRatio(a: string, b: string): number {
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

/** Diff sections, citations, wikilinks, categories, and lead structure between two revisions. */
export function computeStructuralDiffs(
  before: Revision,
  after: Revision,
  beforeParsed: ParsedContent,
  afterParsed: ParsedContent,
  isBrief: boolean,
  extraFacts: DeterministicFact[],
  sectionOptions?: { renameDetection?: "exact" | "similarity" | "none"; similarityThreshold?: number },
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
      deterministicFacts: [{ fact: "citation_changed", detail: `type=${cit.type}` }, ...extraFacts],
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

  if (isRevRevert) {
    events.push({
      eventType: "revert_detected",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: "",
      before: "",
      after: isBrief ? "" : after.comment,
      deterministicFacts: [
        { fact: "revert_detected", detail: after.comment },
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

  const sentenceSplit = /(?:[.!?]\s+|[。！？؟]\s*)/;
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
  const strippedCache = new Map<number, string>();
  const sectionCharMapCache = new Map<number, Array<{ charOffset: number; section: string }>>();
  const parsedCache = new Map<number, ParsedContent>();

  const getStripped = (rev: Revision): string => {
    const cached = strippedCache.get(rev.revId);
    if (cached !== undefined) return cached;
    const result = stripWikitext(rev.content);
    strippedCache.set(rev.revId, result);
    return result;
  };

  const getSectionCharMap = (rev: Revision): Array<{ charOffset: number; section: string }> => {
    const cached = sectionCharMapCache.get(rev.revId);
    if (cached) return cached;
    const map = buildSectionCharMap(rev.content);
    sectionCharMapCache.set(rev.revId, map);
    return map;
  };

  const getParsed = (rev: Revision): ParsedContent => {
    const cached = parsedCache.get(rev.revId);
    if (cached) return cached;
    const result = parseContent(rev.content);
    parsedCache.set(rev.revId, result);
    return result;
  };

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
      ...computeStructuralDiffs(before, after, beforeParsed, afterParsed, isBrief, pairExtraFacts, {
        renameDetection: options.sectionRename,
        similarityThreshold: options.similarityThreshold,
      }),
      ...detectEditorialSignals(
        before,
        after,
        beforeParsed,
        afterParsed,
        isBrief,
        pairExtraFacts,
        protectionLogs,
        options.revertPatterns,
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
