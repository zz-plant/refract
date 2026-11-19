import type { ConstitutionalDriftWindow } from "@refract-org/evidence-graph";
import { describe, expect, it } from "vitest";
import { renderDriftMarkdown } from "../commands/drift.js";

function window(over: Partial<ConstitutionalDriftWindow> = {}): ConstitutionalDriftWindow {
  return {
    type: "constitutional_drift_window",
    page: "Test",
    windowStart: "2026-01-01T00:00:00Z",
    windowEnd: "2026-02-01T00:00:00Z",
    revisionStart: 1,
    revisionEnd: 10,
    signals: {
      protectedEditShare: 0.2,
      proceduralDepth: 3,
      ruleMigrationCount: 1,
      revertAsymmetry: 0.25,
      botShareTrend: 0.1,
    },
    ruleChangeEventIds: [],
    sourceRevisions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ...over,
  };
}

describe("renderDriftMarkdown", () => {
  it("includes the page and window", () => {
    const md = renderDriftMarkdown(window());
    expect(md).toContain("# Constitutional drift — Test");
    expect(md).toContain("2026-01-01T00:00:00Z");
    expect(md).toContain("2026-02-01T00:00:00Z");
  });

  it("formats percentages", () => {
    const md = renderDriftMarkdown(window());
    expect(md).toContain("10.0%");
    expect(md).toContain("20.0%");
  });

  it("reports null revert asymmetry as not available", () => {
    const w = window();
    w.signals.revertAsymmetry = null;
    const md = renderDriftMarkdown(w);
    expect(md).toContain("not available");
  });

  it("does not claim a verdict", () => {
    const md = renderDriftMarkdown(window());
    expect(md).toContain("not a score");
    expect(md).not.toContain("failing");
  });
});
