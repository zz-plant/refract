import { afterEach, describe, expect, it } from "vitest";
import {
  FAKE_API,
  type FakeHistoryRevision,
  fakeMediaWikiStats,
  installFakeMediaWiki,
} from "../../../../tests/support/fake-mediawiki.js";
import { findRevertedStates, MediaWikiClient } from "../mediawiki-client.js";

const client = () => new MediaWikiClient({ apiUrl: FAKE_API, minDelayMs: 0 });

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("resolveTitle", () => {
  it("follows a redirect to the page's ID, title and namespace", async () => {
    restore = installFakeMediaWiki({
      pages: [
        { pageid: 31717, ns: 0, title: "United Kingdom" },
        { pageid: 186148, ns: 1, title: "Talk:Pluto" },
      ],
      redirects: { UK: "United Kingdom" },
    });
    expect(await client().resolveTitle("UK")).toEqual({ pageId: 31717, title: "United Kingdom", ns: 0 });
    expect(await client().resolveTitle("Talk:Pluto")).toEqual({ pageId: 186148, title: "Talk:Pluto", ns: 1 });
    expect(fakeMediaWikiStats.requests[0].searchParams.get("redirects")).toBe("1");
  });

  it("is null for a missing page or an invalid title, without asking about a title list", async () => {
    restore = installFakeMediaWiki({ pages: [] });
    expect(await client().resolveTitle("No such page")).toBeNull();
    expect(await client().resolveTitle("<>")).toBeNull();
    expect(await client().resolveTitle("A|B")).toBeNull();
    expect(fakeMediaWikiStats.requests).toHaveLength(2);
  });
});

/** Revisions 1–120, each with a lead and one "History" section; from 61 on, a "Reception" section too. */
function sectionedHistory(): FakeHistoryRevision[] {
  return Array.from({ length: 120 }, (_, i) => ({
    revid: i + 1,
    timestamp: new Date(Date.UTC(2020, 0, 1) + i * 3_600_000).toISOString(),
    content: [
      `Lead ${i + 1}.`,
      "== History ==",
      `History ${i + 1}.`,
      "=== Early ===",
      "Early years.",
      ...(i >= 60 ? ["== Reception ==", `Reception ${i + 1}.`] : []),
    ].join("\n"),
  }));
}

describe("fetchSections", () => {
  it("reads one section of up to 50 revisions a request, keyed by revision", async () => {
    restore = installFakeMediaWiki({ history: sectionedHistory() });
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const leads = await client().fetchSections([...ids, 1, 2], 0);

    expect(leads.size).toBe(120);
    expect(leads.get(7)).toBe("Lead 7.");
    const requests = fakeMediaWikiStats.requests;
    expect(requests.map((u) => u.searchParams.get("revids")?.split("|").length)).toEqual([50, 50, 20]);
    expect(requests.every((u) => u.searchParams.get("rvsection") === "0")).toBe(true);
    expect(fakeMediaWikiStats.maxInFlight).toBeLessThanOrEqual(3);
  });

  it("includes subsections, and leaves out revisions without the section", async () => {
    restore = installFakeMediaWiki({ history: sectionedHistory() });
    expect((await client().fetchSections([5], 1)).get(5)).toBe(
      "== History ==\nHistory 5.\n=== Early ===\nEarly years.",
    );
    const reception = await client().fetchSections([59, 60, 61, 62], 3);
    expect([...reception.keys()]).toEqual([61, 62]);
    expect(reception.get(61)).toBe("== Reception ==\nReception 61.");
  });

  it("rejects a section that is not a non-negative integer", async () => {
    await expect(client().fetchSections([1], -1)).rejects.toThrow(RangeError);
    await expect(client().fetchSections([1], 1.5)).rejects.toThrow(RangeError);
  });
});

describe("revisionAt", () => {
  const hour = (h: number) => new Date(Date.UTC(2021, 9, 18) + h * 3_600_000).toISOString();
  // Hourly edits; revision 105 and 106 share a second, and 108 is vandalism
  // that 109 reverts.
  const history: FakeHistoryRevision[] = [
    ...Array.from({ length: 30 }, (_, i) => ({ revid: 100 + i, timestamp: hour(i), content: `Text ${i}` })),
  ].map((rev) => {
    if (rev.revid === 106) return { ...rev, timestamp: hour(5) };
    if (rev.revid === 108) return { ...rev, content: "vandalised" };
    if (rev.revid === 109) return { ...rev, content: "Text 7" };
    return rev;
  });

  it("returns the last revision made at or before the moment, with neighbours either side, oldest first", async () => {
    restore = installFakeMediaWiki({ history });
    const at = await client().revisionAt("Pluto", hour(12.5), { around: 3 });
    expect(at.revision?.revId).toBe(112);
    expect(at.before.map((m) => m.revId)).toEqual([109, 110, 111]);
    expect(at.after.map((m) => m.revId)).toEqual([113, 114, 115]);
    expect(at.revision?.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof at.revision?.size).toBe("number");
  });

  it("gives a caller what it needs to see the live revision was a reverted state", async () => {
    restore = installFakeMediaWiki({ history });
    const at = await client().revisionAt("Pluto", hour(8));
    expect(at.revision?.revId).toBe(108);
    expect(findRevertedStates([...at.before, ...(at.revision ? [at.revision] : []), ...at.after]).has(108)).toBe(true);
  });

  it("counts a revision made in the same second as the live one as after it", async () => {
    restore = installFakeMediaWiki({ history });
    const at = await client().revisionAt("Pluto", hour(5), { around: 2 });
    expect(at.revision?.revId).toBe(106);
    expect(at.before.map((m) => m.revId)).toEqual([104, 105]);
    expect(at.after.map((m) => m.revId)).toEqual([107, 108]);
  });

  it("has no live revision before the page existed, and reads what came after the moment", async () => {
    restore = installFakeMediaWiki({ history });
    const at = await client().revisionAt("Pluto", hour(-1), { around: 2 });
    expect(at.revision).toBeNull();
    expect(at.before).toEqual([]);
    expect(at.after.map((m) => m.revId)).toEqual([100, 101]);
  });

  it("asks once when around is 0, and rejects a bad moment or count", async () => {
    restore = installFakeMediaWiki({ history });
    const at = await client().revisionAt("Pluto", hour(3), { around: 0 });
    expect([at.revision?.revId, at.before, at.after]).toEqual([103, [], []]);
    expect(fakeMediaWikiStats.requests).toHaveLength(1);
    await expect(client().revisionAt("Pluto", "not a date")).rejects.toThrow(RangeError);
    await expect(client().revisionAt("Pluto", hour(3), { around: -1 })).rejects.toThrow(RangeError);
  });
});
