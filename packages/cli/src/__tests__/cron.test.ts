import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../commands/analyze.js", () => ({
  runAnalyze: vi.fn(),
  buildObservationReport: vi.fn(() => ({
    pageTitle: "",
    pageId: 0,
    observedAt: new Date().toISOString(),
    revisionRange: { from: 0, to: 0 },
    claims: {},
    eventCount: 0,
    merkleRoot: "",
    analyzerVersion: "0.3.1",
  })),
}));

import type { EvidenceEvent } from "@refract-org/evidence-graph";
import { runAnalyze } from "../commands/analyze.js";
import { runCron } from "../commands/cron.js";

function makeEvent(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    eventType: "sentence_first_seen",
    fromRevisionId: 1,
    toRevisionId: 2,
    section: "lead",
    before: "",
    after: "Earth is a planet",
    deterministicFacts: [],
    layer: "observed",
    timestamp: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("cron command", () => {
  it("processes pages file and returns reports", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\nMars\n", "utf-8");

    vi.mocked(runAnalyze).mockResolvedValue({ events: [makeEvent()], revisions: [] });

    const result = await runCron(pagesFile, undefined, undefined, tmpDir);

    expect(result.pagesProcessed).toBe(2);
    expect(result.totalNewEvents).toBe(0);
    expect(result.reports).toHaveLength(2);
    expect(result.reports[0].pageTitle).toBe("Earth");
    expect(result.reports[0].deltaSummary).toBe("baseline established");
    expect(result.reports[1].pageTitle).toBe("Mars");
    expect(result.generatedAt).toBeTruthy();

    expect(existsSync(join(tmpDir, "reports", "Earth.json"))).toBe(true);
    expect(existsSync(join(tmpDir, "reports", "Mars.json"))).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports new events when prior observation exists", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");

    const priorEvent = makeEvent({ timestamp: "2023-12-01T00:00:00Z" });
    const obsDir = join(tmpDir, "observations");
    mkdirSync(obsDir, { recursive: true });
    writeFileSync(join(obsDir, "Earth.json"), JSON.stringify([priorEvent], null, 2));

    const newEvent = makeEvent({
      eventType: "revert_detected",
      fromRevisionId: 3,
      toRevisionId: 4,
      timestamp: "2024-01-15T00:00:00Z",
    });
    vi.mocked(runAnalyze).mockResolvedValue({ events: [priorEvent, newEvent], revisions: [] });

    const result = await runCron(pagesFile, undefined, undefined, tmpDir);

    expect(result.totalNewEvents).toBe(1);
    expect(result.reports[0].eventsNew).toBe(1);
    expect(result.reports[0].eventsResolved).toBe(0);
    expect(result.reports[0].deltaSummary).toContain("1 new");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports no changes when events are unchanged", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");

    const event = makeEvent();
    const obsDir = join(tmpDir, "observations");
    mkdirSync(obsDir, { recursive: true });
    writeFileSync(join(obsDir, "Earth.json"), JSON.stringify([event], null, 2));

    vi.mocked(runAnalyze).mockResolvedValue({ events: [event], revisions: [] });

    const result = await runCron(pagesFile, undefined, undefined, tmpDir);

    expect(result.totalNewEvents).toBe(0);
    expect(result.reports[0].eventsNew).toBe(0);
    expect(result.reports[0].deltaSummary).toBe("no changes");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles interval-based lookback", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");

    vi.mocked(runAnalyze).mockResolvedValue({ events: [makeEvent()], revisions: [] });

    const result = await runCron(pagesFile, 48, undefined, tmpDir);

    expect(result.pagesProcessed).toBe(1);
    expect(result.totalNewEvents).toBe(0);
    expect(result.reports[0].deltaSummary).toBe("baseline established");
    expect(runAnalyze).toHaveBeenCalledWith(
      "Earth",
      "detailed",
      undefined,
      undefined,
      expect.stringMatching(/^202/),
      false,
      undefined,
      undefined,
      tmpDir,
      undefined,
      undefined,
      { recordObservation: false },
    );

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips comment lines in pages file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "# This is a comment\nEarth\n\nMars\n", "utf-8");

    vi.mocked(runAnalyze).mockResolvedValue({ events: [makeEvent()], revisions: [] });

    const result = await runCron(pagesFile, undefined, undefined, tmpDir);

    expect(result.pagesProcessed).toBe(2);
    expect(result.totalNewEvents).toBe(0);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds a new event even when analysis rewrites the observation file first", async () => {
    // Cron now asks analysis not to record an observation, but when analysis
    // did, it wrote the events it just produced to the same
    // observations/<page>.json. Cron read the file afterwards and diffed the
    // run against itself, so it never reported a new event. Reading the prior
    // first keeps that from coming back.
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");
    const obsFile = join(tmpDir, "observations", "Earth.json");
    mkdirSync(join(tmpDir, "observations"), { recursive: true });

    const priorEvent = makeEvent({ timestamp: "2023-12-01T00:00:00Z" });
    writeFileSync(obsFile, JSON.stringify([priorEvent], null, 2));
    const newEvent = makeEvent({
      eventType: "citation_added",
      fromRevisionId: 3,
      toRevisionId: 4,
      timestamp: "2024-01-15T00:00:00Z",
    });

    vi.mocked(runAnalyze).mockImplementation(async () => {
      writeFileSync(obsFile, JSON.stringify([priorEvent, newEvent], null, 2));
      return { events: [priorEvent, newEvent], revisions: [] };
    });

    const result = await runCron(pagesFile, undefined, undefined, tmpDir);

    expect(result.totalNewEvents).toBe(1);
    expect(result.reports[0].eventsNew).toBe(1);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps its own observation, so the second run has something to compare", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");

    const first = makeEvent({ timestamp: "2024-01-01T00:00:00Z" });
    vi.mocked(runAnalyze).mockResolvedValueOnce({ events: [first], revisions: [] });
    const baseline = await runCron(pagesFile, undefined, undefined, tmpDir);
    expect(baseline.reports[0].deltaSummary).toBe("baseline established");
    expect(existsSync(join(tmpDir, "observations", "Earth.json"))).toBe(true);

    const second = makeEvent({
      eventType: "revert_detected",
      fromRevisionId: 5,
      toRevisionId: 6,
      timestamp: "2024-01-02T00:00:00Z",
    });
    vi.mocked(runAnalyze).mockResolvedValueOnce({ events: [first, second], revisions: [] });
    const next = await runCron(pagesFile, undefined, undefined, tmpDir);

    expect(next.totalNewEvents).toBe(1);
    expect(next.reports[0].deltaSummary).toBe("1 new, 0 resolved");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts the next window at the newest prior event, wherever it sits in the file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");

    // Analysis appends talk-page correlations last, stamped with the talk
    // revision's time, which is earlier than the article's newest event.
    const article = makeEvent({ timestamp: "2024-01-01T22:58:44Z" });
    const talk = makeEvent({ eventType: "talk_page_correlated", timestamp: "2024-01-01T15:18:44Z" });
    vi.mocked(runAnalyze).mockResolvedValueOnce({ events: [article, talk], revisions: [] });
    await runCron(pagesFile, undefined, undefined, tmpDir);

    vi.mocked(runAnalyze).mockClear();
    vi.mocked(runAnalyze).mockResolvedValueOnce({ events: [], revisions: [] });
    await runCron(pagesFile, undefined, undefined, tmpDir);

    expect(vi.mocked(runAnalyze).mock.calls[0]).toContain("2024-01-01T22:58:44Z");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not count prior events outside the lookback window as resolved", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");
    mkdirSync(join(tmpDir, "observations"), { recursive: true });

    const longAgo = makeEvent({ timestamp: "2020-01-01T00:00:00Z" });
    writeFileSync(join(tmpDir, "observations", "Earth.json"), JSON.stringify([longAgo], null, 2));
    const recent = makeEvent({
      eventType: "citation_added",
      fromRevisionId: 8,
      toRevisionId: 9,
      timestamp: new Date().toISOString(),
    });
    vi.mocked(runAnalyze).mockResolvedValue({ events: [recent], revisions: [] });

    const result = await runCron(pagesFile, 24, undefined, tmpDir);

    expect(result.reports[0].eventsResolved).toBe(0);
    expect(result.reports[0].eventsNew).toBe(1);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports nothing when a later window re-reads an unedited page", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");
    const now = Date.now();
    const at = (hoursAgo: number) => new Date(now - hoursAgo * 60 * 60 * 1000).toISOString();
    const rev = (revId: number, hoursAgo: number) => ({
      revId,
      pageId: 1,
      pageTitle: "Earth",
      timestamp: at(hoursAgo),
      comment: "",
      content: "",
      size: 0,
      minor: false,
    });

    // First run: revisions 10, 11 and 12 are in the window.
    const onEleven = makeEvent({
      eventType: "citation_removed",
      fromRevisionId: 10,
      toRevisionId: 11,
      timestamp: at(5),
    });
    const returned = makeEvent({
      eventType: "sentence_reintroduced",
      fromRevisionId: 11,
      toRevisionId: 12,
      timestamp: at(2),
    });
    vi.mocked(runAnalyze).mockResolvedValueOnce({
      events: [onEleven, returned],
      revisions: [rev(10, 8), rev(11, 5), rev(12, 2)],
    });
    await runCron(pagesFile, 9, undefined, tmpDir);

    // An hour later nothing has been edited, but revision 10 has left the
    // window. Revision 11 now opens it, so it is not compared with 10, and the
    // sentence on 12 reads as first seen because its earlier life is out of view.
    const flipped = { ...returned, eventType: "sentence_first_seen" as const };
    vi.mocked(runAnalyze).mockResolvedValueOnce({ events: [flipped], revisions: [rev(11, 5), rev(12, 2)] });
    const next = await runCron(pagesFile, 6, undefined, tmpDir);

    expect(next.totalNewEvents).toBe(0);
    expect(next.reports[0].deltaSummary).toBe("no changes");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps the last observation through a quiet run, so the next run still has its anchor", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");
    const obsFile = join(tmpDir, "observations", "Earth.json");

    const seen = makeEvent({ timestamp: "2024-01-01T00:00:00Z" });
    vi.mocked(runAnalyze).mockResolvedValueOnce({ events: [seen], revisions: [] });
    await runCron(pagesFile, undefined, undefined, tmpDir);

    // A day with no edits.
    vi.mocked(runAnalyze).mockResolvedValueOnce({ events: [], revisions: [] });
    const quiet = await runCron(pagesFile, undefined, undefined, tmpDir);
    expect(quiet.reports[0].deltaSummary).toBe("no changes");
    expect(JSON.parse(readFileSync(obsFile, "utf-8"))).toEqual([seen]);

    const fresh = makeEvent({
      eventType: "citation_removed",
      fromRevisionId: 7,
      toRevisionId: 8,
      timestamp: "2024-01-03T00:00:00Z",
    });
    vi.mocked(runAnalyze).mockResolvedValueOnce({ events: [seen, fresh], revisions: [] });
    const next = await runCron(pagesFile, undefined, undefined, tmpDir);

    expect(next.reports[0].priorObservationAt).toBe("2024-01-01T00:00:00Z");
    expect(next.totalNewEvents).toBe(1);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes nothing to stderr on a page's first run", async () => {
    // No prior observation or report exists yet, which is what a first run is.
    // The missing report was logged with its ENOENT and full stack.
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");
    vi.mocked(runAnalyze).mockResolvedValueOnce({ events: [makeEvent()], revisions: [] });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await runCron(pagesFile, undefined, undefined, tmpDir);
      expect(result.reports[0].deltaSummary).toBe("baseline established");
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports an unreadable prior report in one line, without a stack", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cron-test-"));
    const pagesFile = join(tmpDir, "pages.txt");
    writeFileSync(pagesFile, "Earth\n", "utf-8");
    const reportFile = join(tmpDir, "reports", "Earth.json");
    mkdirSync(join(tmpDir, "reports"), { recursive: true });
    writeFileSync(reportFile, "{ truncated");
    vi.mocked(runAnalyze).mockResolvedValueOnce({ events: [makeEvent()], revisions: [] });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await runCron(pagesFile, undefined, undefined, tmpDir);
      expect(stderr).toHaveBeenCalledTimes(1);
      const args = stderr.mock.calls[0];
      expect(args).toHaveLength(1);
      expect(args[0]).toContain(`failed to read prior observation report ${reportFile}: `);
      expect(args[0]).not.toContain("\n");
    } finally {
      stderr.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
