export interface AnalyzerConfig {
  /** Optional config version identifier pinned from CLI or consumer. */
  $version?: string;
  heuristic?: HeuristicConfig;
  revert?: RevertConfig;
  editCluster?: EditClusterConfig;
  talkSpike?: TalkSpikeConfig;
  talkCorrelation?: TalkCorrelationConfig;
  talkParser?: TalkParserConfig;
  section?: SectionConfig;
  /** Max revisions to fetch in brief mode (default: 20). */
  briefRevisionLimit?: number;
  /** Max pages to analyze concurrently in batch mode (default: 3). */
  batchConcurrency?: number;
}

export interface HeuristicConfig {
  majorAdditionThreshold?: number;
  majorRemovalThreshold?: number;
  cosmeticThreshold?: number;
  minorThreshold?: number;
  vandalismPatterns?: RegExp[];
  sourcingPatterns?: RegExp[];
}

export interface RevertConfig {
  patterns?: RegExp[];
}

export interface EditClusterConfig {
  windowMs?: number;
  minSize?: number;
}

export interface TalkSpikeConfig {
  lookbackWindowMs?: number;
  spikeFactor?: number;
  movingAveragePeriods?: number;
  floorThreshold?: number;
}

export interface TalkCorrelationConfig {
  windowBeforeMs?: number;
  windowAfterMs?: number;
}

export interface TalkParserConfig {
  resolvedPatterns?: RegExp[];
  maxHeaderLevel?: number;
  userPattern?: RegExp;
  timestampPattern?: RegExp;
}

export interface SectionConfig {
  similarityThreshold?: number;
  renameDetection?: "exact" | "similarity" | "none";
}

export const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = Object.freeze({
  heuristic: {
    majorAdditionThreshold: 2000,
    majorRemovalThreshold: -2000,
    cosmeticThreshold: 20,
    minorThreshold: 100,
  },
  editCluster: {
    windowMs: 60 * 60 * 1000,
    minSize: 3,
  },
  talkSpike: {
    lookbackWindowMs: 7 * 24 * 60 * 60 * 1000,
    spikeFactor: 3.0,
    movingAveragePeriods: 4,
    floorThreshold: 3,
  },
  talkCorrelation: {
    windowBeforeMs: 7 * 24 * 60 * 60 * 1000,
    windowAfterMs: 3 * 24 * 60 * 60 * 1000,
  },
  talkParser: {
    maxHeaderLevel: 3,
  },
  section: {
    similarityThreshold: 0.8,
    renameDetection: "exact" as const,
  },
});
