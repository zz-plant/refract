import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runClaim, runClaimHistory } from "../commands/claim.js";
import { runSnapshot, SnapshotInputError, takeSnapshot } from "../commands/snapshot.js";

const API = "https://wiki.example/w/api.php";

interface StubRevision {
  revid: number;
  timestamp: string;
  content: string;
  comment?: string;
}

/**
 * A page history served the way the action API serves it, range parameters
 * included: rvdir, rvstart/rvend, rvstartid/rvendid, rvlimit with rvcontinue,
 * revids, and sha1 when asked for. tests/support/fake-mediawiki.ts ignores
 * the range parameters, and these commands are built on them.
 */
function serve(history: StubRevision[]) {
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      requests.push(url);
      const p = url.searchParams;
      const rvprop = p.get("rvprop") ?? "";
      const entry = (rev: StubRevision) => {
        const index = history.indexOf(rev);
        return {
          revid: rev.revid,
          parentid: index === 0 ? 0 : history[index - 1].revid,
          timestamp: rev.timestamp,
          comment: rev.comment ?? "",
          user: "Editor",
          size: rev.content.length,
          minor: false,
          ...(rvprop.includes("sha1") ? { sha1: createHash("sha1").update(rev.content).digest("hex") } : {}),
          ...(rvprop.includes("content") ? { slots: { main: { content: rev.content } } } : {}),
        };
      };
      const page = (revisions: unknown[], cont?: string) =>
        new Response(
          JSON.stringify({
            query: { pages: [{ pageid: 7, title: "Bridge", revisions }] },
            ...(cont ? { continue: { rvcontinue: cont, continue: "||" } } : {}),
          }),
        );
      if (p.get("revids")) {
        const wanted = new Set(p.get("revids")?.split("|").map(Number));
        return page(history.filter((r) => wanted.has(r.revid)).map(entry));
      }
      const newer = p.get("rvdir") === "newer";
      const time = (r: StubRevision) => Date.parse(r.timestamp);
      const at = (name: string) => (p.get(name) ? Date.parse(p.get(name) as string) : undefined);
      const id = (name: string) => (p.get(name) ? Number(p.get(name)) : undefined);
      const [start, end, startId, endId] = [at("rvstart"), at("rvend"), id("rvstartid"), id("rvendid")];
      let rows = history.filter((r) =>
        newer
          ? (start === undefined || time(r) >= start) &&
            (end === undefined || time(r) <= end) &&
            (startId === undefined || r.revid >= startId) &&
            (endId === undefined || r.revid <= endId)
          : (start === undefined || time(r) <= start) &&
            (end === undefined || time(r) >= end) &&
            (startId === undefined || r.revid <= startId) &&
            (endId === undefined || r.revid >= endId),
      );
      if (!newer) rows = rows.reverse();
      const offset = Number(p.get("rvcontinue") ?? "0");
      const limit = Number(p.get("rvlimit") ?? "50");
      const next = offset + limit < rows.length ? String(offset + limit) : undefined;
      return page(rows.slice(offset, offset + limit).map(entry), next);
    }),
  );
  return requests;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("refract snapshot", () => {
  const GOOD = "Lead about the bridge.\n\n== Status ==\nOpen to traffic.";
  const history = [
    { revid: 1, timestamp: "2024-03-01T10:00:00Z", content: GOOD },
    { revid: 2, timestamp: "2024-03-14T22:15:00Z", content: "BRIDGE IS FAKE" },
    { revid: 3, timestamp: "2024-03-15T06:30:00Z", content: GOOD, comment: "Reverted vandalism" },
    { revid: 4, timestamp: "2024-04-01T00:00:00Z", content: GOOD.replace("== Status ==", "== Current status ==") },
  ];

  it("skips the version vandalized on the date and reverted the next morning", async () => {
    serve(history);
    const { snapshot, revisions } = await takeSnapshot("Bridge", "2024-03-14", { apiUrl: API });
    expect(snapshot).toMatchObject({
      revisionId: 1,
      cutoff: "2024-03-14T23:59:59Z",
      skipped: [{ revisionId: 2, timestamp: "2024-03-14T22:15:00Z" }],
      restoredBy: { revisionId: 3, timestamp: "2024-03-15T06:30:00Z" },
      text: "Lead about the bridge.\n\nOpen to traffic.",
    });
    expect(revisions.map((r) => r.revId)).toEqual([1]);
    const kept = await takeSnapshot("Bridge", "2024-03-14", { apiUrl: API, keepReverted: true });
    expect(kept.snapshot).toMatchObject({ revisionId: 2, text: "BRIDGE IS FAKE" });
    expect(kept.snapshot).not.toHaveProperty("skipped");
  });

  it("reads a section by the heading it had on the date, and says when that revision lacks it", async () => {
    serve(history);
    const { snapshot } = await takeSnapshot("Bridge", "2024-03-20", {
      apiUrl: API,
      scope: "section",
      section: "Status",
    });
    expect(snapshot).toMatchObject({ revisionId: 3, text: "Open to traffic." });
    await expect(
      takeSnapshot("Bridge", "2024-04-02", { apiUrl: API, scope: "section", section: "Status" }),
    ).rejects.toThrow(SnapshotInputError);
  });

  it("prints the skipped revision and the scoped text", async () => {
    serve(history);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runSnapshot("Bridge", "2024-03-14", false, API, undefined, undefined, { scope: "lead" });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("Closest revision: 1 (2024-03-01T10:00:00Z)");
    expect(output).toContain("Skipped rev 2 (2024-03-14T22:15:00Z): a later edit reverted it; rev 3 restored the text");
    expect(output).toContain("Lead (");
    expect(output).toContain("Lead about the bridge.");
    expect(output).not.toContain("Open to traffic.");
  });
});

