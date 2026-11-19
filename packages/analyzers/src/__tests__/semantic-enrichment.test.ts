import type { EvidenceEvent } from "@refract-org/evidence-graph";
import { describe, expect, it } from "vitest";
import {
  buildSemanticEnrichmentProvenance,
  computeSourceSnapshotHash,
  enrichEvidenceEvent,
} from "../semantic-enrichment.js";

function makeEvent(overrides?: Partial<EvidenceEvent>): EvidenceEvent {
  return {
    eventType: "sentence_first_seen",
    fromRevisionId: 1,
    toRevisionId: 2,
    section: "body",
    before: "",
    after: "The study demonstrated significant results.",
    deterministicFacts: [],
    layer: "observed",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildSemanticEnrichmentProvenance", () => {
  it("produces identical Merkle roots for identical parameters and snapshots", () => {
    const params = {
      sourceSnapshotHash: computeSourceSnapshotHash(makeEvent()),
      parameterFootprint: { depth: "brief", profileHedges: true },
      effectiveAt: "2026-01-01T00:00:00Z",
    };

    const a = buildSemanticEnrichmentProvenance(params);
    const b = buildSemanticEnrichmentProvenance(params);

    expect(a.merkleRoot).toBe(b.merkleRoot);
    expect(a.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different Merkle roots when the parameter footprint changes", () => {
    const baseParams = {
      sourceSnapshotHash: computeSourceSnapshotHash(makeEvent({ after: "Data showed a reduction." })),
      parameterFootprint: { depth: "brief", profileHedges: true },
      effectiveAt: "2026-01-01T00:00:00Z",
    };

    const unchanged = buildSemanticEnrichmentProvenance(baseParams);
    const changed = buildSemanticEnrichmentProvenance({
      ...baseParams,
      parameterFootprint: { ...baseParams.parameterFootprint, depth: "full" },
    });

    expect(unchanged.merkleRoot).not.toBe(changed.merkleRoot);
  });

  it("produces different Merkle roots when the source snapshot changes", () => {
    const eventA = makeEvent({ after: "The trial was conclusive." });
    const eventB = makeEvent({ after: "The trial was inconclusive." });

    const params = {
      parameterFootprint: { depth: "brief" },
      effectiveAt: "2026-01-01T00:00:00Z",
    };

    const a = buildSemanticEnrichmentProvenance({
      sourceSnapshotHash: computeSourceSnapshotHash(eventA),
      ...params,
    });
    const b = buildSemanticEnrichmentProvenance({
      sourceSnapshotHash: computeSourceSnapshotHash(eventB),
      ...params,
    });

    expect(a.merkleRoot).not.toBe(b.merkleRoot);
  });

  it("returns all required FactProvenance fields", () => {
    const provenance = buildSemanticEnrichmentProvenance({
      sourceSnapshotHash: computeSourceSnapshotHash(makeEvent()),
      parameterFootprint: { depth: "brief" },
      effectiveAt: "2026-01-01T00:00:00Z",
    });

    expect(provenance.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.sourceSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.parameterFootprint).toEqual({ depth: "brief" });
    expect(provenance.effectiveAt).toBe("2026-01-01T00:00:00Z");
    expect(provenance.analyzer).toBe("@refract-org/analyzers/semantic-enrichment");
    expect(provenance.inputHashes).toEqual([provenance.sourceSnapshotHash]);
  });
});

describe("enrichEvidenceEvent", () => {
  it("computes the six enrichment fields", () => {
    const event = makeEvent({ after: "The study demonstrated robust effects (p < 0.05)." });
    const result = enrichEvidenceEvent(event);

    expect(result.editMagnitude).toBe("minor");
    expect(result.contentChange).toBe("introduction");
    expect(result.keyTerms).toContain("robust");
    expect(result.certaintyProfile.high).toBeGreaterThan(0);
    expect(result.quantitativeFindings.length).toBeGreaterThan(0);
  });

  it("attaches a FactProvenance block keyed to source snapshot and parameters", () => {
    const event = makeEvent({ after: "The study demonstrated robust effects." });
    const parameters = { depth: "brief" };
    const result = enrichEvidenceEvent(event, { parameters });

    expect(result.provenance.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(result.provenance.sourceSnapshotHash).toBe(computeSourceSnapshotHash(event));
    expect(result.provenance.parameterFootprint).toEqual(parameters);
    expect(result.provenance.effectiveAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("computes certainty profiles and extracts key terms on Arabic revision text", () => {
    const event = makeEvent({
      before: "يزعم التقرير أنه ربما هناك معلومات غير واضح مصدرها.",
      after: "أكدت الدراسات الأكاديمية وأجمع الباحثون على ما يثبت هذه النتائج، ومع ذلك بقيت بعض التفاصيل قيد النقاش.",
    });
    const result = enrichEvidenceEvent(event);

    expect(result.certaintyProfile.high).toBeGreaterThanOrEqual(2);
    expect(result.certaintyProfile.hedging).toBeGreaterThanOrEqual(1);
    expect(result.directionSignal).toBe("strengthening");
    expect(result.keyTerms).toContain("الدراسات");
    expect(result.keyTerms).toContain("الأكاديمية");
  });
});
