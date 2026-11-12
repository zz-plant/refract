import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { diffObservations } from "@refract-org/analyzers";
import type { EvidenceEvent, ObservationReport } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import type { NotifyConfig } from "../notify.js";
import { sendNotifications } from "../notify.js";
import { buildObservationReport, runAnalyze } from "./analyze.js";
import { readPriorJson } from "./analyze-helpers.js";

export interface CronReport {
  pageTitle: string;
  observedAt: string;
  priorObservationAt: string | null;
  eventsNew: number;
  eventsResolved: number;
  eventsUnchanged: number;
  deltaSummary: string;
}

export interface CronResult {
  reports: CronReport[];
  totalNewEvents: number;
  pagesProcessed: number;
  generatedAt: string;
}

function mergeObservationReports(prior: ObservationReport | null, current: ObservationReport): ObservationReport {
  if (!prior) return current;

  const mergedClaims: Record<string, ObservationReport["claims"][string]> = { ...prior.claims };

  for (const [claimId, currentLedger] of Object.entries(current.claims)) {
    if (mergedClaims[claimId]) {
      const existing = mergedClaims[claimId];
      existing.lastSeenAt = currentLedger.lastSeenAt;
      existing.currentState = currentLedger.currentState;
      existing.history.push(...currentLedger.history);
    } else {
      mergedClaims[claimId] = currentLedger;
    }
  }

  return {
    pageTitle: current.pageTitle,
    pageId: current.pageId,
    observedAt: current.observedAt,
    revisionRange: current.revisionRange,
    claims: mergedClaims,
    eventCount: current.eventCount,
    uniqueEditorCount: Math.max(prior?.uniqueEditorCount ?? 0, current.uniqueEditorCount),
    merkleRoot: current.merkleRoot,
    analyzerVersion: current.analyzerVersion,
  };
}

/**
 * Prior events this run could have seen again. Strictly after the window's
 * start: an event at the start itself is the edit into the first revision of
 * the window, whose parent lies before it, so a windowed analysis never
 * reproduces it — and when the window starts at the last prior event, that
 * event would otherwise be reported resolved on every run.
 */
function withinWindow(events: EvidenceEvent[], fromTimestamp: string | undefined): EvidenceEvent[] {
  if (!fromTimestamp) return events;
  const from = new Date(fromTimestamp).getTime();
  return events.filter((e) => new Date(e.timestamp).getTime() > from);
}

