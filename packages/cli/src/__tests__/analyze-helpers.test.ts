import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvidenceEvent, Revision } from "@refract-org/evidence-graph";
import { describe, expect, it, vi } from "vitest";
import { buildObservationReport } from "../commands/analyze.js";
import { finalizeEvents } from "../commands/analyze-helpers.js";

describe("buildObservationReport", () => {
  const revision = (revId: number): Revision => ({
    revId,
    pageId: 7,
    pageTitle: "Earth",
    timestamp: `2024-01-0${revId}T00:00:00Z`,
    comment: "",
    content: "",
    size: 0,
    minor: false,
  });
  const sentence = (from: number, to: number, after: string): EvidenceEvent => ({
    eventType: "sentence_first_seen",
    fromRevisionId: from,
    toRevisionId: to,
    section: "lead",
    before: "",
    after,
    deterministicFacts: [],
    layer: "observed",
    timestamp: `2024-01-0${to}T00:00:00Z`,
  });

  it("reports the analyzed revisions as its range, and each claim's own range", () => {
    const revisions = [1, 2, 3, 4, 5].map(revision);
    const report = buildObservationReport(
      "Earth",
      7,
      [sentence(2, 3, "Earth is a planet"), sentence(3, 4, "It has one moon")],
      revisions,
    );

    // The top-level range was the span of sentence events (3–4), and each
    // claim's entry also covered the claims processed before it.
    expect(report.revisionRange).toEqual({ from: 1, to: 5 });
    const ranges = Object.values(report.claims).map((c) => [c.text, c.history[0]?.revisionRange]);
    expect(ranges).toEqual([
      ["Earth is a planet", { from: 3, to: 3 }],
      ["It has one moon", { from: 4, to: 4 }],
    ]);
  });

  it("still names the range when no sentence changed", () => {
    expect(buildObservationReport("Earth", 7, [], [revision(1), revision(2)]).revisionRange).toEqual({
      from: 1,
      to: 2,
    });
  });
});

describe("finalizeEvents", () => {
  it("records a first --since observation without logging the missing prior file", () => {
    const obsDir = mkdtempSync(join(tmpdir(), "analyze-obs-"));
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      finalizeEvents("Earth", [], [], "2024-01-01T00:00:00Z", obsDir);
      expect(stderr.mock.calls).toEqual([["First observation — no delta available."]]);
      expect(existsSync(join(obsDir, "Earth.json"))).toBe(true);
    } finally {
      stderr.mockRestore();
      rmSync(obsDir, { recursive: true, force: true });
    }
  });

  it("neither prints nor writes an observation when the caller keeps its own", () => {
    const obsDir = mkdtempSync(join(tmpdir(), "analyze-obs-"));
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      finalizeEvents("Earth", [], [], "2024-01-01T00:00:00Z", obsDir, false);
      expect(stderr).not.toHaveBeenCalled();
      expect(existsSync(join(obsDir, "Earth.json"))).toBe(false);
    } finally {
      stderr.mockRestore();
      rmSync(obsDir, { recursive: true, force: true });
    }
  });
});
