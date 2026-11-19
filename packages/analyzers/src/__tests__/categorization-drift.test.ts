import { describe, expect, it } from "vitest";
import {
  classifyObjection,
  classifyTerminalState,
  computeDriftRate,
  detectMarkers,
  detectOperationalMarkers,
  detectStructuralMarkers,
  isDriftTerminal,
  OPERATIONAL_MARKERS,
  STRUCTURAL_MARKERS,
} from "../categorization-drift.js";

describe("categorization-drift", () => {
  describe("marker lists", () => {
    it("has non-empty marker lists", () => {
      expect(STRUCTURAL_MARKERS.length).toBeGreaterThan(0);
      expect(OPERATIONAL_MARKERS.length).toBeGreaterThan(0);
    });
  });

  describe("detectStructuralMarkers", () => {
    it("detects a structural critique", () => {
      const m = detectStructuralMarkers("This policy contradicts itself and should be changed.");
      expect(m).toContain("contradicts");
      expect(m).toContain("should be changed");
    });

    it("returns empty for neutral text", () => {
      expect(detectStructuralMarkers("The weather is nice today.")).toEqual([]);
    });

    it("is case-insensitive", () => {
      expect(detectStructuralMarkers("OUTDATED guideline.")).toContain("outdated");
    });
  });

  describe("detectOperationalMarkers", () => {
    it("detects a reclassification redirect", () => {
      const m = detectOperationalMarkers("This is by design, won't fix, wrong venue.");
      expect(m).toContain("by design");
      expect(m).toContain("won't fix");
      expect(m).toContain("wrong venue");
    });

    it("returns empty for neutral text", () => {
      expect(detectOperationalMarkers("The weather is nice today.")).toEqual([]);
    });
  });

  describe("detectMarkers", () => {
    it("returns both lists", () => {
      const r = detectMarkers("This contradicts the policy; please file a bug.");
      expect(r.structuralMarkers).toContain("contradicts");
      expect(r.operationalMarkers).toContain("please file a bug");
    });
  });

  describe("classifyObjection", () => {
    it("flags an objection with structural markers", () => {
      const r = classifyObjection("This policy contradicts itself and should be changed.");
      expect(r.isObjection).toBe(true);
      expect(r.structuralMarkers.length).toBeGreaterThan(0);
    });

    it("does not flag a pure operational redirect", () => {
      const r = classifyObjection("Please file a bug in the right venue.");
      expect(r.isObjection).toBe(false);
    });
  });

  describe("classifyTerminalState", () => {
    it("absorbed takes precedence", () => {
      expect(
        classifyTerminalState({
          structuralMarkers: ["contradicts"],
          reclassificationMarkers: ["by design"],
          substantiveResponsePresent: true,
          closedWithoutResolution: false,
          absorbed: true,
        }),
      ).toBe("absorbed");
    });

    it("reclassified when operational markers present", () => {
      expect(
        classifyTerminalState({
          structuralMarkers: ["contradicts"],
          reclassificationMarkers: ["by design"],
          substantiveResponsePresent: false,
          closedWithoutResolution: false,
          absorbed: false,
        }),
      ).toBe("reclassified");
    });

    it("resolved_substantive when substantive response present", () => {
      expect(
        classifyTerminalState({
          structuralMarkers: ["contradicts"],
          reclassificationMarkers: [],
          substantiveResponsePresent: true,
          closedWithoutResolution: false,
          absorbed: false,
        }),
      ).toBe("resolved_substantive");
    });

    it("abandoned when closed without resolution", () => {
      expect(
        classifyTerminalState({
          structuralMarkers: ["contradicts"],
          reclassificationMarkers: [],
          substantiveResponsePresent: false,
          closedWithoutResolution: true,
          absorbed: false,
        }),
      ).toBe("abandoned");
    });

    it("open otherwise", () => {
      expect(
        classifyTerminalState({
          structuralMarkers: ["contradicts"],
          reclassificationMarkers: [],
          substantiveResponsePresent: false,
          closedWithoutResolution: false,
          absorbed: false,
        }),
      ).toBe("open");
    });
  });

  describe("isDriftTerminal", () => {
    it("true for reclassified without substantive response", () => {
      expect(isDriftTerminal("reclassified", false)).toBe(true);
    });

    it("false for reclassified with substantive response", () => {
      expect(isDriftTerminal("reclassified", true)).toBe(false);
    });

    it("false for resolved_substantive", () => {
      expect(isDriftTerminal("resolved_substantive", true)).toBe(false);
    });
  });

  describe("computeDriftRate", () => {
    it("computes (reclassified+absorbed)/filed", () => {
      expect(computeDriftRate({ filed: 10, reclassified: 3, absorbed: 2, substantive: 5 })).toBe(0.5);
    });

    it("returns 0 when none filed", () => {
      expect(computeDriftRate({ filed: 0, reclassified: 0, absorbed: 0, substantive: 0 })).toBe(0);
    });
  });
});
