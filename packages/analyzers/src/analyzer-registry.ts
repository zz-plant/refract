import type { EvidenceEvent, Revision } from "@refract-org/evidence-graph";

/**
 * A registered analyzer function that processes revisions and emits events.
 */
export interface RegisteredAnalyzer {
  /** Unique name for this analyzer (e.g., "section-differ", "clinicaltrial-status") */
  name: string;
  /** Human-readable description */
  description: string;
  /** The analyzer function: takes revisions, returns events */
  analyze: (revisions: Revision[], options?: Record<string, unknown>) => Promise<EvidenceEvent[]>;
  /** Analyzer version (semver) */
  version: string;
  /** Tags for filtering (e.g., ["structural", "citation", "domain-specific"]) */
  tags?: string[];
}

/**
 * Registry for deterministic analyzers. Allows downstream apps to register
 * custom analyzers without modifying the core package.
 *
 * Built-in analyzers are registered by default. Custom analyzers are
 * namespaced to avoid collisions.
 */
export class AnalyzerRegistry {
  private analyzers = new Map<string, RegisteredAnalyzer>();

  /** Register an analyzer. Overwrites if name already exists. */
  register(analyzer: RegisteredAnalyzer): void {
    this.analyzers.set(analyzer.name, analyzer);
  }

  /** Unregister an analyzer by name */
  unregister(name: string): boolean {
    return this.analyzers.delete(name);
  }

  /** Get a registered analyzer by name */
  get(name: string): RegisteredAnalyzer | undefined {
    return this.analyzers.get(name);
  }

  /** List all registered analyzers, optionally filtered by tag */
  list(tag?: string): RegisteredAnalyzer[] {
    const all = Array.from(this.analyzers.values());
    if (!tag) return all;
    return all.filter((a) => a.tags?.includes(tag));
  }

  /** Run a specific analyzer by name */
  async run(name: string, revisions: Revision[], options?: Record<string, unknown>): Promise<EvidenceEvent[]> {
    const analyzer = this.analyzers.get(name);
    if (!analyzer) {
      throw new Error(
        `Analyzer "${name}" not found. Available: ${this.list()
          .map((a) => a.name)
          .join(", ")}`,
      );
    }
    return analyzer.analyze(revisions, options);
  }

  /** Run all registered analyzers (or all matching a tag) on the given revisions */
  async runAll(
    revisions: Revision[],
    options?: { tag?: string; analyzerOptions?: Record<string, unknown> },
  ): Promise<EvidenceEvent[]> {
    const analyzers = options?.tag ? this.list(options.tag) : this.list();
    const results = await Promise.all(analyzers.map((a) => a.analyze(revisions, options?.analyzerOptions)));
    return results.flat();
  }
}

/** Global registry instance */
export const registry = new AnalyzerRegistry();

import { citationTracker } from "./citation-tracker.js";
import { revertDetector } from "./revert-detector.js";
// Register built-in analyzers
import { sectionDiffer } from "./section-differ.js";
import { templateTracker } from "./template-tracker.js";

registry.register({
  name: "section-differ",
  description: "Section-aware diffs with movement and rename detection",
  version: "0.5.1",
  tags: ["structural"],
  analyze: async (revisions) => {
    if (revisions.length < 2) return [];
    const events: EvidenceEvent[] = [];
    for (let i = 1; i < revisions.length; i++) {
      const before = sectionDiffer.extractSections(revisions[i - 1].content ?? "");
      const after = sectionDiffer.extractSections(revisions[i].content ?? "");
      const changes = sectionDiffer.diffSections(before, after);
      for (const change of changes) {
        events.push({
          eventType: "section_reorganized",
          fromRevisionId: revisions[i - 1].revId,
          toRevisionId: revisions[i].revId,
          section: change.section,
          before: change.fromContent ?? "",
          after: change.toContent ?? "",
          deterministicFacts: [{ fact: `section_${change.changeType}`, detail: change.section }],
          layer: "observed",
          timestamp: revisions[i].timestamp,
        });
      }
    }
    return events;
  },
});

registry.register({
  name: "citation-tracker",
  description: "Tracks citation additions, removals, and replacements",
  version: "0.5.1",
  tags: ["citation"],
  analyze: async (revisions) => {
    if (revisions.length < 2) return [];
    const events: EvidenceEvent[] = [];
    for (let i = 1; i < revisions.length; i++) {
      const before = citationTracker.extractCitations(revisions[i - 1].content ?? "");
      const after = citationTracker.extractCitations(revisions[i].content ?? "");
      const changes = citationTracker.diffCitations(before, after);
      for (const change of changes) {
        if (change.type === "unchanged") continue;
        const eventType =
          change.type === "added"
            ? "citation_added"
            : change.type === "removed"
              ? "citation_removed"
              : "citation_replaced";
        events.push({
          eventType,
          fromRevisionId: revisions[i - 1].revId,
          toRevisionId: revisions[i].revId,
          section: "",
          before: change.before?.raw ?? "",
          after: change.after?.raw ?? "",
          deterministicFacts: [
            {
              fact: `citation_${change.type}`,
              detail: change.after?.url ?? change.before?.url ?? "",
            },
          ],
          layer: "observed",
          timestamp: revisions[i].timestamp,
        });
      }
    }
    return events;
  },
});

registry.register({
  name: "revert-detector",
  description: "Detects reverts via edit comments and revision chains",
  version: "0.5.1",
  tags: ["editorial"],
  analyze: async (revisions) => {
    const chains = revertDetector.detectRevertChain(revisions);
    return chains.map((chain) => ({
      eventType: "revert_detected" as const,
      fromRevisionId: chain.startRevisionId,
      toRevisionId: chain.endRevisionId,
      section: "",
      before: "",
      after: "",
      deterministicFacts: [
        {
          fact: "revert_chain",
          detail: [
            ...(chain.revertedToRevisionId !== undefined ? [`reverted_to=${chain.revertedToRevisionId}`] : []),
            ...(chain.undoneRevisionId !== undefined ? [`undid=${chain.undoneRevisionId}`] : []),
            `participants=${chain.participants}`,
          ].join(" "),
        },
      ],
      layer: "observed",
      timestamp: revisions.find((r) => r.revId === chain.endRevisionId)?.timestamp ?? "",
    }));
  },
});

registry.register({
  name: "template-tracker",
  description: "Tracks Wikipedia policy and maintenance template changes",
  version: "0.5.1",
  tags: ["editorial"],
  analyze: async (revisions) => {
    if (revisions.length < 2) return [];
    const events: EvidenceEvent[] = [];
    for (let i = 1; i < revisions.length; i++) {
      const before = templateTracker.extractTemplates(revisions[i - 1].content ?? "");
      const after = templateTracker.extractTemplates(revisions[i].content ?? "");
      const changes = templateTracker.diffTemplates(before, after);
      for (const change of changes) {
        if (change.type === "unchanged") continue;
        const eventType = change.type === "added" ? "template_added" : "template_removed";
        events.push({
          eventType,
          fromRevisionId: revisions[i - 1].revId,
          toRevisionId: revisions[i].revId,
          section: "",
          before: "",
          after: "",
          deterministicFacts: [
            {
              fact: `template_${change.type}`,
              detail: `${change.template.name} (${change.template.type})`,
            },
          ],
          layer: "observed",
          timestamp: revisions[i].timestamp,
        });
      }
    }
    return events;
  },
});
