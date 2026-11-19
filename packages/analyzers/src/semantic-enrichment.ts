// Semantic enrichment — deterministic text analysis for evidence events
// No model. No API. Byte-reproducible on every run.

import {
  type CertaintyProfile,
  type ContentChange,
  type DirectionSignal,
  type EditMagnitude,
  EVENT_SCHEMA_VERSION,
  type EvidenceEvent,
  type FactProvenance,
  type QuantitativeFinding,
} from "@refract-org/evidence-graph";
import { buildMerkleRoot, hashLeaf } from "./merkle-tree.js";

const CERTAINTY_PATTERNS = {
  high: [
    /demonstrat\w*/i,
    /prove\w*/i,
    /confirm\w*/i,
    /establish\w*/i,
    /significantly/i,
    /robust/i,
    /definitive/i,
    // Arabic high-certainty / consensus markers
    /(?:يثبت|تثبت|أثبت)/,
    /(?:يؤكد|تؤكد|أكدت)/,
    /(?:إجماع|أجمع)/,
    /(?:مؤكد|قطعاً|خلصت)/,
  ],
  medium: [
    /suggest\w*/i,
    /indicat\w*/i,
    /appear\w*/i,
    /likely/i,
    /consistent with/i,
    /evidence/i,
    // Arabic medium-certainty markers
    /(?:يشير|تشير)/,
    /(?:يرجح|من المرجح)/,
    /(?:دليل|أدلة)/,
    /(?:يبدو|تبدو)/,
  ],
  low: [
    /may /i,
    /might /i,
    /could /i,
    /possibly/i,
    /potentially/i,
    /preliminary/i,
    /limited/i,
    /unclear/i,
    /inconclusive/i,
    // Arabic low-certainty / attribution-hedging markers
    /ربما/,
    /(?:يزعم|تزعم|مزاعم|ادعاء)/,
    /غير واضح/,
    /محتمل/,
  ],
  hedging: [
    /however/i,
    /although/i,
    /despite/i,
    /while/i,
    /nevertheless/i,
    // Arabic hedging / concessive markers
    /ومع ذلك/,
    /(?:على الرغم من|بالرغم من)/,
    /(?:إلا أن|غير أن)/,
    /في حين/,
  ],
};

const QUANTITATIVE_PATTERNS: Array<{ name: string; regex: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  { name: "pvalue", regex: /[pP]\s*[<>=]\s*0?\.\d+/g, extract: (m) => m[0] },
  { name: "hazardRatio", regex: /HR\s*[=:]\s*\d+\.\d+/gi, extract: (m) => m[0] },
  { name: "nvalue", regex: /[nN]\s*=\s*\d[\d,]*/g, extract: (m) => m[0] },
  { name: "confidenceInterval", regex: /(\d+\.\d+)[–-](\d+\.\d+)/g, extract: (m) => m[0] },
  { name: "percentage", regex: /\d+(?:\.\d+)?%/g, extract: (m) => m[0] },
  {
    name: "count",
    regex: /\b\d{2,}\b\s*(patients|subjects|participants|events|deaths|hospitalizations)/gi,
    extract: (m) => m[0],
  },
];

export function computeCertaintyProfile(text: string): CertaintyProfile {
  let high = 0,
    medium = 0,
    low = 0,
    hedging = 0;
  for (const p of CERTAINTY_PATTERNS.high) high += (text.match(p) || []).length;
  for (const p of CERTAINTY_PATTERNS.medium) medium += (text.match(p) || []).length;
  for (const p of CERTAINTY_PATTERNS.low) low += (text.match(p) || []).length;
  for (const p of CERTAINTY_PATTERNS.hedging) hedging += (text.match(p) || []).length;
  return { high, medium, low, hedging };
}

export function computeDirectionSignal(
  beforeProfile: CertaintyProfile,
  afterProfile: CertaintyProfile,
): DirectionSignal {
  const beforeHigh = beforeProfile.high;
  const afterHigh = afterProfile.high;
  const beforeLow = beforeProfile.low;
  const afterLow = afterProfile.low;

  if (afterHigh > beforeHigh + 1) return "strengthening";
  if (afterLow > beforeLow + 1 && afterHigh < beforeHigh) return "weakening";
  return "neutral";
}

export function extractQuantitativeFindings(text: string): QuantitativeFinding[] {
  const findings: QuantitativeFinding[] = [];
  for (const { name, regex } of QUANTITATIVE_PATTERNS) {
    const matches = text.matchAll(regex);
    for (const m of matches) {
      findings.push({ type: name, value: m[0], raw: m[0] });
    }
  }
  return findings;
}

export function computeEditMagnitude(beforeLength: number, afterLength: number) {
  const maxLen = Math.max(beforeLength, afterLength);
  if (maxLen > 200) return "major" as const;
  if (maxLen > 80) return "moderate" as const;
  return "minor" as const;
}

export function computeContentChange(eventType: string, before: string, after: string) {
  if (eventType === "sentence_first_seen") return "introduction" as const;
  if (eventType === "sentence_removed") return "removal" as const;
  const ratio = after.length / Math.max(before.length, 1);
  if (ratio > 1.5) return "expansion" as const;
  if (ratio < 0.5) return "compression" as const;
  if (after.includes(before.substring(0, Math.min(20, before.length)))) return "refinement" as const;
  return "rewrite" as const;
}

