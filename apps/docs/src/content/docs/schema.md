---
title: "Event schema reference"
description: "ModelInterpretation and modelInterpretation on EvidenceEvent are never set by Refract's deterministic pipeline — they exist for downstream consumers to…"
---

## `EventType` — all 26 event types

```typescript
export type EventType =
  // Claim lifecycle
  | "sentence_first_seen"
  | "sentence_removed"
  | "sentence_modified"
  | "sentence_reintroduced"

  // Citation changes
  | "citation_added"
  | "citation_removed"
  | "citation_replaced"

  // Template changes
  | "template_added"
  | "template_removed"
  | "template_parameter_changed"

  // Section & page structure
  | "section_reorganized"
  | "lead_promotion"
  | "lead_demotion"
  | "page_moved"

  // Links & categories
  | "wikilink_added"
  | "wikilink_removed"
  | "category_added"
  | "category_removed"

  // Access control
  | "protection_changed"

  // Content conflict
  | "revert_detected"
  | "edit_cluster_detected"

  // Talk page correlation
  | "talk_page_correlated"
  | "talk_thread_opened"
  | "talk_thread_archived"
  | "talk_reply_added"
  | "talk_activity_spike";
```

## Core interface: `EvidenceEvent`

All events share a common envelope with `before`/`after` snapshots and
deterministic facts. There are no discriminated subtypes — all fields are
optional at the envelope level:

```typescript
export interface EvidenceEvent {
  schemaVersion?: string;                        // EVENT_SCHEMA_VERSION when the event was generated
  eventId?: string;                              // deterministic content hash (see below)
  eventType: EventType;                          // discriminator (serialized as "eventType" in NDJSON)
  claimId?: string;                              // claim identity hash, when applicable
  fromRevisionId: number;                        // parent revision
  toRevisionId: number;                          // source revision
  section: string;                               // section title where change occurred
  before: string;                                // text / state before the change
  after: string;                                 // text / state after the change
  deterministicFacts: DeterministicFact[];       // facts backing this event
  modelInterpretation?: ModelInterpretation;     // set by downstream consumers
  editMagnitude?: EditMagnitude;                 // semantic enrichment, see below
  contentChange?: ContentChange;
  keyTerms?: string[];
  certaintyProfile?: CertaintyProfile;
  directionSignal?: DirectionSignal;
  quantitativeFindings?: QuantitativeFinding[];
  layer: EvidenceLayer;                          // provenance layer
  timestamp: string;                             // ISO 8601
}
```

The CLI and `annotateEvents` set `schemaVersion` and the six enrichment fields on every event. The CLI also sets `eventId`. `claimId` is not set on the events `refract analyze` and `refract export` emit.

## Supporting types

```typescript
export type EvidenceLayer =
  | "observed"              // directly observed from the diff
  | "policy_coded"          // coded against a policy rule
  | "model_interpretation"  // set by downstream consumers
  | "speculative"           // inferred but without a hard rule
  | "unknown";              // layer not yet classified

export interface DeterministicFact {
  fact: string;
  detail?: string;
  provenance?: FactProvenance;
}

export interface FactProvenance {
  analyzer: string;        // analyzer that produced this fact
  version: string;         // analyzer version
  inputHashes: string[];   // hashes of input data used
  parameters?: Record<string, string | number | boolean>;  // parameters used by the analyzer
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

// Semantic enrichment, computed from the before/after text
export type EditMagnitude = "minor" | "moderate" | "major";
export type ContentChange =
  | "introduction" | "removal" | "expansion" | "compression" | "refinement" | "rewrite";
export type DirectionSignal = "strengthening" | "weakening" | "neutral";

export interface CertaintyProfile {
  high: number;
  medium: number;
  low: number;
  hedging: number;
}

export interface QuantitativeFinding {
  type: string;
  value: string;
  raw: string;
}
```

Refract's own events leave `DeterministicFact.provenance` unset: their facts carry `fact` and `detail`. `FactProvenance` is there for a consumer to record the analyzer, version and parameters when it stores events.

`ModelInterpretation` and `modelInterpretation` on `EvidenceEvent` are never set by Refract's deterministic pipeline — they exist for downstream consumers to attach semantic analysis without modifying the deterministic event.

`AnalyzerConfig` is a supporting type exported from `@refract-org/evidence-graph` that defines configurable parameters for analyzers (similarity thresholds, time windows, revert patterns). See the [CLI reference](./cli) for the per-flag equivalents.

## Deterministic identity

`eventId` is derived deterministically from the event content so the same
observation always produces the same ID:

`modelInterpretation` is excluded from the hash so downstream consumers can add it without changing the event's deterministic identity.

```typescript
import { createHash } from "node:crypto";

export function createEventIdentity(
  event: Omit<EvidenceEvent, "eventId" | "modelInterpretation">,
): string {
  const factsStr = event.deterministicFacts
    .map((f) => `${f.fact}:${f.detail ?? ""}`)
    .join("|");
  const identityKey =
    `${event.eventType}|${event.fromRevisionId}|${event.toRevisionId}|` +
    `${event.section}|${event.before}|${event.after}|${event.timestamp}|${factsStr}`;
  return createHash("sha256").update(identityKey).digest("hex").slice(0, 16);
}
```

The hash is truncated to 16 hex characters (64 bits of collision resistance).

## Version compatibility

When consuming Refract events across different package versions, the `schemaVersion` field on each event tells you which schema produced it.

| refract CLI | `@refract-org/evidence-graph` | `EVENT_SCHEMA_VERSION` | Key changes |
|------------|------------------------------|-----------------------|-------------|
| 0.6.1 | 0.5.4 | `"0.5.0"` | No `EventType` changes; `analyze` and `export` emit the cluster, spike and thread events; citation events name their section |
| 0.6.0 | 0.5.3 | `"0.5.0"` | No `EventType` changes |
| 0.5.15–0.5.17 | 0.5.1–0.5.2 | `"0.5.0"` | No `EventType` changes; optional fields only |
| 0.5.0–0.5.7 | 0.4.x–0.5.0 | `"0.4.0"` | `sentence_modified` event type, `FactProvenance.parameters`, `AnalyzerConfig`, `EVENT_SCHEMA_VERSION`, `CLAIM_IDENTITY_VERSION` |
| 0.4.x | 0.3.x | `"0.3.0"` | ClaimLedger, ObservationReport, `--report` flag, cron merging |
| 0.3.x | 0.2.x | `"0.2.0"` | 25 event types, initial public release |

**Negotiation rules:**
- Consumers SHOULD accept events with the same minor schema version (0.5.x today)
- Consumers MAY accept events across minor versions if they handle unknown `EventType` members gracefully (skip unrecognized types, log, preserve)
- Consumers MUST NOT silently drop events with unrecognized event types — log them and preserve the raw data
- When `schemaVersion` is missing, assume the most recent compatible schema for the consuming package version
