import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../commands/analyze.js", () => ({
  runAnalyze: vi.fn(async () => ({ events: [], revisions: [] })),
}));

import type { EvidenceEvent, Revision } from "@refract-org/evidence-graph";
import { runAnalyze } from "../commands/analyze.js";
import { runExport } from "../commands/export.js";

function revision(revId: number, timestamp: string): Revision {
  return { revId, pageId: 42, pageTitle: "Earth", timestamp, comment: "", content: "", size: 0, minor: false };
}

function event(overrides: Partial<EvidenceEvent>): EvidenceEvent {
  return {
    eventType: "citation_removed",
    fromRevisionId: 10,
    toRevisionId: 20,
    section: "body",
    before: "",
    after: "",
    deterministicFacts: [{ fact: "citation_changed", detail: "type=removed" }],
    layer: "observed",
    timestamp: "2020-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("export with nothing to export", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes nothing to stdout, so an empty NDJSON file stays empty", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    await runExport("Earth", "ndjson");

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith("No events to export.");
  });
});

describe("export formats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("json reports the analyzed revisions, not the events, as its range and counts", async () => {
    // Three events land on the one transition 10 → 20. The report said five
    // revisions from 369393212 to 369393212 for a two-revision Bitcoin range.
    vi.mocked(runAnalyze).mockResolvedValueOnce({
      events: [event({}), event({ section: "History" }), event({ eventType: "citation_added" })],
      revisions: [revision(10, "2020-01-01T00:00:00Z"), revision(20, "2020-01-02T00:00:00Z")],
    } as Awaited<ReturnType<typeof runAnalyze>>);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await runExport("Earth", "json");

    const report = JSON.parse(stdout.mock.calls[0]?.[0] as string);
    expect(report.pageId).toBe(42);
    expect(report.analyzedRevisionRange).toEqual({ from: 10, to: 20 });
    expect(report.timeline.totalRevisions).toBe(2);
    expect(report.timeline.analyzedRevisions).toBe(2);
    expect(report.timeline.dateRange).toEqual({ start: "2020-01-01T00:00:00Z", end: "2020-01-02T00:00:00Z" });
    expect(report.timeline.events).toHaveLength(3);
  });

  it("flattened csv quotes the JSON columns, so a row keeps its column count", async () => {
    const withProvenance = event({
      deterministicFacts: [
        {
          fact: "citation_changed",
          provenance: {
            analyzer: "citation-tracker",
            version: "1",
            inputHashes: ["a", "b"],
            parameters: { x: 1, y: 2 },
          },
        },
      ],
    });
    vi.mocked(runAnalyze).mockResolvedValueOnce({
      events: [withProvenance],
      revisions: [revision(10, "2020-01-01T00:00:00Z"), revision(20, "2020-01-02T00:00:00Z")],
    } as Awaited<ReturnType<typeof runAnalyze>>);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await runExport("Earth", "csv", undefined, false, undefined, false, undefined, true);

    const [header, row] = String(stdout.mock.calls[0]?.[0]).split("\n");
    expect(row).toContain('"[""a"",""b""]"');
    expect(row).toContain('"{""x"":1,""y"":2}"');
    expect(header?.split(",")).toHaveLength(14);
  });
});
