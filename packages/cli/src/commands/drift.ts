import { computeConstitutionalDriftWindow, revertDetector } from "@refract-org/analyzers";
import type { ConstitutionalDriftWindow, Revision } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { MediaWikiClient } from "@refract-org/ingestion";

export interface DriftOptions {
  apiUrl?: string;
  auth?: AuthConfig;
  revisionLimit?: number;
  fromRevisionId?: number;
  toRevisionId?: number;
  format?: "ndjson" | "json" | "markdown";
}

export interface DriftResult {
  window: ConstitutionalDriftWindow;
  revisions: Revision[];
}

function inRange(rev: Revision, from?: number, to?: number): boolean {
  if (from !== undefined && rev.revId < from) return false;
  if (to !== undefined && rev.revId > to) return false;
  return true;
}

/**
 * Fetch a page's revisions and compute a constitutional-drift window over
 * them. The window is descriptive: it reports observed signals and null where
 * metadata is absent. It does not score the institution.
 */
export async function computeDrift(pageTitle: string, options: DriftOptions = {}): Promise<DriftResult> {
  const client = new MediaWikiClient(
    options.apiUrl ? { apiUrl: options.apiUrl, auth: options.auth } : options.auth ? { auth: options.auth } : undefined,
  );
  const fetched = await client.fetchRevisions(pageTitle, {
    limit: options.revisionLimit ?? 500,
  });
  const revisions = fetched.filter((r) => inRange(r, options.fromRevisionId, options.toRevisionId));
  if (revisions.length === 0) {
    throw new Error(`No revisions of "${pageTitle}" in the requested range.`);
  }

  const chains = revertDetector.detectRevertChain(revisions);
  const revertRevIds = new Set<number>();
  for (const chain of chains) {
    revertRevIds.add(chain.startRevisionId);
    revertRevIds.add(chain.endRevisionId);
  }

  const signals = computeConstitutionalDriftWindow({ revisions, revertRevIds });
  const timestamps = revisions.map((r) => r.timestamp).sort();

  const window: ConstitutionalDriftWindow = {
    type: "constitutional_drift_window",
    page: pageTitle,
    windowStart: timestamps[0],
    windowEnd: timestamps[timestamps.length - 1],
    revisionStart: Math.min(...revisions.map((r) => r.revId)),
    revisionEnd: Math.max(...revisions.map((r) => r.revId)),
    signals: {
      protectedEditShare: signals.protectedEditShare,
      proceduralDepth: signals.proceduralDepth,
      ruleMigrationCount: signals.ruleMigrationCount,
      revertAsymmetry: signals.revertAsymmetry,
      botShareTrend: signals.botShareTrend,
    },
    ruleChangeEventIds: [],
    sourceRevisions: revisions.map((r) => r.revId),
  };

  return { window, revisions };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Render a drift window as a Markdown report. Descriptive only: it reports the
 * observed signals and says "not available" where metadata is absent. It does
 * not score the institution or attribute intent.
 */
export function renderDriftMarkdown(window: ConstitutionalDriftWindow): string {
  const s = window.signals;
  const revertAsymmetry =
    s.revertAsymmetry === null
      ? "not available (no rights-level metadata in this revision range)"
      : s.revertAsymmetry.toFixed(3);
  const lines = [
    `# Constitutional drift — ${window.page}`,
    "",
    `**Window:** ${window.windowStart} → ${window.windowEnd}`,
    `**Revisions:** ${window.revisionStart}–${window.revisionEnd} (${window.sourceRevisions.length} revisions)`,
    "",
    "| Signal | Value |",
    "|---|---|",
    `| Bot share | ${pct(s.botShareTrend)} |`,
    `| Protected-edit share | ${pct(s.protectedEditShare)} |`,
    `| Procedural depth | ${s.proceduralDepth} |`,
    `| Rule migrations | ${s.ruleMigrationCount} |`,
    `| Revert asymmetry | ${revertAsymmetry} |`,
    "",
    "## What this shows",
    "",
    "These are descriptive observations over the captured revision range, not a score.",
    "Bot share and revert asymmetry fall back to a username heuristic when the source",
    "does not supply account metadata; a null means the data was absent, not that the",
    "signal is zero.",
    "",
    "## Source",
    "",
    `Revision range ${window.revisionStart}–${window.revisionEnd} on "${window.page}".`,
    "Each value can be recomputed from the same revisions; no model calls are involved.",
    "",
  ];
  return lines.join("\n");
}

export async function runDrift(pageTitle: string, options: DriftOptions = {}): Promise<void> {
  const { window } = await computeDrift(pageTitle, options);
  const format = options.format ?? "ndjson";
  if (format === "json") {
    console.log(JSON.stringify(window, null, 2));
    return;
  }
  if (format === "markdown") {
    console.log(renderDriftMarkdown(window));
    return;
  }
  console.log(JSON.stringify(window));
}
