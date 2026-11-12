# Core Types

## EvidenceEvent

The central output unit — describes what changed at a revision boundary.

```ts
type EvidenceLayer = "observed" | "policy_coded" | "model_interpretation" | "speculative" | "unknown";

type EventType =
  // Sentence lifecycle
  | "sentence_first_seen" | "sentence_removed" | "sentence_modified" | "sentence_reintroduced"
  // Citation changes
  | "citation_added" | "citation_removed" | "citation_replaced"
  // Template changes
  | "template_added" | "template_removed" | "template_parameter_changed"
  // Section & page structure
  | "section_reorganized" | "lead_promotion" | "lead_demotion" | "page_moved"
  // Links & categories
  | "wikilink_added" | "wikilink_removed" | "category_added" | "category_removed"
  // Access control
  | "protection_changed"
  // Content conflict
  | "revert_detected" | "edit_cluster_detected"
  // Talk page correlations
  | "talk_page_correlated" | "talk_thread_opened" | "talk_thread_archived"
  | "talk_reply_added" | "talk_activity_spike";

interface EvidenceEvent {
  eventId?: string;
  eventType: EventType;
  claimId?: string;
  fromRevisionId: number;
  toRevisionId: number;
  section: string;
  before: string;
  after: string;
  deterministicFacts: DeterministicFact[];
  modelInterpretation?: ModelInterpretation;   // Set by downstream consumers, never by Refract
  layer: EvidenceLayer;
  timestamp: string;                             // ISO 8601
}

interface DeterministicFact {
  fact: string;     // e.g., "text_changed", "attribution_added", "same_section"
  detail?: string;
  provenance?: FactProvenance;   // not set by Refract's own events
}

interface FactProvenance {
  analyzer: string;
  version: string;
  inputHashes: string[];
  parameters?: Record<string, string | number | boolean>;
}

interface ModelInterpretation {
  semanticChange: string;    // e.g., "direct accusation changed to attributed institutional finding"
  confidence: number;        // 0.0–1.0
  policyDimension?: PolicyDimension;
  discussionType?: "notability_challenge" | "sourcing_dispute" | "neutrality_concern"
    | "content_deletion" | "content_addition" | "naming_dispute" | "procedural" | "other";
}

type PolicyDimension =
  | "verifiability" | "npov" | "blp" | "due_weight"
  | "protection" | "edit_warring" | "notability" | "copyright" | "civility";
```

## ClaimObject

Tracks a proposition across the revision timeline.

```ts
type PropositionType =
  | "factual_claim" | "attributed_claim" | "institutional_finding"
  | "allegation" | "counterclaim" | "policy_statement" | "editorial_note"
  | "unknown";

type ClaimState =
  | "absent" | "emerging" | "contested" | "softened" | "strengthened"
  | "stabilizing" | "hardened" | "receding" | "deleted" | "reintroduced";

interface ClaimIdentity {
  claimId: string;       // Deterministic hash from identity key
  identityKey: string;   // Canonical claim text + section + page
  pageTitle: string;
  pageId: number;
}

interface ClaimLineage {
  firstSeenRevisionId: number;
  firstSeenAt: string;
  lastSeenRevisionId?: number;
  lastSeenAt?: string;
  variants: ClaimRefractnt[];
  mergeSourceIds?: string[];
  splitTargetIds?: string[];
  deprecatedAt?: string;
  deprecatedByClaimId?: string;
}

interface ClaimObject {
  identity: ClaimIdentity;
  lineage: ClaimLineage;
  currentState: ClaimState;
  propositionType: PropositionType;
  sourceLineage: string[];
  phase: string;   // Phase 0 | Phase 1b | Phase 2a | Phase 2b
}
```

## Report

The assembled output with layer provenance.

```ts
type Depth = "brief" | "detailed" | "forensic";
type ExportFormat = "json" | "pdf" | "csv" | "html" | "ndjson" | "parquet";

interface Report {
  pageTitle: string;
  pageId: number;
  analyzedRevisionRange: { from: number; to: number };
  generatedAt: string;
  depth: Depth;
  layers: ReportLayer[];
  timeline: PageTimeline;
  claims: string[];
  sources: string[];
  policySignals: PolicySignal[];
  caveats: string[];
  phase: string;
}

interface ReportLayer {
  label: ReportLayerLabel;
  description: string;
  events: number;
  reproducible: boolean;
}

interface PageTimeline {
  totalRevisions: number;
  analyzedRevisions: number;
  dateRange: { start: string; end: string };
  events: TimelineEvent[];
}

interface PolicySignal {
  dimension: string;          // e.g., "verifiability", "npov", "blp"
  signal: string;             // e.g., "citation_needed_template_added"
  firstSeenRevisionId: number;
  lastSeenRevisionId?: number;
  active: boolean;
}
```

## Analyzer Interfaces (L1)

```ts
interface SectionDiffer {
  extractSections(wikitext: string): Section[];
  diffSections(before: Section[], after: Section[]): SectionChange[];
}

interface CitationTracker {
  extractCitations(wikitext: string): CitationRef[];
  diffCitations(before: CitationRef[], after: CitationRef[]): CitationChange[];
}

interface RevertDetector {
  isRevert(comment: string): boolean;
  detectRevertChain(revisions: Revision[]): RevertChain[];
}

interface TemplateTracker {
  extractTemplates(wikitext: string): Template[];
  diffTemplates(before: Template[], after: Template[]): TemplateChange[];
}
```

## Model interpretation (downstream)

Refract exports no model adapter. A consumer that interprets events with a model
attaches the result as `modelInterpretation` on its own copy of the event; the
field is outside the event hash, so the `eventId` does not change.

The one place Refract itself can call a model is `refract classify` (and the MCP
`classify` tool), which classifies a single input and returns an `InferenceResult`:

```ts
type InferenceBoundary = "revert" | "sentence_similarity" | "heuristic" | "template_signal" | "activity_spike";

interface InferenceResult {
  boundary: InferenceBoundary;
  output: Record<string, unknown>;   // shape depends on the boundary
  confidence?: number;
  source: "model" | "default";
}
```

## Ingestion Interfaces (L1)

```ts
interface RevisionFetcher {
  fetchRevisions(pageTitle: string, options?: RevisionOptions): Promise<Revision[]>;
}

interface Revision {
  revId: number;
  pageId: number;
  pageTitle: string;
  timestamp: string;
  user?: string;   // Editor username (optional, may be hidden)
  comment: string;
  content: string;
  size: number;
  minor: boolean;
}
```
