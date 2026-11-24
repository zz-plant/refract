import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type SnapshotFetchers, type SnapshotRevision, snapshotAt } from "../snapshot-at.js";

interface Rev extends SnapshotRevision {
  content: string;
}

/** A page history as fetchers: neighbours by timestamp around the moment asked for, and text by ID. */
function fetchersFor(history: Rev[]) {
  const calls = { around: [] as Array<{ at: string; around: number }>, content: [] as Array<[number, unknown]> };
  const fetchers: SnapshotFetchers<Rev> = {
    async revisionsAround(_title, at, { around }) {
      calls.around.push({ at, around });
      const time = Date.parse(at);
      const before = history.filter((r) => Date.parse(r.timestamp) <= time).slice(-(around + 1));
      const after = history.filter((r) => Date.parse(r.timestamp) > time).slice(0, around);
      // Newest first before the moment, as rvdir=older returns them.
      return [...before.reverse(), ...after];
    },
    async fetchContent(revisionId, options) {
      calls.content.push([revisionId, options]);
      return history.find((r) => r.revId === revisionId)?.content ?? null;
    },
  };
  return { fetchers, calls };
}

const rev = (revId: number, timestamp: string, content: string): Rev => ({
  revId,
  timestamp,
  content,
  sha1: `sha-${content}`,
});

const GOOD = "Lead about the bridge.\n\n== Status ==\nOpen to traffic.";
const BETTER = "Lead about the bridge, expanded.\n\n== Status ==\nOpen to traffic.";

