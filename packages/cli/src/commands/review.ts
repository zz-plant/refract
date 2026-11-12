import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { annotateEvents, buildRevisionEvents } from "@refract-org/analyzers";
import type { EvidenceEvent, Revision } from "@refract-org/evidence-graph";
import { createEventIdentity } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { MediaWikiClient } from "@refract-org/ingestion";
import type { HistoryCoverage } from "../coverage.js";
import { contiguousRevisionGroups, describeCoverage, formatCoverage } from "../coverage.js";
import { onboardingPageTitle, onboardingRevisions } from "../onboarding-sample.js";
import { REFRACT_VERSION } from "../version.js";

export interface ReviewSource {
  kind: "mediawiki" | "fictional_sample";
  key: string;
  apiUrl: string;
  pageTitle: string;
  pageId: number;
}
export interface ReviewEntry extends EvidenceEvent {
  source: ReviewSource;
  entryId: string;
  revisionLinks: { before: string; after: string; diff: string };
}
export interface ReviewPage {
  source: ReviewSource;
  reviewedRevisionId: number | null;
  baselineRevisionId: number | null;
  fetchedRevisionId: number | null;
  latestRevisionId: number | null;
  status: "baseline_required" | "pending" | "no_changes" | "incomplete" | "error";
  coverage: HistoryCoverage;
  inputRevisions: Revision[];
  entries: ReviewEntry[];
  error?: string;
}
export interface ReviewReport {
  format: "refract-review/v1";
  analyzerVersion: string;
  depth: "detailed";
  scope: "article_revisions";
  reportId: string;
  pages: ReviewPage[];
}
interface SourceState {
  reviewedRevisionId: number | null;
  fetchedRevisionId: number | null;
  baselineRevisionId: number | null;
  pendingRevisions: Revision[];
}
interface ReviewState {
  format: "refract-review-state/v1";
  sources: Record<string, SourceState>;
}
export interface ReviewOptions {
  stateDir?: string;
  apiUrl?: string;
  auth?: AuthConfig;
  from?: number;
  limit?: number;
  sample?: boolean;
}
export interface ReviewFilters {
  eventTypes?: string[];
  section?: string;
  text?: string;
}
const DEFAULT_STATE_DIR = join(homedir(), ".refract", "review");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function atomicWrite(path: string, value: unknown): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
async function withReviewLock<T>(dir: string, action: () => Promise<T>): Promise<T> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, ".lock");
  try {
    mkdirSync(lock);
  } catch {
    throw new Error(
      `Review state is locked: ${lock}. Wait for the other run; after an interrupted run, remove this directory when no review process is running.`,
    );
  }
  try {
    return await action();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
function readState(dir: string): ReviewState {
  const path = join(dir, "state.json");
  if (!existsSync(path)) return { format: "refract-review-state/v1", sources: {} };
  const state = JSON.parse(readFileSync(path, "utf8")) as ReviewState;
  if (state.format !== "refract-review-state/v1" || !state.sources) throw new Error("Unsupported review state format.");
  return state;
}
function sourceFor(title: string, apiUrl?: string): ReviewSource {
  const url = new URL(apiUrl ?? "https://en.wikipedia.org/w/api.php");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) API endpoint without credentials, query parameters, or a fragment.");
  }
  const canonical = url.href;
  return { kind: "mediawiki", key: hash([canonical, title]), apiUrl: canonical, pageTitle: title, pageId: 0 };
}
export function revisionLinks(apiUrl: string, from: number, to: number): ReviewEntry["revisionLinks"] {
  const make = (params: Record<string, string>) => {
    const url = new URL(apiUrl);
    url.pathname = url.pathname.replace(/[^/]+$/, "index.php");
    url.search = new URLSearchParams(params).toString();
    return url.href;
  };
  return {
    before: make({ oldid: String(from) }),
    after: make({ oldid: String(to) }),
    diff: make({ oldid: String(from), diff: String(to) }),
  };
}

