// Source record — citation lineage in Wikipedia

export type SourceType =
  | "primary"
  | "secondary"
  | "tertiary"
  | "self_published"
  | "news"
  | "academic"
  | "government"
  | "intergovernmental"
  | "ngo"
  | "unknown";

export type SourceAuthority = "high" | "medium" | "low" | "disputed" | "unrated";

export interface SourceRecord {
  sourceId: string; // Deterministic hash from URL or identifier
  url?: string;
  title?: string;
  sourceType: SourceType;
  authority: SourceAuthority;
  firstSeenRevisionId: number;
  firstSeenAt: string; // ISO 8601
  lastSeenRevisionId?: number;
  lastSeenAt?: string;
  claimsReferencing: string[]; // Claim IDs that cite this source
}

export interface SourceLineage {
  sourceId: string;
  replacements: SourceReplacement[];
}

export interface SourceReplacement {
  replacedById: string;
  atRevisionId: number;
  atTimestamp: string; // ISO 8601
}
