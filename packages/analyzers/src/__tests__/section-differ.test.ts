import { describe, expect, it } from "vitest";
import { buildSectionLineage, sectionDiffer } from "../section-differ.js";

describe("buildSectionLineage", () => {
  it("tracks section creation and modification across revisions", () => {
    const revisions = [
      { revId: 1, timestamp: "2024-01-01T00:00:00Z", content: "Lead content" },
      { revId: 2, timestamp: "2024-01-02T00:00:00Z", content: "Lead content\n\n== History ==\nOld history" },
      { revId: 3, timestamp: "2024-01-03T00:00:00Z", content: "Lead content\n\n== History ==\nNew history text" },
    ];

    const lineage = buildSectionLineage(revisions);
    expect(lineage.length).toBeGreaterThan(0);

    const history = lineage.find((l) => l.sectionName === "History");
    expect(history).toBeDefined();
    expect(history?.firstSeenRevisionId).toBe(2);
    expect(history?.events.length).toBeGreaterThanOrEqual(2);
    expect(history?.isActive).toBe(true);
  });

  it("detects section removal", () => {
    const revisions = [
      { revId: 1, timestamp: "2024-01-01T00:00:00Z", content: "Lead\n\n== A ==\nContent A\n\n== B ==\nContent B" },
      { revId: 2, timestamp: "2024-01-02T00:00:00Z", content: "Lead\n\n== A ==\nContent A" },
    ];

    const lineage = buildSectionLineage(revisions);
    const removedB = lineage.find((l) => l.sectionName === "B");
    expect(removedB).toBeDefined();
    expect(removedB?.isActive).toBe(false);
    expect(removedB?.events.some((e) => e.eventType === "removed")).toBe(true);
  });

  it("returns empty array for no revisions", () => {
    expect(buildSectionLineage([])).toEqual([]);
  });

  it("detects renamed sections", () => {
    const revisions = [
      { revId: 1, timestamp: "2024-01-01T00:00:00Z", content: "Lead\n\n== History ==\nSame content" },
      { revId: 2, timestamp: "2024-01-02T00:00:00Z", content: "Lead\n\n== Background ==\nSame content" },
    ];

    const lineage = buildSectionLineage(revisions);
    const renamed = lineage.find((l) => l.sectionName === "Background");
    expect(renamed).toBeDefined();
    expect(renamed?.events.some((e) => e.eventType === "renamed")).toBe(true);
    expect(renamed?.firstSeenRevisionId).toBe(1);
  });

  it("sorts lineages by section name", () => {
    const revisions = [
      { revId: 1, timestamp: "2024-01-01T00:00:00Z", content: "Lead\n\n== Z ==\nZ content\n\n== A ==\nA content" },
    ];

    const lineage = buildSectionLineage(revisions);
    expect(lineage[0].sectionName).toBe("(lead)");
    expect(lineage[1].sectionName).toBe("A");
    expect(lineage[2].sectionName).toBe("Z");
  });
});

describe("extractSections", () => {
  it("extracts lead section when no headers", () => {
    const sections = sectionDiffer.extractSections("Plain text content.");
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("");
  });

  it("extracts sections with headers", () => {
    const wikitext = "Lead\n\n== History ==\nOld history\n\n== References ==\n{{reflist}}";
    const sections = sectionDiffer.extractSections(wikitext);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    const history = sections.find((s) => s.title === "History");
    expect(history).toBeDefined();
    expect(history?.content).toContain("Old history");
  });

  it("parses heading levels", () => {
    const wikitext = "Lead\n\n== Level 2 ==\nContent\n\n=== Level 3 ===\nDeeper";
    const sections = sectionDiffer.extractSections(wikitext);
    const level3 = sections.find((s) => s.title === "Level 3");
    expect(level3).toBeDefined();
    expect(level3?.level).toBe(3);
  });
});