export async function observeReview(titles: string[], options: ReviewOptions = {}): Promise<ReviewReport> {
  const dir = options.stateDir ?? DEFAULT_STATE_DIR;
  const limit = options.limit ?? 200;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
  if (options.from !== undefined && (!Number.isSafeInteger(options.from) || options.from < 1))
    throw new Error("--from must be a positive revision ID.");
  if (options.sample && (titles.length || options.apiUrl || options.auth))
    throw new Error("Use --sample without page titles, --api, or authentication.");
  const unique = options.sample ? [onboardingPageTitle] : [...new Set(titles.map((t) => t.trim()).filter(Boolean))];
  if (!unique.length) throw new Error("Supply a page or a nonempty --pages-file.");
  return withReviewLock(dir, async () => {
    const state = readState(dir);
    const pages: ReviewPage[] = [];
    for (const title of unique) {
      const source = sourceFor(title, options.sample ? "https://example.org/w/api.php" : options.apiUrl);
      if (options.sample) {
        source.kind = "fictional_sample";
        source.key = hash([source.apiUrl, title, source.kind]);
      }
      const prior = state.sources[source.key];
      const reviewed = prior?.reviewedRevisionId ?? null;
      const baseline = reviewed ?? options.from ?? prior?.baselineRevisionId ?? null;
      if (reviewed !== null && options.from !== undefined && options.from !== reviewed) {
        throw new Error(
          "--from cannot replace an acknowledged review baseline. Use a separate --state-dir to inspect another range.",
        );
      }
      const page: ReviewPage = {
        source,
        reviewedRevisionId: reviewed,
        baselineRevisionId: baseline,
        fetchedRevisionId: prior?.fetchedRevisionId ?? null,
        latestRevisionId: null,
        status: "error",
        coverage: describeCoverage([]),
        inputRevisions: [],
        entries: [],
      };
      try {
        const client = new MediaWikiClient({ apiUrl: source.apiUrl, auth: options.auth });
        const sample = onboardingRevisions.map((r) => ({ ...r, parentId: r.revId - 1, contentAvailable: true }));
        const heads = options.sample
          ? [sample.at(-1)]
          : await client.fetchRevisions(title, { direction: "older", limit: 1 });
        const head = heads[0];
        if (!head) throw new Error("No visible revisions found for this page.");
        source.pageId = head.pageId;
        page.latestRevisionId = head.revId;
        let revisions: Revision[];
        if (baseline === null) revisions = [head];
        else {
          const pending = prior?.baselineRevisionId === baseline ? prior.pendingRevisions : [];
          const pendingEnd = pending.at(-1);
          const reusable =
            !!pendingEnd &&
            pending.length &&
            pending[0].revId === baseline &&
            pending.every((r) => r.contentAvailable !== false) &&
            describeCoverage(pending).missingRevisionIds.length === 0 &&
            pending.slice(1).every((r) => r.parentId !== undefined) &&
            pendingEnd.revId <= head.revId;
          const start = reusable && pendingEnd ? pendingEnd.revId : baseline;
          const delta =
            start === head.revId
              ? [head]
              : options.sample
                ? sample.filter((r) => r.revId >= start && r.revId <= head.revId).slice(0, limit + 1)
                : await client.fetchRevisions(title, {
                    direction: "newer",
                    startRevId: start,
                    endRevId: head.revId,
                    limit: limit + 1,
                  });
          const byId = new Map<number, Revision>();
          if (reusable) for (const r of pending) byId.set(r.revId, r);
          for (const r of delta) byId.set(r.revId, r);
          revisions = [...byId.values()].sort((a, b) => a.revId - b.revId);
        }
        const last = revisions.at(-1);
        page.inputRevisions = revisions;
        page.fetchedRevisionId = last?.revId ?? null;
        const truncated = !!last && last.revId !== head.revId;
        page.coverage = describeCoverage(
          revisions,
          { fromRevisionId: baseline ?? head.revId, toRevisionId: head.revId },
          truncated,
        );
        const unknown = revisions.slice(1).some((r) => r.parentId === undefined);
        if (baseline === null && head.contentAvailable !== false) {
          page.coverage.status = "complete";
          page.coverage.notes = ["Initial baseline only. Earlier history has not been reviewed."];
          page.status = "baseline_required";
        } else if (page.coverage.status === "partial" || unknown || !last) page.status = "incomplete";
        else if (revisions.length === 1 && revisions[0].revId === baseline && baseline === head.revId) {
          page.coverage.status = "complete";
          page.coverage.notes = ["The source is still at the selected baseline; there are no newer revisions."];
          page.status = "no_changes";
        } else page.status = "pending";
        // All filters are a view over a saved, unfiltered report.
        const events = annotateEvents(
          contiguousRevisionGroups(revisions).flatMap((group) => buildRevisionEvents(group, { depth: "detailed" })),
        );
        const entries = new Map<string, ReviewEntry>();
        for (const event of events) {
          const observationId = event.eventId ?? createEventIdentity(event);
          const entryId = hash([source.key, observationId]);
          entries.set(entryId, {
            ...event,
            eventId: observationId,
            entryId,
            source,
            revisionLinks: revisionLinks(source.apiUrl, event.fromRevisionId, event.toRevisionId),
          });
        }
        page.entries = [...entries.values()];
        if (page.status === "pending" && !page.entries.length) page.status = "no_changes";
        state.sources[source.key] = {
          reviewedRevisionId: reviewed,
          fetchedRevisionId: page.fetchedRevisionId,
          baselineRevisionId: baseline,
          pendingRevisions: revisions,
        };
        atomicWrite(join(dir, "state.json"), state);
      } catch (error) {
        page.status = "error";
        page.error = (error as Error).message;
      }
      pages.push(page);
    }
    const data = {
      format: "refract-review/v1" as const,
      analyzerVersion: REFRACT_VERSION,
      depth: "detailed" as const,
      scope: "article_revisions" as const,
      pages,
    };
    const report: ReviewReport = { ...data, reportId: hash(data) };
    mkdirSync(join(dir, "reports"), { recursive: true, mode: 0o700 });
    atomicWrite(join(dir, "reports", `${report.reportId}.json`), report);
    return report;
  });
}