describe("refract claim --sample --locate", () => {
  // Sixty daily revisions. Three large additions (10, 30, 50) are what a
  // five-revision sample picks besides the ends; the passage arrives in a
  // small edit at 23, and 25 is a blanking that 26 reverted.
  const CLAIM = "The bridge opened to traffic in 2031.";
  const filler = (n: number) => ` ${"Background paragraph. ".repeat(25 * n)}`;
  const history: StubRevision[] = Array.from({ length: 60 }, (_, i) => {
    const revid = i + 1;
    const big = (revid >= 10 ? 1 : 0) + (revid >= 30 ? 1 : 0) + (revid >= 50 ? 1 : 0);
    const content = `Intro.${revid >= 23 ? ` ${CLAIM}` : ""}${filler(big)}`;
    return {
      revid,
      timestamp: new Date(Date.UTC(2030, 0, 1 + i)).toISOString().replace(".000Z", "Z"),
      content: revid === 25 ? "" : content,
      comment: revid === 26 ? "Reverted blanking" : "",
    };
  });

  it("dates the change to the edit that made it, between the samples that bracket it", async () => {
    const requests = serve(history);
    const result = await runClaimHistory(
      "Bridge",
      CLAIM,
      false,
      API,
      undefined,
      undefined,
      undefined,
      {},
      {
        sample: 5,
        locate: true,
      },
    );
    const first = result.transitions[0];
    expect(first).toMatchObject({ kind: "first_seen", adjacent: false });
    expect(first.located).toMatchObject({ revisionId: 23, previousRevisionId: 22, timestamp: "2030-01-23T00:00:00Z" });
    const fetchedById = requests.flatMap((url) => url.searchParams.get("revids")?.split("|").map(Number) ?? []);
    expect(fetchedById).not.toContain(25);
  });

  it("leaves the output as it was without --locate", async () => {
    serve(history);
    const plain = await runClaimHistory(
      "Bridge",
      CLAIM,
      false,
      API,
      undefined,
      undefined,
      undefined,
      {},
      { sample: 5 },
    );
    expect(plain.transitions.every((t) => t.located === undefined)).toBe(true);
  });

  it("prints the edit on the transition's line", async () => {
    serve(history);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runClaim("Bridge", CLAIM, false, API, undefined, undefined, undefined, {}, { sample: 5, locate: true });
    expect(log.mock.calls.flat().join("\n")).toMatch(
      /first seen, rev \d+ → \d+ \(not adjacent\); made by rev 23 \(2030-01-23T00:00:00Z\), after rev 22;/,
    );
  });

  it("refuses --sample with --limit", async () => {
    serve(history);
    await expect(
      runClaimHistory("Bridge", CLAIM, false, API, undefined, undefined, 10, {}, { sample: 5 }),
    ).rejects.toThrow("--sample and --limit");
  });
});
