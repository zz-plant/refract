#!/usr/bin/env bun
/**
 * 02 — Equivalent to WikiWho
 *
 * WikiWho provides token-level attribution — who wrote which word.
 * Refract provides structured evidence — what changed, how, and what
 * policy signals surrounded it.
 *
 * This script produces the WikiWho-equivalent output (who touched
 * what, when) but as structured events with deterministic facts
 * attached, plus citation and template context WikiWho doesn't give you.
 *
 * Usage: bun run examples/02-equivalent-to-wikiwho.ts
 */

import { MediaWikiClient } from "@refract-org/ingestion";
import {
  sectionDiffer,
  citationTracker,
  templateTracker,
  revertDetector,
  classifyHeuristic,
} from "@refract-org/analyzers";
import type { EvidenceEvent, Revision } from "@refract-org/evidence-graph";
import { createEventIdentity } from "@refract-org/evidence-graph";

const PAGE = "Albert_Einstein";
const DEPTH = 15;

const client = new MediaWikiClient({ minDelayMs: 200 });

// The default direction returns the newest revisions first; reverse them
// so each pair below runs from the earlier revision to the later one.
const revisions = (await client.fetchRevisions(PAGE, { limit: DEPTH })).reverse();

console.log(`"${PAGE}" — last ${revisions.length} revisions`);
console.log();
console.log("WikiWho gives you:  editor | token | revision");
console.log("Refract gives you:    event type | section | editor | diff context | citations | templates");
console.log();

const events: EvidenceEvent[] = [];

for (let i = 1; i < revisions.length; i++) {
  const before = revisions[i - 1];
  const after = revisions[i];

  const sections = sectionDiffer.diffSections(
    sectionDiffer.extractSections(before.content),
    sectionDiffer.extractSections(after.content),
  );

  const citations = citationTracker.diffCitations(
    citationTracker.extractCitations(before.content),
    citationTracker.extractCitations(after.content),
  );

  const templates = templateTracker.diffTemplates(
    templateTracker.extractTemplates(before.content),
    templateTracker.extractTemplates(after.content),
  );

  const heuristic = classifyHeuristic(after.comment, after.size - before.size);
  const isRevert = revertDetector.isRevert(after.comment);

  const changedSections = sections
    .filter((s) => s.changeType !== "unchanged")
    .map((s) => s.section)
    .join(", ");

  console.log(`rev ${after.revId} — ${after.timestamp.slice(0, 10)}`);
  console.log(`  editor: ${after.user ?? "(hidden)"}`);
  console.log(`  comment: ${after.comment ? `"${after.comment.slice(0, 80)}"` : "(none)"}`);
  console.log(`  heuristic: ${heuristic}${isRevert ? " [revert]" : ""}`);
  if (changedSections) console.log(`  sections touched: ${changedSections}`);
  const citationSummary = citations
    .filter((c) => c.type !== "unchanged")
    .map((c) => `${c.type} ${c.after?.title ?? c.before?.title ?? ""}`.trim());
  if (citationSummary.length > 0) console.log(`  citations: ${citationSummary.join(", ")}`);
  const templateSummary = templates
    .filter((t) => t.type !== "unchanged")
    .map((t) => `${t.type} ${t.template.name}`);
  if (templateSummary.length > 0) console.log(`  templates: ${templateSummary.join(", ")}`);
  console.log();
}
