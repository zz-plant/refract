#!/usr/bin/env bun
/**
 * 05 — Wikidata Editorial Depth
 *
 * Wikidata gives you the current state of a claim ("Einstein's
 * alma mater is ETH Zurich") with references, but no edit history.
 * You don't know if that claim was recently added, has been
 * contested for years, or was originally cited to a different source.
 *
 * Refract tracks the full edit history: when a claim first appeared,
 * how it was reworded, which sources have been attached and
 * replaced, and what policy signals surrounded each change.
 *
 * Usage: bun run examples/05-wikidata-editorial-depth.ts
 */

import { MediaWikiClient } from "@refract-org/ingestion";
import {
  sectionDiffer,
  citationTracker,
  buildSourceLineage,
  templateTracker,
} from "@refract-org/analyzers";
import { createClaimIdentity } from "@refract-org/evidence-graph";

const PAGE = "Albert_Einstein";
const DEPTH = 20;

const client = new MediaWikiClient({ minDelayMs: 200 });

// The default direction returns the newest revisions first; reverse them
// so each pair below runs from the earlier revision to the later one.
const revisions = (await client.fetchRevisions(PAGE, { limit: DEPTH })).reverse();

console.log(`Wikidata tells you the current citation for "${PAGE}".`);
console.log(`Refract tells you the citation history:`);
console.log();

const allSources = buildSourceLineage(
  revisions.map((r) => ({ revId: r.revId, timestamp: r.timestamp, content: r.content })),
);

console.log(`Over ${revisions.length} revisions:`);
console.log(`  Unique sources found: ${allSources.sources.length}`);
console.log(`  Source lineages tracked: ${allSources.lineage.length}`);
console.log();

for (const source of allSources.sources) {
  const status = source.lastSeenRevisionId ? "removed" : "still present";
  console.log(`  source ${source.sourceId.slice(0, 8)}…`);
  console.log(`    url:   ${source.url?.slice(0, 100) ?? "(no url)"}`);
  console.log(`    title: ${source.title?.slice(0, 100) ?? "(no title)"}`);
  console.log(`    type:  ${source.sourceType}`);
  console.log(`    authority: ${source.authority}`);
  console.log(`    added: rev ${source.firstSeenRevisionId} (${source.firstSeenAt.slice(0, 10)})`);
  if (source.lastSeenRevisionId) {
    console.log(`    ${status}: rev ${source.lastSeenRevisionId} (${source.lastSeenAt?.slice(0, 10)})`);
  } else {
    console.log(`    ${status}`);
  }
  if (source.claimsReferencing.length > 0) {
    console.log(`    referenced by claims: ${source.claimsReferencing.length}`);
  }
  console.log();
}

console.log("Current Wikipedia state shows only the surviving sources.");
console.log("Refract shows the full editorial journey — sources that were tried,");
console.log("replaced, or removed, and the claims they supported at each step.");