/** Whether `acknowledgeReview` accepts this report: every page fetched with complete coverage. */
export function isAcknowledgeable(report: ReviewReport): boolean {
  return (
    report.pages.length > 0 &&
    report.pages.every(
      (p) =>
        p.coverage.status === "complete" &&
        p.status !== "error" &&
        p.status !== "incomplete" &&
        p.fetchedRevisionId !== null,
    )
  );
}

/** The command a person runs to acknowledge a report after inspecting it. */
export function acknowledgeCommand(reportId: string, stateDir?: string): string {
  const dir = stateDir ? ` --state-dir '${stateDir.replaceAll("'", "'\"'\"'")}'` : "";
  return `refract review${dir} --ack ${reportId}`;
}

export async function acknowledgeReview(reportId: string, stateDir = DEFAULT_STATE_DIR): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(reportId)) throw new Error("Supply the saved report's 64-character report ID.");
  return withReviewLock(stateDir, async () => {
    const report = JSON.parse(readFileSync(join(stateDir, "reports", `${reportId}.json`), "utf8")) as ReviewReport;
    const { reportId: storedId, ...data } = report;
    if (report.format !== "refract-review/v1" || storedId !== reportId || hash(data) !== reportId)
      throw new Error("Review report hash mismatch.");
    if (!isAcknowledgeable(report)) {
      throw new Error("Cannot acknowledge an incomplete report. Resume the review and inspect a complete report.");
    }
    const state = readState(stateDir);
    for (const page of report.pages) {
      const current = state.sources[page.source.key];
      if (!current) throw new Error("Review source state is missing.");
      if (current.reviewedRevisionId === page.fetchedRevisionId) continue;
      if (current.reviewedRevisionId !== page.reviewedRevisionId)
        throw new Error("This report is stale; the reviewed baseline has changed.");
      const end = page.fetchedRevisionId;
      if (end === null) throw new Error("Incomplete revision endpoint.");
      const newerPending = current.pendingRevisions.filter((r) => r.revId >= end);
      const savedEnd = page.inputRevisions.find((r) => r.revId === end);
      current.reviewedRevisionId = end;
      current.baselineRevisionId = end;
      current.pendingRevisions =
        newerPending.length && newerPending[0].revId === end ? newerPending : savedEnd ? [savedEnd] : [];
    }
    atomicWrite(join(stateDir, "state.json"), state);
  });
}

