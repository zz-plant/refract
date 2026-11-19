import type { Revision } from "@refract-org/evidence-graph";
import { describe, expect, it } from "vitest";
import {
  computeBotShare,
  computeConstitutionalDriftWindow,
  computeProtectedEditShare,
  computeRevertAsymmetry,
  isBot,
  isBotByHeuristic,
  rightsLevel,
} from "../constitutional-drift.js";

function rev(over: Partial<Revision> & { revId: number }): Revision {
  return {
    revId: over.revId,
    pageId: 1,
    pageTitle: "Test",
    timestamp: over.timestamp ?? "2026-01-01T00:00:00Z",
    comment: over.comment ?? "",
    content: over.content ?? "",
    size: over.size ?? 0,
    minor: over.minor ?? false,
    user: over.user,
    parentId: over.parentId,
  };
}

describe("constitutional-drift", () => {
  describe("isBotByHeuristic", () => {
    it("detects trailing Bot", () => {
      expect(isBotByHeuristic("FooBot")).toBe(true);
    });
    it("detects bot word", () => {
      expect(isBotByHeuristic("my bot account")).toBe(true);
    });
    it("false for normal user", () => {
      expect(isBotByHeuristic("Alice")).toBe(false);
    });
    it("false for undefined", () => {
      expect(isBotByHeuristic(undefined)).toBe(false);
    });
  });

  describe("isBot", () => {
    it("uses metadata when present", () => {
      const r = rev({ revId: 1, user: "Alice" });
      const meta = new Map([[1, { isBot: true }]]);
      expect(isBot(r, meta)).toBe(true);
    });
    it("falls back to heuristic", () => {
      const r = rev({ revId: 2, user: "FooBot" });
      expect(isBot(r)).toBe(true);
    });
  });

  describe("rightsLevel", () => {
    it("returns metadata rights level", () => {
      const r = rev({ revId: 1 });
      const meta = new Map([[1, { rightsLevel: "admin" }]]);
      expect(rightsLevel(r, meta)).toBe("admin");
    });
    it("returns null when absent", () => {
      const r = rev({ revId: 2 });
      expect(rightsLevel(r)).toBeNull();
    });
  });

  describe("computeBotShare", () => {
    it("computes share", () => {
      const revs = [rev({ revId: 1, user: "FooBot" }), rev({ revId: 2, user: "Alice" })];
      const r = computeBotShare(revs);
      expect(r.total).toBe(2);
      expect(r.bot).toBe(1);
      expect(r.share).toBe(0.5);
      expect(r.hasBotData).toBe(false);
    });
    it("reports hasBotData when metadata present", () => {
      const revs = [rev({ revId: 1, user: "Alice" })];
      const meta = new Map([[1, { isBot: false }]]);
      const r = computeBotShare(revs, meta);
      expect(r.hasBotData).toBe(true);
    });
    it("handles empty", () => {
      const r = computeBotShare([]);
      expect(r.total).toBe(0);
      expect(r.share).toBe(0);
    });
  });

  describe("computeProtectedEditShare", () => {
    it("computes ratio", () => {
      expect(computeProtectedEditShare(2, 4)).toBe(0.5);
    });
    it("returns 0 for no edits", () => {
      expect(computeProtectedEditShare(5, 0)).toBe(0);
    });
  });

  describe("computeRevertAsymmetry", () => {
    it("returns null without rights data", () => {
      const revs = [rev({ revId: 1 }), rev({ revId: 2 })];
      expect(computeRevertAsymmetry(revs, new Set([1]), undefined, "admin")).toBeNull();
    });
    it("computes (other rate) - (elevated rate)", () => {
      const revs = [
        rev({ revId: 1 }), // elevated (admin)
        rev({ revId: 2 }), // other
        rev({ revId: 3 }), // other
      ];
      const meta = new Map([
        [1, { rightsLevel: "admin" }],
        [2, { rightsLevel: "autoconfirmed" }],
        [3, { rightsLevel: "autoconfirmed" }],
      ]);
      // rev 2 reverted, rev 1 and 3 not
      const r = computeRevertAsymmetry(revs, new Set([2]), meta, "admin");
      // elevated rate 0/1=0, other rate 1/2=0.5 => 0.5
      expect(r).toBe(0.5);
    });
  });

  describe("computeConstitutionalDriftWindow", () => {
    it("aggregates signals", () => {
      const revs = [rev({ revId: 1, user: "FooBot", comment: "bot edit" }), rev({ revId: 2, user: "Alice" })];
      const r = computeConstitutionalDriftWindow({
        revisions: revs,
        protectedEditCount: 1,
        proceduralDepth: 3,
        ruleMigrationCount: 1,
      });
      expect(r.totalEdits).toBe(2);
      expect(r.botEdits).toBe(1);
      expect(r.botShareTrend).toBe(0.5);
      expect(r.protectedEditShare).toBe(0.5);
      expect(r.proceduralDepth).toBe(3);
      expect(r.ruleMigrationCount).toBe(1);
      expect(r.revertAsymmetry).toBeNull();
      expect(r.hasRightsData).toBe(false);
      expect(r.hasBotData).toBe(false);
    });
  });
});
