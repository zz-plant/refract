#!/usr/bin/env bun
/**
 * 04 — From Scratch to Refract
 *
 * If you've ever built a Wikipedia analysis tool, you've probably
 * written: (1) a revision fetcher, (2) a wikitext section parser,
 * (3) a citation extractor, (4) a revert detector, (5) a template
 * classifier, and (6) a diff engine. That's ~800 lines of brittle
 * code that breaks when Wikimedia changes their API response format.
 *
 * Refract gives you all six in ~200 lines you don't write.
 *
 * This script shows the "from scratch" pipeline you're rebuilding
 * every time, then shows the Refract equivalent.
 *
 * Usage: bun run examples/04-from-scratch-to-refract.ts
 */

import { MediaWikiClient } from "@refract-org/ingestion";
import {
  sectionDiffer,
  citationTracker,
  revertDetector,
  templateTracker,
  classifyHeuristic,
} from "@refract-org/analyzers";
import { createEventIdentity, createReplayManifest } from "@refract-org/evidence-graph";
import type { EvidenceEvent } from "@refract-org/evidence-graph";

const PAGE = "CRISPR";
const DEPTH = 10;

const client = new MediaWikiClient({ minDelayMs: 200 });
// Newest first by default; reversed so pairs run from earlier to later.
const revisions = (await client.fetchRevisions(PAGE, { limit: DEPTH })).reverse();

console.log(`=== From Scratch ===`);
console.log(`When you build Wikipedia analysis yourself, you write:`);
console.log();
console.log(`  1. fetchRevisions()     — API pagination, rate limiting, error handling`);
console.log(`  2. extractSections()    — regex-based wikitext section splitter`);
console.log(`  3. diffSections()       — section-level diff (add/remove/modify/move)`);
console.log(`  4. extractCitations()   — <ref> tag parser with URL/title extraction`);
console.log(`  5. diffCitations()      — citation-level add/remove/replace`);
console.log(`  6. extractTemplates()   — {{template}} parser with parameter extraction`);
console.log(`  7. diffTemplates()      — template-level add/remove`);
console.log(`  8. isRevert()           — comment pattern matching (rv|undo|rollback)`);
console.log(`  9. detectRevertChain()  — multi-revision revert sequence detection`);
console.log(`  10. classifyHeuristic() — size-delta + comment heuristic classification`);
console.log();
console.log(`~800 lines of fragile code that breaks when Wikimedia changes APIs.`);
console.log();

console.log(`=== Refract Equivalent ===`);
console.log(`3 imports. 1 client. 6 analyzer calls. ~20 lines of glue.`);
console.log();

const events: EvidenceEvent[] = [];

for (let i = 1; i < revisions.length; i++) {
  const before = revisions[i - 1];
  const after = revisions[i];

  const sectionChanges = sectionDiffer.diffSections(
    sectionDiffer.extractSections(before.content),
    sectionDiffer.extractSections(after.content),
  );

  const citeChanges = citationTracker.diffCitations(
    citationTracker.extractCitations(before.content),
    citationTracker.extractCitations(after.content),
  );

  const templateChanges = templateTracker.diffTemplates(
    templateTracker.extractTemplates(before.content),
    templateTracker.extractTemplates(after.content),
  );

  const isRevert = revertDetector.isRevert(after.comment);
  const heuristic = classifyHeuristic(after.comment, after.size - before.size);

  for (const c of sectionChanges.filter((s) => s.changeType !== "unchanged")) {
    events.push({
      eventType: "section_reorganized",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: c.section,
      before: "",
      after: "",
      deterministicFacts: [
        { fact: `section "${c.section}" ${c.changeType}` },
      ],
      layer: "observed",
      timestamp: after.timestamp,
    });
  }

  for (const c of citeChanges.filter((c) => c.type !== "unchanged")) {
    events.push({
      eventType: `citation_${c.type}` as EvidenceEvent["eventType"],
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: "",
      before: c.before?.raw ?? "",
      after: c.after?.raw ?? "",
      deterministicFacts: [
        { fact: `citation ${c.type}`, detail: c.after?.title ?? c.before?.title ?? "" },
      ],
      layer: "observed",
      timestamp: after.timestamp,
    });
  }

  if (isRevert) {
    events.push({
      eventType: "revert_detected",
      fromRevisionId: before.revId,
      toRevisionId: after.revId,
      section: "",
      before: "",
      after: "",
      deterministicFacts: [
        { fact: `revert detected`, detail: `heuristic: ${heuristic}` },
      ],
      layer: "observed",
      timestamp: after.timestamp,
    });
  }
}

console.log(`Pipeline ran on ${revisions.length} revisions, produced ${events.length} events.`);
console.log();

for (const e of events) {
  console.log(`  [${e.timestamp.slice(0, 10)}] ${e.eventType} (rev ${e.fromRevisionId}→${e.toRevisionId})`);
  for (const f of e.deterministicFacts) {
    console.log(`    ${f.fact}${f.detail ? `: ${f.detail}` : ""}`);
  }
}

console.log();
console.log("Bonus: replay manifest (cryptographic audit trail of inputs → outputs)");
const manifest = createReplayManifest({
  pageTitle: PAGE,
  analyzerVersions: {
    "section-differ": "0.2.1",
    "citation-tracker": "0.2.1",
    "revert-detector": "0.2.1",
    "template-tracker": "0.2.1",
    "heuristic-classifier": "0.2.1",
  },
  revisions,
  events,
});
console.log(`  manifest hash: ${manifest.manifestHash}`);
console.log(`  input revisions hashed: ${manifest.inputRevisionHashes.length}`);
console.log(`  output events hashed: ${manifest.outputEventHashes.length}`);
