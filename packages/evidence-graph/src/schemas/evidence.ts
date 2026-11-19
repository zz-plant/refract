// Evidence event — what happened at a revision boundary

/** Current event schema version. Bump when EventType gains or loses members. */
export const EVENT_SCHEMA_VERSION = "0.5.0";

export type EvidenceLayer = "observed" | "policy_coded" | "model_interpretation" | "speculative" | "unknown";

export type EventType =
  | "sentence_first_seen"
  | "sentence_removed"
  | "sentence_modified"
  | "sentence_reintroduced"
  | "citation_added"
  | "citation_removed"
  | "citation_replaced"
  | "template_added"
  | "template_removed"
  | "revert_detected"
  | "section_reorganized"
  | "lead_promotion"
  | "lead_demotion"
  | "page_moved"
  | "wikilink_added"
  | "wikilink_removed"
  | "category_added"
  | "category_removed"
  | "protection_changed"
  | "talk_page_correlated"
  | "talk_thread_opened"
  | "talk_thread_archived"
  | "talk_reply_added"
  | "template_parameter_changed"
  | "edit_cluster_detected"
  | "talk_activity_spike";

export interface FactProvenance {
  analyzer: string;
  version: string;
  inputHashes: string[];
  parameters?: Record<string, string | number | boolean>;
  /** Reserved for future use. */
  merkleRoot?: string;
  /** Reserved for future use. */
  parameterFootprint?: Record<string, unknown>;
  /** Reserved for future use. */
  sourceSnapshotHash?: string;
  /** Reserved for future use. */
  effectiveAt?: string;
  /** Reserved for future use. */
  sourceSpan?: string;
}

export type PolicyDimension =
  | "verifiability"
  | "npov"
  | "blp"
  | "due_weight"
  | "protection"
  | "edit_warring"
  | "notability"
  | "copyright"
  | "civility";

export interface DeterministicFact {
  fact: string;
  detail?: string;
  provenance?: FactProvenance;
  /** Document range reference pointer. */
  sourceSpan?: string;
}

export interface ModelInterpretation {
  semanticChange: string;
  confidence: number;
  policyDimension?: PolicyDimension;
  discussionType?:
    | "notability_challenge"
    | "sourcing_dispute"
    | "neutrality_concern"
    | "content_deletion"
    | "content_addition"
    | "naming_dispute"
    | "procedural"
    | "other";
}

/** Deterministic edit magnitude — character count thresholds */
export type EditMagnitude = "minor" | "moderate" | "major";

/** Deterministic content change classification */
export type ContentChange = "introduction" | "removal" | "expansion" | "compression" | "refinement" | "rewrite";

/** Deterministic certainty profile — counts of certainty/hedging markers */
export interface CertaintyProfile {
  high: number;
  medium: number;
  low: number;
  hedging: number;
}

/** Deterministic direction signal — computed from certainty shift */
export type DirectionSignal = "strengthening" | "weakening" | "neutral";

/** A quantitative finding extracted from edit text */
export interface QuantitativeFinding {
  type: string;
  value: string;
  raw: string;
  /** Document range reference pointer. */
  sourceSpan?: string;
}

/**
 * Privacy-preserving actor cohort summary for an analysis run or revision cluster.
 * Uses ephemeral run-scoped pseudonymous actor labels (e.g., Actor_1, Actor_2)
 * without exposing raw usernames or enabling cross-wiki tracking.
 */
export interface ActorCohortSummary {
  /** Ephemeral run-scoped pseudonymous actor label for the target revision (e.g., "Actor_1") */
  actorPseudonym?: string;
  /** Distinct pseudonymous actors observed in the event or cluster */
  distinctActors?: number;
  /** Whether all edits in the cluster or revert pair were made by a single actor */
  singleActor?: boolean;
  /** Ephemeral pseudonymous actor label of the prior revision in a revert pair */
  revertedActorPseudonym?: string;
}

/**
 * User-supplied external context marker (e.g., report publication, policy change,
 * arbitration milestone) for overlaying temporal context on revision timelines
 * without claiming algorithmic causation.
 */
export interface ExternalTimelineMarker {
  id?: string;
  timestamp: string; // ISO 8601
  label: string;
  category?: "report" | "policy" | "arbitration" | "media" | "external";
  url?: string;
}

export interface EvidenceEvent {
  schemaVersion?: string; // EVENT_SCHEMA_VERSION at time of generation
  eventId?: string; // deterministic content hash (see below)
  eventType: EventType; // discriminator
  claimId?: string; // claim identity hash, when applicable
  fromRevisionId: number; // parent revision
  toRevisionId: number; // source revision
  section: string; // section title where change occurred
  before: string; // text / state before the change
  after: string; // text / state after the change
  deterministicFacts: DeterministicFact[]; // facts backing this event
  modelInterpretation?: ModelInterpretation; // set by downstream consumers
  // Deterministic semantic enrichment (refract v0.5.0+)
  editMagnitude?: EditMagnitude;
  contentChange?: ContentChange;
  keyTerms?: string[];
  certaintyProfile?: CertaintyProfile;
  directionSignal?: DirectionSignal;
  quantitativeFindings?: QuantitativeFinding[];
  actorCohort?: ActorCohortSummary;
  layer: EvidenceLayer; // provenance layer
  timestamp: string; // ISO 8601
}

/**
 * Represents the state of a document at a specific point in time,
 * reconstructed from its event history.
 */
export interface DocumentSnapshot {
  /** The page/document identifier */
  entityId: string;
  /** The timestamp this snapshot represents */
  asOf: string;
  /** The revision ID this snapshot is based on */
  revisionId: number;
  /** Sections present at this point in time */
  sections: Array<{
    heading: string;
    level: number;
    content?: string;
  }>;
  /** Citations present at this point in time */
  citations: Array<{
    url?: string;
    title?: string;
    raw: string;
  }>;
  /** Templates present at this point in time */
  templates: Array<{
    name: string;
    type: string;
  }>;
  /** Categories at this point in time */
  categories: string[];
  /** Wikilinks at this point in time */
  wikilinks: string[];
  /** Total byte size at this point in time */
  byteSize?: number;
}

/**
 * A temporal query for reconstructing document state.
 */
export interface TemporalQuery {
  /** Document to query */
  entityId: string;
  /** Reconstruct state at this timestamp */
  asOf: string;
  /** Or at this specific revision ID */
  revisionId?: number;
  /** What to include in the snapshot */
  include?: Array<"sections" | "citations" | "templates" | "categories" | "wikilinks" | "size">;
}
