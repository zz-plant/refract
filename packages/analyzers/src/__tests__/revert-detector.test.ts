import type { Revision } from "@refract-org/evidence-graph";
import { describe, expect, it } from "vitest";
import { findIdentityReverts, revertDetector } from "../revert-detector.js";

function makeRev(revId: number, comment: string, content = ""): Revision {
  return {
    revId,
    pageId: 1,
    pageTitle: "Test",
    timestamp: new Date(Date.UTC(2026, 0, revId)).toISOString(),
    comment,
    content,
    size: 100,
    minor: false,
  };
}

describe("isRevert", () => {
  it("detects 'revert' in comment", () => {
    expect(revertDetector.isRevert("reverted vandalism")).toBe(true);
  });

  it("detects 'undid revision' in comment", () => {
    expect(revertDetector.isRevert("Undid revision 12345 by User")).toBe(true);
  });

  it("detects 'rvv' in comment", () => {
    expect(revertDetector.isRevert("rvv nonsense")).toBe(true);
  });

  it("detects 'rollback' in comment", () => {
    expect(revertDetector.isRevert("Rollback vandalism")).toBe(true);
  });

  it("detects 'restore' in comment", () => {
    expect(revertDetector.isRevert("Restore previous version")).toBe(true);
  });

  it("detects '[[WP:ROLLBACK]]' in comment", () => {
    expect(revertDetector.isRevert("[[WP:ROLLBACK]] vandalism")).toBe(true);
  });

  it("returns false for non-revert comments", () => {
    expect(revertDetector.isRevert("added citation")).toBe(false);
    expect(revertDetector.isRevert("fixed typo")).toBe(false);
    expect(revertDetector.isRevert("expanded section")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(revertDetector.isRevert("REVERT")).toBe(true);
    expect(revertDetector.isRevert("Reverted")).toBe(true);
  });
});

describe("detectRevertChain", () => {
  it("detects a single revert edit", () => {
    const revs = [makeRev(1, "added content"), makeRev(2, "reverted")];
    const chains = revertDetector.detectRevertChain(revs);
    expect(chains.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for no reverts", () => {
    const revs = [makeRev(1, "added content"), makeRev(2, "fixed typo"), makeRev(3, "expanded")];
    expect(revertDetector.detectRevertChain(revs)).toEqual([]);
  });

  it("detects a multi-edit revert chain", () => {
    const revs = [makeRev(1, "good edit"), makeRev(2, "revert"), makeRev(3, "re-revert")];
    const chains = revertDetector.detectRevertChain(revs);
    expect(chains.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for empty revision list", () => {
    expect(revertDetector.detectRevertChain([])).toEqual([]);
  });

  // Revision IDs are numbered across the whole wiki, so one page's revisions
  // are far apart. Chains were grouped, and an unnamed target guessed, by ID
  // arithmetic, which put each revert in a chain of its own and named as its
  // target whatever revision of another page had the ID one below.
  it("groups reverts that follow each other in the page's history, whatever their IDs", () => {
    const revs = [makeRev(1000, "add"), makeRev(5000, "revert"), makeRev(9000, "revert again"), makeRev(12000, "edit")];
    expect(revertDetector.detectRevertChain(revs)).toEqual([
      { startRevisionId: 5000, endRevisionId: 9000, participants: 2 },
    ]);
  });

  it("does not guess a target the summary and the text do not give", () => {
    const [chain] = revertDetector.detectRevertChain([makeRev(1000, "add", "a"), makeRev(5000, "rollback", "b")]);
    expect(chain.revertedToRevisionId).toBeUndefined();
  });

  it("reads 'Undid revision N' as the revision taken away, not the one put back", () => {
    const [chain] = revertDetector.detectRevertChain([
      makeRev(1000, "add", "a"),
      makeRev(5000, "Undid revision 1000 by X", "b"),
    ]);
    expect(chain.undoneRevisionId).toBe(1000);
    expect(chain.revertedToRevisionId).toBeUndefined();
  });

  it("reads 'Restored revision N' as the revision put back", () => {
    const [chain] = revertDetector.detectRevertChain([
      makeRev(1000, "add", "a"),
      makeRev(5000, "Restored revision 777 by Y", "b"),
    ]);
    expect(chain.revertedToRevisionId).toBe(777);
  });

  it("finds a revert with a silent summary by its restored text", () => {
    const revs = [makeRev(1000, "", "stable"), makeRev(2000, "", "vandalised"), makeRev(3000, "tidy", "stable")];
    expect(revertDetector.detectRevertChain(revs)).toEqual([
      { startRevisionId: 3000, endRevisionId: 3000, revertedToRevisionId: 1000, participants: 1 },
    ]);
  });
});

describe("findIdentityReverts", () => {
  it("maps a revision to the latest earlier revision with the same text", () => {
    const revs = [
      makeRev(10, "", "A"),
      makeRev(20, "", "B"),
      makeRev(30, "", "A"),
      makeRev(40, "", "B"),
      makeRev(50, "", "A"),
    ];
    expect([...findIdentityReverts(revs)]).toEqual([
      [30, 10],
      [40, 20],
      [50, 30],
    ]);
  });

  it("does not count a null edit as a revert", () => {
    expect(findIdentityReverts([makeRev(10, "", "A"), makeRev(20, "", "A")]).size).toBe(0);
  });

  it("skips revisions whose text was withheld", () => {
    const hidden = { ...makeRev(20, "", ""), contentAvailable: false };
    expect([...findIdentityReverts([makeRev(10, "", "A"), hidden, makeRev(30, "", "A")])]).toEqual([[30, 10]]);
  });

  it("orders by timestamp, not by the order given", () => {
    const revs = [makeRev(30, "", "A"), makeRev(10, "", "A"), makeRev(20, "", "B")];
    expect([...findIdentityReverts(revs)]).toEqual([[30, 10]]);
  });
});
