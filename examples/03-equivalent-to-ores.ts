#!/usr/bin/env bun
/**
 * 03 — Equivalent to ORES
 *
 * ORES provides a black-box ML score ("this edit is damaging with
 * 87% probability"). You cannot reproduce it, audit it, or explain
 * why a particular score was assigned.
 *
 * Refract's L1 analyzers produce the same classifications
 * deterministically — no model, no hidden state, byte-for-byte
 * reproducible. Each label comes with the rule that produced it.
 *
 * This script classifies each edit using only deterministic rules
 * and explains why each label was assigned.
 *
 * Usage: bun run examples/03-equivalent-to-ores.ts
 */

import { MediaWikiClient } from "@refract-org/ingestion";
import {
  classifyHeuristic,
  revertDetector,
  templateTracker,
  sectionDiffer,
} from "@refract-org/analyzers";

const PAGE = "Donald_Trump";
const DEPTH = 20;

const client = new MediaWikiClient({ minDelayMs: 200 });

// The default direction returns the newest revisions first; reverse them
// so each pair below runs from the earlier revision to the later one.
const revisions = (await client.fetchRevisions(PAGE, { limit: DEPTH })).reverse();

console.log(`ORES:  "edit is damaging (p=0.87)" — unanswerable, unverifiable`);
console.log(`Refract: "revert detected (matched revert pattern in comment)" — reproducible`);
console.log();
console.log(`Classifying last ${revisions.length} edits of "${PAGE}":`);
console.log();

for (let i = 1; i < revisions.length; i++) {
  const before = revisions[i - 1];
  const after = revisions[i];

  const sizeDelta = after.size - before.size;
  const classification = classifyHeuristic(after.comment, sizeDelta);

  const revertChain = revertDetector.detectRevertChain(
    revisions.slice(Math.max(0, i - 3), i + 1),
  );

  const templates = templateTracker.diffTemplates(
    templateTracker.extractTemplates(before.content),
    templateTracker.extractTemplates(after.content),
  ).filter((t) => t.type !== "unchanged");

  const sectionChanges = sectionDiffer.diffSections(
    sectionDiffer.extractSections(before.content),
    sectionDiffer.extractSections(after.content),
  ).filter((s) => s.changeType !== "unchanged");

  const explanation = explainClassification(
    classification,
    after.comment,
    sizeDelta,
    revertChain.length > 0,
  );

  console.log(`rev ${after.revId}`);
  console.log(`  ORES equivalent: ${classification}`);
  console.log(`  why: ${explanation}`);
  console.log(`  size delta: ${sizeDelta > 0 ? "+" : ""}${sizeDelta} bytes`);
  console.log(`  comment: "${after.comment.slice(0, 120)}"`);
  if (revertChain.length > 0) {
    console.log(`  revert chain: ${revertChain.length} edits`);
  }
  if (templates.length > 0) {
    console.log(`  template changes: ${templates.map((t) => `${t.type} ${t.template.name}`).join(", ")}`);
  }
  if (sectionChanges.length > 0) {
    console.log(`  sections: ${sectionChanges.map((s) => `${s.changeType} "${s.section}"`).join(", ")}`);
  }
  console.log();
}

function explainClassification(
  kind: string,
  comment: string,
  sizeDelta: number,
  isRevertChain: boolean,
): string {
  switch (kind) {
    case "revert":
      return `edit summary "${comment}" matches revert pattern (rv|undo|rollback)`;
    case "vandalism":
      return `edit summary contains vandalism marker (vandal|spam|blanking)`;
    case "sourcing":
      return `edit summary references citation/source keywords (ref|cite|source)`;
    case "major_addition":
      return `added ${sizeDelta} bytes (threshold: >2000) with sourcing intent`;
    case "major_removal":
      return `removed ${Math.abs(sizeDelta)} bytes (threshold: <-2000)`;
    case "cosmetic":
      return `changed ${Math.abs(sizeDelta)} bytes with empty comment`;
    case "minor":
      return `changed ${Math.abs(sizeDelta)} bytes (threshold: <100)`;
    default:
      return "no heuristic matched — unclassified (not revert, vandalism, sourcing, or size-significant)";
  }
}