export function extractKeyTerms(text: string): string[] {
  const patterns = [
    /\b\w{6,}\b/g, // ASCII words 6+ chars (filters noise)
    /[\u0600-\u06FF]{4,}/g, // Arabic script terms 4+ chars (roots/nouns carry denser morphology)
  ];
  const terms = new Set<string>();
  const englishStop =
    /^(which|that|this|these|those|their|with|from|have|been|were|about|after|before|during|between|through|because|however|although|therefore|nevertheless|furthermore|additionally|importantly|significantly|typically|generally|usually|commonly|frequently|approximately|estimated|reported|published|described|identified|demonstrated|confirmed|suggested|indicated|appeared|appears|showed|shows|found|finding|findings|noted|noting|observed|observing|concluded|concluding|compared|comparing|included|including|excluded|excluding|received|receiving|treated|treating|followed|following)/;
  const arabicStop =
    /^(?:الذي|التي|الذين|اللذين|اللاتي|هناك|كانت|يكون|تكون|بينما|عندما|حيثما|كذلك|أيضا|أيضاً|خلال|حوالي|بسبب|بدون|جميع)$/;
  for (const p of patterns) {
    for (const m of text.matchAll(p)) {
      const term = m[0].toLowerCase();
      if (!englishStop.test(term) && !arabicStop.test(term)) {
        terms.add(term);
      }
    }
  }
  return [...terms].slice(0, 15); // Limit to top 15
}

/**
 * Deterministic JSON serialization for hash inputs.
 * Sorts object keys recursively so equivalent values always serialize
 * to the same byte string.
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
    case "number":
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const pairs = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
      return `{${pairs.join(",")}}`;
    }
    default:
      return "null";
  }
}

function parameterFootprintToLegacyParameters(
  footprint: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
  const out: Record<string, string | number | boolean> = {};
  let hasAny = false;
  for (const [key, value] of Object.entries(footprint)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      hasAny = true;
    }
  }
  return hasAny ? out : undefined;
}

/** The result of applying semantic enrichment to a single evidence event. */
export interface SemanticEnrichmentResult {
  editMagnitude: EditMagnitude;
  contentChange: ContentChange;
  keyTerms: string[];
  certaintyProfile: CertaintyProfile;
  directionSignal: DirectionSignal;
  quantitativeFindings: QuantitativeFinding[];
  /** Strictly typed provenance block carrying the Merkle root of source + parameters. */
  provenance: FactProvenance;
}

/** Build a deterministic source snapshot hash from the raw event state. */
export function computeSourceSnapshotHash(event: EvidenceEvent): string {
  const snapshot = `${event.fromRevisionId}|${event.toRevisionId}|${event.section}|${event.before}|${event.after}`;
  return hashLeaf(snapshot);
}

/** Build a FactProvenance block for semantic enrichment output. */
export function buildSemanticEnrichmentProvenance(params: {
  sourceSnapshotHash: string;
  parameterFootprint: Record<string, unknown>;
  analyzer?: string;
  version?: string;
  inputHashes?: string[];
  effectiveAt?: string;
}): FactProvenance {
  const parameterHash = hashLeaf(stableStringify(params.parameterFootprint));
  const merkleRoot = buildMerkleRoot([params.sourceSnapshotHash, parameterHash]);
  return {
    analyzer: params.analyzer ?? "@refract-org/analyzers/semantic-enrichment",
    version: params.version ?? EVENT_SCHEMA_VERSION,
    inputHashes: params.inputHashes ?? [params.sourceSnapshotHash],
    parameters: parameterFootprintToLegacyParameters(params.parameterFootprint),
    parameterFootprint: params.parameterFootprint,
    sourceSnapshotHash: params.sourceSnapshotHash,
    effectiveAt: params.effectiveAt ?? new Date().toISOString(),
    merkleRoot,
  };
}

/**
 * Run the full deterministic semantic enrichment pipeline for an evidence event
 * and emit a strictly typed FactProvenance block alongside the enrichment fields.
 */
export function enrichEvidenceEvent(
  event: EvidenceEvent,
  options?: {
    analyzer?: string;
    version?: string;
    parameters?: Record<string, unknown>;
    effectiveAt?: string;
  },
): SemanticEnrichmentResult {
  const before = event.before || "";
  const after = event.after || "";
  const text = after || before;

  const editMagnitude = computeEditMagnitude(before.length, after.length);
  const contentChange = computeContentChange(event.eventType, before, after);
  const keyTerms = extractKeyTerms(text);
  const certaintyProfile = computeCertaintyProfile(text);
  const directionSignal = computeDirectionSignal(computeCertaintyProfile(before), computeCertaintyProfile(after));
  const quantitativeFindings = extractQuantitativeFindings(text);

  const sourceSnapshotHash = computeSourceSnapshotHash(event);
  const parameterFootprint = options?.parameters ?? {};

  const provenance = buildSemanticEnrichmentProvenance({
    sourceSnapshotHash,
    parameterFootprint,
    analyzer: options?.analyzer,
    version: options?.version,
    effectiveAt: options?.effectiveAt,
  });

  return {
    editMagnitude,
    contentChange,
    keyTerms,
    certaintyProfile,
    directionSignal,
    quantitativeFindings,
    provenance,
  };
}
