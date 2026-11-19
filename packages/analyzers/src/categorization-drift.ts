// Categorization-drift detection (idea #12).
//
// Heuristic, auditable, model-free. Detects structural critiques that get
// reclassified into operational/interpersonal/procedural tickets.
//
// Domain-neutral: operates on text. No healthcare vocabulary.

/** Phrases that signal a structural critique of a rule, policy, or system. */
export const STRUCTURAL_MARKERS: readonly string[] = [
  "contradicts",
  "contradiction",
  "outdated",
  "superseded",
  "should be changed",
  "should be revised",
  "the rule says",
  "the policy says",
  "this is wrong because",
  "governing assumption",
  "underlying assumption",
  "not consistent with",
  "inconsistent with",
  "conflicts with",
  "breaks the",
  "violates the",
  "design flaw",
  "systemic",
  "structural",
  "root cause",
  "fundamental",
];

/** Phrases that signal a redirect to procedure, form, conduct, or venue. */
export const OPERATIONAL_MARKERS: readonly string[] = [
  "please file a bug",
  "wrong venue",
  "not a policy issue",
  "already decided",
  "by design",
  "won't fix",
  "wontfix",
  "out of scope",
  "not in scope",
  "move to",
  "wrong noticeboard",
  "user conduct",
  "conduct issue",
  "personal attack",
  "block",
  "not a bug",
  "works as intended",
  "as designed",
  "please use the",
  "file a ticket",
  "wrong form",
  "procedural",
];

export interface MarkerDetectionResult {
  structuralMarkers: string[];
  operationalMarkers: string[];
}

/** Lowercase, strip punctuation-ish noise, collapse whitespace. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Detect structural markers present in text (case-insensitive substring). */
export function detectStructuralMarkers(text: string): string[] {
  const n = normalize(text);
  const found: string[] = [];
  for (const m of STRUCTURAL_MARKERS) {
    if (n.includes(m)) found.push(m);
  }
  return found;
}

/** Detect operational markers present in text (case-insensitive substring). */
export function detectOperationalMarkers(text: string): string[] {
  const n = normalize(text);
  const found: string[] = [];
  for (const m of OPERATIONAL_MARKERS) {
    if (n.includes(m)) found.push(m);
  }
  return found;
}

export function detectMarkers(text: string): MarkerDetectionResult {
  return {
    structuralMarkers: detectStructuralMarkers(text),
    operationalMarkers: detectOperationalMarkers(text),
  };
}

export interface ObjectionClassification {
  isObjection: boolean;
  structuralMarkers: string[];
  operationalMarkers: string[];
}

/**
 * Classify a passage as an objection: it must contain at least one structural
 * marker. Operational markers present in the same passage are recorded but do
 * not disqualify it (they may appear in the reply, not the filing).
 */
export function classifyObjection(text: string): ObjectionClassification {
  const { structuralMarkers, operationalMarkers } = detectMarkers(text);
  return {
    isObjection: structuralMarkers.length > 0,
    structuralMarkers,
    operationalMarkers,
  };
}

export type TerminalState = "resolved_substantive" | "reclassified" | "absorbed" | "abandoned" | "open";

export interface TerminalStateInput {
  /** The objection's own structural markers. */
  structuralMarkers: string[];
  /** Operational markers present in any reclassification template/heading. */
  reclassificationMarkers: string[];
  /** Whether a reply addressed the substance. */
  substantiveResponsePresent: boolean;
  /** Whether the thread was closed without resolution. */
  closedWithoutResolution: boolean;
  /** Whether the objection's text was removed/absorbed into another. */
  absorbed: boolean;
}

/**
 * Determine the terminal state of an objection trajectory.
 *
 * Precedence:
 *   1. absorbed (text merged into another thread/claim)
 *   2. reclassified (operational markers in a template/heading change)
 *   3. resolved_substantive (substantive response present)
 *   4. abandoned (closed without resolution)
 *   5. open (none of the above)
 */
export function classifyTerminalState(input: TerminalStateInput): TerminalState {
  if (input.absorbed) return "absorbed";
  if (input.reclassificationMarkers.length > 0) return "reclassified";
  if (input.substantiveResponsePresent) return "resolved_substantive";
  if (input.closedWithoutResolution) return "abandoned";
  return "open";
}

/**
 * Whether a terminal state counts as categorization drift: a reclassification
 * or absorption that happened without a substantive response.
 */
export function isDriftTerminal(state: TerminalState, substantiveResponsePresent: boolean): boolean {
  if (state === "reclassified" || state === "absorbed") return !substantiveResponsePresent;
  return false;
}

export interface DriftRateInput {
  filed: number;
  reclassified: number;
  absorbed: number;
  substantive: number;
}

/** Drift rate = (reclassified + absorbed) / filed, or 0 if none filed. */
export function computeDriftRate(input: DriftRateInput): number {
  if (input.filed <= 0) return 0;
  return (input.reclassified + input.absorbed) / input.filed;
}
