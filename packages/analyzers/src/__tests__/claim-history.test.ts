import type { Revision } from "@refract-org/evidence-graph";
import { describe, expect, it } from "vitest";
import { claimHistory, findPassageMatch, locateTransitions, nearestPassage } from "../claim-history.js";

const CLAIM = "The bridge opened to traffic in 2031.";
const REWRITE = "The bridge carried its first cars in 2031.";

function revision(revId: number, content: string, extra: Partial<Revision> = {}): Revision {
  return {
    revId,
    parentId: revId - 1,
    pageId: 7,
    pageTitle: "Bridge",
    timestamp: `2030-01-01T00:${String(revId).padStart(2, "0")}:00Z`,
    comment: "",
    content,
    size: content.length,
    minor: false,
    ...extra,
  };
}

describe("claimHistory", () => {
  // Added in 2, kept in 3, rewritten past the matcher in 4, put back by an
  // undo in 5, and removed in 7, whose parent 6 was not read.
  const revisions = [
    revision(1, "Stub."),
    revision(2, CLAIM),
    revision(3, CLAIM),
    revision(4, REWRITE, { comment: "copyedit" }),
    revision(5, CLAIM, { comment: "Undid revision 4 by Example" }),
    revision(7, "Stub, expanded."),
  ];

  it("follows the passage across revisions given in any order, with no I/O", () => {
    const result = claimHistory([...revisions].reverse(), CLAIM);
    expect(result).toMatchObject({
      page: "Bridge",
      pageId: 7,
      status: "absent",
      latestRevisionId: 7,
      latestMatch: "none",
    });
    expect(
      result.transitions.map((t) => [t.kind, t.previousRevisionId, t.revisionId, t.adjacent, t.heldRevisions]),
    ).toEqual([
      ["first_seen", 1, 2, true, 2],
      ["removed", 3, 4, true, 1],
      ["reintroduced", 4, 5, true, 1],
      ["removed", 5, 7, false, 1],
    ]);
    expect(result.transitions[2]).toMatchObject({
      editSummary: "Undid revision 4 by [editor]",
      revertSummary: true,
      restoresRevisionId: 3,
    });
    expect(result.transitions[1].nearest).toEqual({ text: REWRITE, wordOverlap: 0.5 });
  });

  it("names the page it is told to, and reports no revisions as absent", () => {
    expect(claimHistory([], CLAIM, { page: "Harbour Bridge" })).toMatchObject({
      page: "Harbour Bridge",
      status: "absent",
      historySummary: 'No revisions found for "Harbour Bridge".',
    });
  });

  it("does not infer absence from withheld text", () => {
    const result = claimHistory([revision(3, CLAIM), revision(4, "", { contentAvailable: false })], CLAIM);
    expect(result.status).toBe("unknown");
    expect(result.latestMatch).toBe("unavailable");
  });

  it("refuses empty passage text", () => {
    expect(() => claimHistory(revisions, "  ")).toThrow("nonempty");
  });
});

describe("findPassageMatch", () => {
  it("matches the sentence holding the passage, then a passage across sentences, then 70% of its longer words", () => {
    expect(findPassageMatch("third planet", "Intro. Earth is the third planet from the Sun.")).toEqual({
      kind: "exact",
      text: "Earth is the third planet from the Sun.",
    });
    expect(findPassageMatch("Intro. Earth", "Intro. Earth is here.").kind).toBe("exact");
    expect(findPassageMatch(CLAIM, "The bridge opened to traffic in 2032.")).toEqual({
      kind: "partial",
      text: "The bridge opened to traffic in 2032.",
    });
    expect(findPassageMatch(CLAIM, "Nothing alike.")).toEqual({ kind: "none", text: "" });
  });
});

describe("nearestPassage", () => {
  it("keeps the sentence with the largest share of the passage's words, from half up", () => {
    expect(nearestPassage("Alpha bravo charlie delta", "Alpha only. Alpha bravo here. Nothing.")).toEqual({
      text: "Alpha bravo here.",
      wordOverlap: 0.5,
    });
    expect(nearestPassage("Alpha bravo charlie delta", "Alpha only. Nothing.")).toBeUndefined();
    expect(nearestPassage("a an the", "a an the")).toBeUndefined();
  });
});

describe("locateTransitions", () => {
  // Read at 1, 20 and 40 only. The passage appeared at 9 and was reworded at
  // 31; 25 and 26 are a blanking a later edit reverted, left out by `between`.
  const NEW = "The bridge opened to road traffic in 2031.";
  const textOf = (id: number) => (id < 9 ? "Stub." : id < 31 ? CLAIM : NEW);
  const sampled = [revision(1, textOf(1)), revision(20, textOf(20)), revision(40, textOf(40))];
  const reverted = new Set([25, 26]);
  const requests: number[][] = [];
  const locator = {
    async between(t: { previousRevisionId?: number; revisionId: number }) {
      const ids: number[] = [];
      for (let id = (t.previousRevisionId ?? 0) + 1; id < t.revisionId; id++) if (!reverted.has(id)) ids.push(id);
      return ids.map((id) => ({ revisionId: id, timestamp: revision(id, "").timestamp }));
    },
    async fetchTexts(ids: number[]) {
      requests.push(ids);
      return new Map(ids.map((id) => [id, textOf(id)]));
    },
  };

  it("narrows each non-adjacent transition to the edit that made it", async () => {
    const located = await locateTransitions(claimHistory(sampled, CLAIM), locator);
    expect(
      located.transitions.map((t) => [t.kind, t.revisionId, t.located?.revisionId, t.located?.previousRevisionId]),
    ).toEqual([
      ["first_seen", 20, 9, 8],
      ["text_changed", 40, 31, 30],
    ]);
    expect(located.transitions[0].located?.timestamp).toBe("2030-01-01T00:09:00Z");
    expect(requests.flat()).not.toContain(25);
  });

  it("leaves adjacent transitions and the first revision read as they are", async () => {
    const adjacent = claimHistory([revision(1, "Stub."), revision(2, CLAIM)], CLAIM);
    const located = await locateTransitions(adjacent, locator);
    expect(located.transitions[0]).not.toHaveProperty("located");
    expect(located).toEqual(adjacent);
  });

  it("places the change at the later revision when no revision between holds the new state", async () => {
    const result = claimHistory([revision(1, "Stub."), revision(5, CLAIM, { parentId: 3 })], CLAIM);
    const never = { ...locator, fetchTexts: async (ids: number[]) => new Map(ids.map((id) => [id, "Stub."])) };
    const located = await locateTransitions(result, never);
    expect(located.transitions[0].located).toMatchObject({ revisionId: 5, previousRevisionId: 4 });
  });
});