export function filterReviewEntries(entries: ReviewEntry[], filters: ReviewFilters = {}): ReviewEntry[] {
  return entries.filter(
    (e) =>
      (!filters.eventTypes?.length || filters.eventTypes.includes(e.eventType)) &&
      (!filters.section || e.section === filters.section) &&
      (!filters.text || `${e.before}\n${e.after}`.toLowerCase().includes(filters.text.toLowerCase())),
  );
}
export function renderReview(report: ReviewReport, filters: ReviewFilters = {}, stateDir?: string): string {
  const lines = [
    "# Source change review",
    "",
    `Report: ${report.reportId}`,
    `Analyzer: ${report.analyzerVersion}; scope: article revisions only.`,
    "",
  ];
  const quote = (value: string) => {
    const backticks = value.match(/`+/g) ?? [];
    const fence = "`".repeat(Math.max(3, ...backticks.map((run) => run.length + 1)));
    return `${fence}text\n${value}\n${fence}`;
  };
  for (const page of report.pages) {
    const entries = filterReviewEntries(page.entries, filters);
    lines.push(
      `## ${page.source.pageTitle}`,
      "",
      `Status: ${page.status}. Reviewed revision: ${page.reviewedRevisionId ?? "none"}; fetched: ${page.fetchedRevisionId ?? "none"}; source head: ${page.latestRevisionId ?? "unknown"}.`,
      "",
      formatCoverage(page.coverage),
      "",
    );
    if (page.error) lines.push(`Fetch failed: ${page.error}`, "");
    if (page.source.kind === "fictional_sample")
      lines.push(
        "Fictional sample: dates, revision IDs, and URLs are illustrative. Inspect inputRevisions in the saved JSON report.",
        "",
      );
    if (page.latestRevisionId && page.source.kind !== "fictional_sample")
      lines.push(
        `[Inspect source head](${revisionLinks(page.source.apiUrl, page.latestRevisionId, page.latestRevisionId).after})`,
        "",
      );
    lines.push(
      `${entries.length} shown; ${page.entries.length - entries.length} hidden by filters. Acknowledgment covers all revisions and events in the unfiltered saved report.`,
      "",
    );
    for (const entry of entries) {
      lines.push(
        `### ${entry.eventType} — ${entry.section || "Lead"}`,
        "",
        page.source.kind === "fictional_sample"
          ? `${entry.timestamp} · fictional revisions ${entry.fromRevisionId} → ${entry.toRevisionId}`
          : `${entry.timestamp} · [Before](${entry.revisionLinks.before}) · [After](${entry.revisionLinks.after}) · [Diff](${entry.revisionLinks.diff})`,
        "",
        "Before:",
        "",
        quote(entry.before || "(empty)"),
        "",
        "After:",
        "",
        quote(entry.after || "(empty)"),
        "",
      );
    }
    if (!page.entries.length && page.status === "no_changes")
      lines.push("No events emitted by the enabled rules for this captured range.", "");
  }
  if (report.pages.every((p) => p.coverage.status === "complete"))
    lines.push(`After inspecting the saved report: ${acknowledgeCommand(report.reportId, stateDir)}`, "");
  else lines.push("Review is incomplete. Run review again to resume; acknowledgment is unavailable.", "");
  return lines.join("\n");
}
