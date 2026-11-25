import type { DiffResult, EvidenceEvent, Revision } from "@refract-org/evidence-graph";
import type { ProtectionLevel, ProtectionReasonCategory } from "./protection-log.js";

/**
 * Source-agnostic interface for knowledge repositories.
 * Implement this to add support for non-MediaWiki sources
 * (GitHub, Fandom, etc.).
 */
export interface KnowledgeSource {
  /** Unique identifier for this source (e.g., "mediawiki", "github") */
  readonly sourceId: string;

  /** Human-readable name */
  readonly sourceName: string;

  /** Fetch entity histories from this source */
  fetchEntities(query: SourceQuery): Promise<SourceEntity[]>;

  /** Fetch revision history for a specific entity */
  fetchRevisions(entityId: string, options?: RevisionOptions): Promise<Revision[]>;

  /** Fetch diff between two revisions (if supported) */
  fetchDiff?(fromRevId: number, toRevId: number): Promise<DiffResult>;
}

export interface SourceQuery {
  /** Search term or entity identifier */
  query: string;
  /** Maximum results to return */
  limit?: number;
  /** Filter by entity type */
  type?: string;
  /** Time range filter */
  start?: Date;
  end?: Date;
}

export interface SourceEntity {
  /** Source-specific entity ID */
  entityId: string;
  /** Human-readable title/name */
  title: string;
  /** Source type (e.g., "page", "trial", "paper", "commit") */
  type: string;
  /** When this entity was last modified */
  lastModified?: Date;
  /** Source-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Adapter that normalizes a third-party source into Refract's event model.
 * Implement this to make a new source emit EvidenceEvents.
 */
export interface SourceAdapter extends KnowledgeSource {
  /** Normalize fetched data into EvidenceEvents */
  toEvents(entities: SourceEntity[], revisions: Revision[]): Promise<EvidenceEvent[]>;
}

export interface AuthConfig {
  apiKey?: string;
  apiUser?: string;
  apiPassword?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

export interface RevisionFetcher {
  fetchRevisions(pageTitle: string, options?: RevisionOptions): Promise<Revision[]>;
}

export interface RevisionSource {
  revisions(pageTitle: string, options?: RevisionOptions): AsyncIterable<Revision>;
}

export interface DiffFetcher {
  fetchDiff(fromRevId: number, toRevId: number): Promise<DiffResult>;
}

export interface MoveFetcher {
  fetchPageMoves(pageTitle: string): Promise<PageMove[]>;
}

export interface ProtectionLogEvent {
  logId: number;
  pageTitle: string;
  timestamp: string;
  comment: string;
  /** "move_prot": the protection moved with the page to its new title. */
  action: "protect" | "unprotect" | "modify" | "move_prot";
  /**
   * The edit protection the entry set (the create protection for a page
   * protected from being created), from the entry's details, or else from the
   * `[edit=…]` list older entries carry in their description or comment.
   * Absent for an unprotection, a move-only protection, or a level not
   * recognized. See `ProtectionLevel`.
   */
  level?: ProtectionLevel;
  /**
   * What kind of reason the administrator wrote, from the policy the comment
   * links or else its wording. A category of the comment, not a finding about
   * the page. See `ProtectionReasonCategory`.
   */
  reasonCategory: ProtectionReasonCategory;
}

export interface PageMove {
  oldTitle: string;
  newTitle: string;
  timestamp: string;
  revId: number;
  comment: string;
}

export interface RevisionOptions {
  limit?: number;
  start?: Date;
  end?: Date;
  direction?: "newer" | "older";
  startRevId?: number;
  endRevId?: number;
}

export { GitRevisionSource, type GitRevisionSourceOptions } from "./git-source.js";
export {
  computeFullHistoryTelemetry,
  DEFAULT_USER_AGENT,
  type ExternalLinkUsage,
  type FullHistoryTelemetry,
  findRevertedStates,
  type LanguageLink,
  type LongitudinalCoverage,
  type LongitudinalHistoryOptions,
  type LongitudinalHistoryResult,
  MediaWikiApiError,
  MediaWikiClient,
  type MonthlyVelocityBucket,
  type ResolvedTitle,
  type RevertedStateOptions,
  type RevisionAtResult,
  type RevisionMetadata,
  retryAfterMs,
  type SelectLongitudinalOptions,
  type SiteInfo,
  selectLongitudinalRevisions,
  type YearlyPressure,
  type YearlyPressureInput,
  yearlyPressure,
} from "./mediawiki-client.js";
export type { ProtectionLevel, ProtectionReasonCategory } from "./protection-log.js";
export { RateLimiter } from "./rate-limiter.js";
export { SnapshotDirectorySource, type SnapshotItem } from "./snapshot-source.js";
export type { StreamClientOptions, StreamEvent } from "./stream-client.js";
export { WikimediaStreamClient } from "./stream-client.js";
export { WaybackRevisionSource, type WaybackSourceOptions } from "./wayback-source.js";
export type {
  PageToEntityMap,
  WikidataClaim,
  WikidataEntity,
  WikidataStatementChange,
  WikidataStatementHistory,
  WikidataStatementRecord,
  WikidataStatementTransition,
  WikidataValue,
} from "./wikidata-mapper.js";
export {
  diffWikidataStatements,
  fetchWikidataEntity,
  fetchWikidataId,
  mapPagesToEntities,
  mapPageToEntity,
  parseWikidataEntity,
  wikidataEntityToEvents,
  wikidataStatementHistory,
} from "./wikidata-mapper.js";
export { XmlDumpRevisionSource } from "./xml-dump-source.js";