describe("diffSections", () => {
  it("detects added sections", () => {
    const before = sectionDiffer.extractSections("Lead content");
    const after = sectionDiffer.extractSections("Lead content\n\n== New ==\nFresh");
    const changes = sectionDiffer.diffSections(before, after);
    const added = changes.find((c) => c.changeType === "added");
    expect(added).toBeDefined();
    expect(added?.section).toBe("New");
  });

  it("detects removed sections", () => {
    const before = sectionDiffer.extractSections("Lead\n\n== Gone ==\nBye");
    const after = sectionDiffer.extractSections("Lead");
    const changes = sectionDiffer.diffSections(before, after);
    const removed = changes.find((c) => c.changeType === "removed");
    expect(removed).toBeDefined();
  });

  it("detects modified sections", () => {
    const before = sectionDiffer.extractSections("Lead\n\n== Same ==\nOld content");
    const after = sectionDiffer.extractSections("Lead\n\n== Same ==\nNew content");
    const changes = sectionDiffer.diffSections(before, after);
    const modified = changes.find((c) => c.changeType === "modified");
    expect(modified).toBeDefined();
  });

  it("marks unchanged sections", () => {
    const sections = sectionDiffer.extractSections("Lead\n\n== Stable ==\nSame");
    const changes = sectionDiffer.diffSections(sections, sections);
    expect(changes.every((c) => c.changeType === "unchanged")).toBe(true);
  });
});

describe("diffSections rename detection", () => {
  const TEXT = "Earth formed about 4.5 billion years ago from the solar nebula.";
  const before = sectionDiffer.extractSections(`Lead\n\n== Origin ==\n${TEXT}`);
  const renamed = sectionDiffer.extractSections(`Lead\n\n== Formation ==\n${TEXT}`);
  const renamedAndEdited = sectionDiffer.extractSections(`Lead\n\n== Formation ==\n${TEXT} Slowly.`);
  const summary = (changes: ReturnType<typeof sectionDiffer.diffSections>) =>
    changes
      .filter((c) => c.changeType !== "unchanged")
      .map((c) => `${c.changeType}:${c.fromSection ?? ""}>${c.section}`);

  it("reports one moved section by default when the text under a new heading is identical", () => {
    expect(summary(sectionDiffer.diffSections(before, renamed))).toEqual(["moved:Origin>Formation"]);
    expect(summary(sectionDiffer.diffSections(before, renamed, { renameDetection: "exact" }))).toEqual([
      "moved:Origin>Formation",
    ]);
  });

  it("reports a removal and an addition when detection is off", () => {
    expect(summary(sectionDiffer.diffSections(before, renamed, { renameDetection: "none" }))).toEqual([
      "added:>Formation",
      "removed:>Origin",
    ]);
  });

  it("pairs an edited section only in similarity mode, and only above the threshold", () => {
    expect(summary(sectionDiffer.diffSections(before, renamedAndEdited, { renameDetection: "exact" }))).toEqual([
      "added:>Formation",
      "removed:>Origin",
    ]);
    expect(summary(sectionDiffer.diffSections(before, renamedAndEdited, { renameDetection: "similarity" }))).toEqual([
      "moved:Origin>Formation",
    ]);
    expect(
      summary(
        sectionDiffer.diffSections(before, renamedAndEdited, {
          renameDetection: "similarity",
          similarityThreshold: 0.99,
        }),
      ),
    ).toEqual(["added:>Formation", "removed:>Origin"]);
  });
});

describe("sectionDiffer.extractSections on a hostile line", () => {
  it("stays linear on a line of '=' and whitespace", () => {
    // The heading pattern took time cubic or worse in such a line until 2026-09-24.
    const wikitext = `Lead.\n=\t${"\t\t".repeat(2000)}\u0000\n== History ==\nText.`;
    const start = performance.now();
    const sections = sectionDiffer.extractSections(wikitext);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(sections.map((s) => s.title)).toContain("History");
  });
});
