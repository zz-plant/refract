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
  format?: "ndjson" | "json";
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

export async function runDrift(pageTitle: string, options: DriftOptions = {}): Promise<void> {
  const { window } = await computeDrift(pageTitle, options);
  if ((options.format ?? "ndjson") === "json") {
    console.log(JSON.stringify(window, null, 2));
    return;
  }
  console.log(JSON.stringify(window));
}
