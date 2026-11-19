// Drift observation records — milestone M-CDME-1 (#14+#5) and M-CD-1 (#12).
//
// These are additive observation records. They describe public revision history.
// They do not score institutions, attribute intent, or predict future edits.
// Interpretation (scoring, attribution, recommendations) belongs downstream.

/** A rolling window summary of constitutional-drift signals for a page. */
export interface ConstitutionalDriftWindow {
  type: "constitutional_drift_window";
  page: string;
  windowStart: string; // ISO-8601
  windowEnd: string; // ISO-8601
  revisionStart: number;
  revisionEnd: number;
  signals: {
    protectedEditShare: number;
    proceduralDepth: number;
    ruleMigrationCount: number;
    revertAsymmetry: number | null;
    botShareTrend: number;
  };
  ruleChangeEventIds: string[];
  sourceRevisions: number[];
}

/** A per-passage trace of minority-evidence survival. */
export interface MinorityEvidenceTrace {
  type: "minority_evidence_trace";
  passageId: string; // claim identity
  page: string;
  firstSeenRevision: number;
  firstSeenDate: string; // ISO-8601
  lastSeenRevision: number | null;
  removedRevision: number | null;
  survivalDays: number | null;
  reverted: boolean;
  revertRevision: number | null;
  reverterRightsLevel: string | null;
  citationDomains: string[];
  citationDiversityDelta: number;
  consensusSmoothingDetected: boolean;
  reintroductionCount: number;
  sourceRevisions: number[];
}

/** A change to a governing artifact that alters future edit permissions. */
export interface RuleChangeEvent {
  type: "rule_change_event";
  id: string;
  page: string;
  revision: number;
  date: string; // ISO-8601
  kind: "namespace_migration" | "protection_change" | "template_change" | "bot_config_change";
  from: string | null;
  to: string | null;
  precedingMinorityTraceIds: string[];
  followingMinorityTraceIds: string[];
}

/** Terminal state of an objection trajectory. */
export type ObjectionTerminalState = "resolved_substantive" | "reclassified" | "absorbed" | "abandoned" | "open";

/** A per-objection trace of categorization drift. */
export interface ObjectionTrace {
  type: "objection_trace";
  objectionId: string; // claim identity
  page: string;
  venue: string;
  filedRevision: number;
  filedDate: string; // ISO-8601
  terminalRevision: number | null;
  terminalState: ObjectionTerminalState;
  reclassificationRevision: number | null;
  reclassificationKind: string | null;
  substantiveResponsePresent: boolean;
  driftFlag: boolean;
  structuralMarkers: string[];
  operationalMarkers: string[];
  sourceRevisions: number[];
}

/** A rolling window summary of categorization-drift signals for a venue. */
export interface DriftWindow {
  type: "categorization_drift_window";
  venue: string;
  windowStart: string; // ISO-8601
  windowEnd: string; // ISO-8601
  objectionsFiled: number;
  objectionsResolvedSubstantive: number;
  objectionsReclassified: number;
  driftRate: number;
  driftRateByRightsLevel: Record<string, number> | null;
  sourceRevisions: number[];
}

/** Union of all drift observation record types. */
export type DriftRecord =
  | ConstitutionalDriftWindow
  | MinorityEvidenceTrace
  | RuleChangeEvent
  | ObjectionTrace
  | DriftWindow;