export async function runCron(
  pagesFile: string,
  intervalHours?: number,
  apiUrl?: string,
  cacheDir?: string,
  notifyConfig?: NotifyConfig,
  auth?: AuthConfig,
): Promise<CronResult> {
  const content = readFileSync(pagesFile, "utf-8");
  const titles = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  console.log(`Cron: ${titles.length} pages from ${pagesFile}\n`);

  const baseDir = cacheDir ?? join(homedir(), ".wikihistory");
  const obsDir = join(baseDir, "observations");
  const reportsDir = join(baseDir, "reports");
  if (!existsSync(obsDir)) mkdirSync(obsDir, { recursive: true });
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const reports: CronReport[] = [];
  let totalNewEvents = 0;

  for (const title of titles) {
    const safeName = title.replace(/[^a-zA-Z0-9_-]/g, "_");
    const obsFile = join(obsDir, `${safeName}.json`);

    // Cron keeps its own observation under baseDir and asks analysis not to
    // record one. Analysis's --since path otherwise reads and overwrites
    // ~/.wikihistory/observations/<page>.json whatever --cache-dir says, and
    // prints a delta against it that counts prior events outside this window
    // as resolved. The prior is still read before analysis runs, so a write
    // there can never make cron diff a run against itself.
    const hadPrior = existsSync(obsFile);
    const priorEvents = readPriorJson<EvidenceEvent[]>(obsFile, "cron: failed to read prior observation file") ?? [];
    let priorObservationAt: string | null = null;
    let fromTimestamp: string | undefined;

    if (intervalHours !== undefined && intervalHours > 0) {
      const d = new Date(Date.now() - intervalHours * 60 * 60 * 1000);
      fromTimestamp = d.toISOString();
    } else if (priorEvents.length > 0) {
      // The newest event, not the last in the array: talk-page correlations are
      // appended after the article's events and carry the talk revision's time,
      // which can be hours earlier. Starting there re-read a window that no
      // longer held the earlier transitions, and reported the difference as new.
      const lastTimestamp = priorEvents.reduce(
        (newest, e) => (e.timestamp > newest ? e.timestamp : newest),
        priorEvents[0].timestamp,
      );
      priorObservationAt = lastTimestamp;
      fromTimestamp = lastTimestamp;
    } else {
      const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
      fromTimestamp = d.toISOString();
    }

    console.log(`  ${title}: observing since ${fromTimestamp ?? "beginning"}...`);

    const { events, revisions } = await runAnalyze(
      title,
      "detailed",
      undefined,
      undefined,
      fromTimestamp,
      false,
      apiUrl,
      undefined,
      cacheDir,
      auth,
      undefined,
      { recordObservation: false },
    );

    const isFirstObservation = !hadPrior;
    // New is judged against everything seen before. Resolved is judged only
    // against prior events inside this run's window: one outside it was not
    // looked at this time, which is not the same as having gone away.
    const seen = diffObservations(priorEvents, events);
    // A window that starts later than the last one reads less history. The
    // window's first revision is not compared with the one before it, and a
    // sentence whose earlier appearance is now out of view is reported as
    // first seen rather than reintroduced. Neither is a change to the page, so
    // an event on a revision that already had events is not new, and an event
    // is resolved only when its revision was compared again and has none left.
    const priorRevisions = new Set(priorEvents.map((e) => e.toRevisionId));
    const currentRevisions = new Set(events.map((e) => e.toRevisionId));
    const anchorRevId = revisions[0]?.revId ?? 0;
    const obsDiff = {
      new: seen.new.filter((e) => e.toRevisionId === 0 || !priorRevisions.has(e.toRevisionId)),
      unchanged: seen.unchanged,
      resolved: diffObservations(withinWindow(priorEvents, fromTimestamp), events).resolved.filter(
        (e) => e.toRevisionId > anchorRevId && !currentRevisions.has(e.toRevisionId),
      ),
    };
    // A quiet run keeps the previous observation as the next run's anchor,
    // rewriting it if analysis emptied the file on the way.
    const keep = events.length > 0 || !hadPrior ? events : priorEvents;
    writeFileSync(obsFile, JSON.stringify(keep, null, 2), "utf-8");

    const report: CronReport = {
      pageTitle: title,
      observedAt: new Date().toISOString(),
      priorObservationAt,
      eventsNew: isFirstObservation ? 0 : obsDiff.new.length,
      eventsResolved: isFirstObservation ? 0 : obsDiff.resolved.length,
      eventsUnchanged: isFirstObservation ? 0 : obsDiff.unchanged.length,
      deltaSummary: isFirstObservation
        ? "baseline established"
        : obsDiff.new.length > 0 || obsDiff.resolved.length > 0
          ? `${obsDiff.new.length} new, ${obsDiff.resolved.length} resolved`
          : "no changes",
    };
    reports.push(report);

    const pageId = revisions[0]?.pageId ?? 0;
    const currentReport = buildObservationReport(title, pageId, events, revisions);

    const observationReportFile = join(reportsDir, `${safeName}.json`);
    const priorObservationReport =
      readPriorJson<ObservationReport>(observationReportFile, "cron: failed to read prior observation report") ?? null;

    const mergedReport = mergeObservationReports(priorObservationReport, currentReport);
    writeFileSync(observationReportFile, JSON.stringify(mergedReport, null, 2), "utf-8");

    if (!isFirstObservation && obsDiff.new.length > 0) {
      totalNewEvents += obsDiff.new.length;
      console.log(`    ${obsDiff.new.length} new events, ${obsDiff.resolved.length} resolved`);
    } else {
      console.log(`    No changes`);
    }
  }

  const result: CronResult = {
    reports,
    totalNewEvents,
    pagesProcessed: titles.length,
    generatedAt: new Date().toISOString(),
  };

  console.log(`\n=== Cron Summary ===`);
  console.log(`Pages: ${titles.length}`);
  console.log(`Total new events: ${totalNewEvents}`);

  if (notifyConfig) {
    const changedDeltas = reports
      .filter((r) => r.eventsNew > 0 || r.eventsResolved > 0)
      .map((r) => ({
        pageTitle: r.pageTitle,
        eventsNew: r.eventsNew,
        eventsResolved: r.eventsResolved,
        deltaSummary: r.deltaSummary,
        wikiUrl: apiUrl,
      }));
    await sendNotifications(notifyConfig, changedDeltas);
  }

  return result;
}
