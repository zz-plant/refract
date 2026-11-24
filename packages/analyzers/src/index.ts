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
  /**
   * The revision whose text the chain's first revert put back: found by
   * identical text, or named by a "restored revision N" summary. Absent when
   * neither says, as when a rollback summary names only an editor.
   */
  revertedToRevisionId?: number;
  /** The revision an "Undid revision N" summary names as taken away. */
  undoneRevisionId?: number;
  /** How many reverting revisions the chain holds. */
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

// Defined in evidence-graph so ingestion can use it too; re-exported here, where it was first published.
export { redactEditorIdentity } from "@refract-org/evidence-graph";
export type { RegisteredAnalyzer } from "./analyzer-registry.js";
export { AnalyzerRegistry, registry } from "./analyzer-registry.js";
export type {
  DriftRateInput,
  MarkerDetectionResult,
  ObjectionClassification,
  TerminalState,
  TerminalStateInput,
} from "./categorization-drift.js";
export {
  classifyObjection,
  classifyTerminalState,
  computeDriftRate,
  detectMarkers,
  detectOperationalMarkers,
  detectStructuralMarkers,
  isDriftTerminal,
  OPERATIONAL_MARKERS,
  STRUCTURAL_MARKERS,
} from "./categorization-drift.js";
export { buildCategoryEvents, diffCategories, extractCategories } from "./category-tracker.js";
export {
  analyzeCitationNetwork,
  buildSourceId,
  buildSourceLineage,
  type CitationAnchors,
  type CitationNetworkAnalysis,
  citationDomain,
  citationKey,
  citationTracker,
  classifyCitationAuthority,
  classifyCitationSource,
  countCitations,
  countCitationsByKind,
  extractCitationAnchors,
  extractCitationIdentifiers,
  matchShortFootnotes,
  normalizeAnchor,
} from "./citation-tracker.js";
export type {
  ClaimHistoryOptions,
  ClaimHistoryResult,
  ClaimHistoryVariant,
  ClaimTransition,
  LocatedTransition,
  TransitionLocator,
} from "./claim-history.js";
export { claimHistory, findPassageMatch, locateTransitions, nearestPassage } from "./claim-history.js";
export type {
  ConstitutionalDriftInput,
  ConstitutionalDriftResult,
  RevisionMetadata,
} from "./constitutional-drift.js";
export {
  computeBotShare,
  computeConstitutionalDriftWindow,
  computeProtectedEditShare,
  computeRevertAsymmetry,
  isBot,
  isBotByHeuristic,
  rightsLevel,
} from "./constitutional-drift.js";
export type { EditClusterOptions } from "./edit-cluster-detector.js";
export { detectEditClusters } from "./edit-cluster-detector.js";
export type { HeuristicKind, HeuristicOptions, UserMetadata } from "./heuristic-classifier.js";
export { classifyHeuristic } from "./heuristic-classifier.js";
export type { BatchFetcher, LocateChangeOptions, LocatedChange } from "./locate-change.js";
export { locateChange } from "./locate-change.js";
export type { ObservationDiff } from "./observation-differ.js";
export { diffObservations } from "./observation-differ.js";
export {
  buildPageMoveEvents,
  mergePageMoves,
  type PageMoveRecord,
  pageMovesFromEditSummaries,
  windowPageMoves,
} from "./page-move-detector.js";
export type {
  PropagationOptions,
  TextBorrowingSpan,
  TextPropagationResult,
} from "./propagation-detector.js";
export { detectTextPropagation } from "./propagation-detector.js";
export type { ProtectionChange, ProtectionLogRecord, ProtectionTracker } from "./protection-tracker.js";
export { protectionTracker } from "./protection-tracker.js";
export { findIdentityReverts, revertDetector } from "./revert-detector.js";
export type { ParsedContent, RevisionEventDepth, RevisionEventOptions } from "./revision-events.js";
export {
  annotateActorCohorts,
  annotateEvents,
  buildActorSessionPseudonyms,
  buildRevisionEvents,
  computeStructuralDiffs,
  detectEditorialSignals,
  parseContent,
  wordOverlapRatio,
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
export type {
  DatedSnapshot,
  SnapshotAtOptions,
  SnapshotFetchers,
  SnapshotRevision,
  SnapshotScope,
} from "./snapshot-at.js";
export { snapshotAt } from "./snapshot-at.js";
export type { TalkActivityOptions, TalkActivityResult } from "./talk-activity-detector.js";
export { detectTalkActivitySpikes } from "./talk-activity-detector.js";
export type { TalkCorrelationOptions } from "./talk-correlator.js";
export { correlateTalkRevisions } from "./talk-correlator.js";
export type { TalkReply, TalkThread, TalkThreadChange } from "./talk-section-parser.js";
export { buildTalkThreadEvents, diffTalkThreads, parseTalkThreads } from "./talk-section-parser.js";
export type { ParamChange } from "./template-tracker.js";
export { buildParamChangeEvents, diffTemplateParams, templateTracker } from "./template-tracker.js";
export { buildWikilinkEvents, diffWikilinks, extractWikilinks } from "./wikilink-extractor.js";
export type { HeadingPosition, StrippedSection } from "./wikitext-parser.js";
export {
  buildSectionCharMap,
  countKeywordMentions,
  deriveSectionHeading,
  extractAnchorSnippet,
  extractHeadingMap,
  findSectionForText,
  sanitizeWikitext,
  stripLead,
  stripSection,
  stripWikitext,
  stripWikitextSections,
} from "./wikitext-parser.js";
export type { DefinitionOptions, WordingLanguage } from "./wording.js";
export {
  contentWords,
  DEFINITION_COPULAS,
  definitionalSentence,
  definitionHead,
  sameWording,
} from "./wording.js";
