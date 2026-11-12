import type { Revision, Section, SectionChange } from "@refract-org/evidence-graph";

export interface SectionDiffer {
  extractSections(wikitext: string): Section[];
  diffSections(
    before: Section[],
    after: Section[],
    options?: { renameDetection?: "exact" | "similarity" | "none"; similarityThreshold?: number },
  ): SectionChange[];
}

export interface CitationTracker {
  extractCitations(wikitext: string): CitationRef[];
  diffCitations(before: CitationRef[], after: CitationRef[]): CitationChange[];
}

export interface CitationRef {
  url?: string;
  title?: string;
  refName?: string;
  raw: string;
}

export interface CitationChange {
  type: "added" | "removed" | "replaced" | "unchanged";
  before?: CitationRef;
  after?: CitationRef;
}

export interface RevertDetector {
  isRevert(comment: string, options?: { patterns?: RegExp[] }): boolean;
  detectRevertChain(revisions: Revision[], options?: { patterns?: RegExp[] }): RevertChain[];
}

export interface RevertChain {
  startRevisionId: number;
  endRevisionId: number;
  revertedToRevisionId: number;
  participants: number;
}

export interface TemplateTracker {
  extractTemplates(wikitext: string): Template[];
  diffTemplates(before: Template[], after: Template[]): TemplateChange[];
}

export interface Template {
  name: string; // e.g., "Citation needed", "NPOV", "BLP"
  type: TemplateType;
  params?: Record<string, string>;
}

export type TemplateType = "citation" | "neutrality" | "blp" | "dispute" | "cleanup" | "protection" | "other";

export interface TemplateChange {
  type: "added" | "removed" | "unchanged";
  template: Template;
}

export type { RegisteredAnalyzer } from "./analyzer-registry.js";
export { AnalyzerRegistry, registry } from "./analyzer-registry.js";
export { buildCategoryEvents, diffCategories, extractCategories } from "./category-tracker.js";
export {
  analyzeCitationNetwork,
  buildSourceId,
  buildSourceLineage,
  type CitationNetworkAnalysis,
  citationTracker,
} from "./citation-tracker.js";
export type { EditClusterOptions } from "./edit-cluster-detector.js";
export { detectEditClusters } from "./edit-cluster-detector.js";
export type { HeuristicKind, HeuristicOptions, UserMetadata } from "./heuristic-classifier.js";
export { classifyHeuristic } from "./heuristic-classifier.js";
export type { ObservationDiff } from "./observation-differ.js";
export { diffObservations } from "./observation-differ.js";
export { buildPageMoveEvents, windowPageMoves } from "./page-move-detector.js";
export type {
  PropagationOptions,
  TextBorrowingSpan,
  TextPropagationResult,
} from "./propagation-detector.js";
export { detectTextPropagation } from "./propagation-detector.js";
export type { ProtectionChange, ProtectionLogRecord, ProtectionTracker } from "./protection-tracker.js";
export { protectionTracker } from "./protection-tracker.js";
export { revertDetector } from "./revert-detector.js";
export type { ParsedContent, RevisionEventDepth, RevisionEventOptions } from "./revision-events.js";
export {
  annotateEvents,
  buildRevisionEvents,
  computeStructuralDiffs,
  detectEditorialSignals,
  parseContent,
} from "./revision-events.js";
export type { SectionEvent, SectionLineage } from "./section-differ.js";
export { buildSectionLineage, sectionDiffer } from "./section-differ.js";
export type { SemanticEnrichmentResult } from "./semantic-enrichment.js";
export {
  buildSemanticEnrichmentProvenance,
  computeCertaintyProfile,
  computeContentChange,
  computeDirectionSignal,
  computeEditMagnitude,
  computeSourceSnapshotHash,
  enrichEvidenceEvent,
  extractKeyTerms,
  extractQuantitativeFindings,
} from "./semantic-enrichment.js";
export type { TalkActivityOptions, TalkActivityResult } from "./talk-activity-detector.js";
export { detectTalkActivitySpikes } from "./talk-activity-detector.js";
export type { TalkCorrelationOptions } from "./talk-correlator.js";
export { correlateTalkRevisions } from "./talk-correlator.js";
export type { TalkReply, TalkThread, TalkThreadChange } from "./talk-section-parser.js";
export { buildTalkThreadEvents, diffTalkThreads, parseTalkThreads } from "./talk-section-parser.js";
export type { ParamChange } from "./template-tracker.js";
export { buildParamChangeEvents, diffTemplateParams, templateTracker } from "./template-tracker.js";
export { buildWikilinkEvents, diffWikilinks, extractWikilinks } from "./wikilink-extractor.js";
export type { HeadingPosition } from "./wikitext-parser.js";
export {
  buildSectionCharMap,
  countCitations,
  countKeywordMentions,
  deriveSectionHeading,
  extractAnchorSnippet,
  extractHeadingMap,
  findSectionForText,
  sanitizeWikitext,
  stripWikitext,
} from "./wikitext-parser.js";