describe("snapshotAt", () => {
  it("steps back past a version vandalized on the date and undone the next morning", async () => {
    const history = [
      rev(1, "2024-03-01T10:00:00Z", GOOD),
      rev(2, "2024-03-14T22:15:00Z", "BRIDGE IS FAKE"),
      rev(3, "2024-03-15T06:30:00Z", GOOD),
      rev(4, "2024-04-01T00:00:00Z", BETTER),
    ];
    const { fetchers } = fetchersFor(history);
    const snapshot = await snapshotAt(fetchers, "Bridge", "2024-03-14");
    expect(snapshot).toMatchObject({
      cutoff: "2024-03-14T23:59:59Z",
      revisionId: 1,
      timestamp: "2024-03-01T10:00:00Z",
      skipped: [expect.objectContaining({ revId: 2 })],
      restoredBy: expect.objectContaining({ revId: 3 }),
      text: "Lead about the bridge.\n\nOpen to traffic.",
    });
    const kept = await snapshotAt(fetchers, "Bridge", "2024-03-14", { excludeRevertedStates: false });
    expect(kept).toMatchObject({ revisionId: 2, skipped: [], text: "BRIDGE IS FAKE" });
  });

  it("reads an edit made later on the date, and a timestamp as that moment", async () => {
    const history = [rev(1, "2024-03-01T10:00:00Z", GOOD), rev(2, "2024-03-14T22:15:00Z", BETTER)];
    const { fetchers } = fetchersFor(history);
    expect((await snapshotAt(fetchers, "Bridge", "2024-03-14"))?.revisionId).toBe(2);
    expect((await snapshotAt(fetchers, "Bridge", "2024-03-14T12:00:00Z"))?.revisionId).toBe(1);
    expect((await snapshotAt(fetchers, "Bridge", "2024-03-14T12:00"))?.cutoff).toBe("2024-03-14T12:00:00Z");
  });

  it("finds a section by the heading it had on the date, though it was renamed later", async () => {
    const history = [
      rev(1, "2024-03-01T10:00:00Z", GOOD),
      rev(2, "2024-05-01T10:00:00Z", GOOD.replace("== Status ==", "== Current status ==")),
    ];
    const { fetchers } = fetchersFor(history);
    const then = await snapshotAt(fetchers, "Bridge", "2024-04-01", { scope: "section", section: "Status" });
    expect(then).toMatchObject({ revisionId: 1, section: "Status", text: "Open to traffic." });
    const renamed = await snapshotAt(fetchers, "Bridge", "2024-04-01", { scope: "section", section: "Current status" });
    expect(renamed).toMatchObject({ revisionId: 1, text: null });
    expect(renamed?.wikitext).toBe(GOOD);
    expect(
      (await snapshotAt(fetchers, "Bridge", "2024-06-01", { scope: "section", section: "Current status" }))?.text,
    ).toBe("Open to traffic.");
  });

  it("returns the lead of a page whose infobox ends in a literal <, asking for section 0", async () => {
    const pluto = readFileSync(new URL("./fixtures/pluto-1387362520-lead.wiki", import.meta.url), "utf-8");
    const { fetchers, calls } = fetchersFor([rev(1387362520, "2026-11-23T16:40:00Z", pluto)]);
    const snapshot = await snapshotAt(fetchers, "Pluto", "2026-11-24", { scope: "lead" });
    expect(snapshot?.text).toMatch(/^Pluto \(minor-planet number 134340\) is a dwarf planet in the Kuiper belt/);
    expect(snapshot?.text?.split("\n\n")).toHaveLength(4);
    expect(calls.content).toEqual([[1387362520, { section: 0 }]]);
  });

  it("returns null when no revision exists at or before the date", async () => {
    const { fetchers } = fetchersFor([rev(1, "2024-03-01T10:00:00Z", GOOD)]);
    expect(await snapshotAt(fetchers, "Bridge", "2024-02-28")).toBeNull();
  });

  it("reports hidden text as null", async () => {
    const { fetchers } = fetchersFor([rev(1, "2024-03-01T10:00:00Z", GOOD)]);
    const hidden = { ...fetchers, fetchContent: async () => null };
    expect(await snapshotAt(hidden, "Bridge", "2024-03-02")).toMatchObject({
      revisionId: 1,
      wikitext: null,
      text: null,
    });
  });

  it("sees a reverted state only when the revision it undid is among those read", async () => {
    const history = [
      rev(1, "2024-03-01T10:00:00Z", GOOD),
      rev(2, "2024-03-14T20:00:00Z", "vandal one"),
      rev(3, "2024-03-14T21:00:00Z", "vandal two"),
      rev(4, "2024-03-15T06:00:00Z", GOOD),
    ];
    const { fetchers, calls } = fetchersFor(history);
    // One either side reads 2, 3 and 4: nothing there restores an earlier text.
    expect(await snapshotAt(fetchers, "Bridge", "2024-03-14", { around: 1 })).toMatchObject({
      revisionId: 3,
      skipped: [],
    });
    const wider = await snapshotAt(fetchers, "Bridge", "2024-03-14", { around: 3 });
    expect(wider?.revisionId).toBe(1);
    expect(wider?.skipped.map((r) => r.revId)).toEqual([3, 2]);
    expect(calls.around.map((c) => c.around)).toEqual([1, 3]);
  });

  it("flags a snapshot whose every revision read is a reverted state", async () => {
    const { fetchers } = fetchersFor([rev(1, "2024-03-01T10:00:00Z", GOOD), rev(2, "2024-03-02T10:00:00Z", BETTER)]);
    const snapshot = await snapshotAt(fetchers, "Bridge", "2024-03-14", { revertedStates: () => new Set([1, 2]) });
    expect(snapshot).toMatchObject({ revisionId: 2, skipped: [], revertedStateUnresolved: true });
  });

  it("uses a reverted-state rule the caller supplies", async () => {
    const history = [rev(1, "2024-03-01T10:00:00Z", GOOD), rev(2, "2024-03-14T20:00:00Z", BETTER)];
    const { fetchers } = fetchersFor(history);
    const snapshot = await snapshotAt(fetchers, "Bridge", "2024-03-14", { revertedStates: () => new Set([2]) });
    expect(snapshot).toMatchObject({ revisionId: 1, skipped: [expect.objectContaining({ revId: 2 })] });
    expect(snapshot).not.toHaveProperty("restoredBy");
  });

  it("rejects a date that is not ISO 8601, and a section scope without a heading, before reading anything", async () => {
    const { fetchers, calls } = fetchersFor([]);
    await expect(snapshotAt(fetchers, "Bridge", "March 14, 2024")).rejects.toThrow(RangeError);
    await expect(snapshotAt(fetchers, "Bridge", "2024-02-30")).rejects.toThrow(/Invalid date/);
    await expect(snapshotAt(fetchers, "Bridge", "2024-03-14", { scope: "section" })).rejects.toThrow(TypeError);
    expect(calls.around).toEqual([]);
  });
});
