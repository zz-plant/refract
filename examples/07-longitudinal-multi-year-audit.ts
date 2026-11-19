#!/usr/bin/env bun
/**
 * 07 — Multi-Year Longitudinal Audit
 *
 * Scan 100% of revision metadata over multiple years at 500 revisions/request,
 * compute full-history monthly velocity, summary & SHA-1 identity reverts, and
 * privacy-preserving pseudonymous revert pairs (Actor_1 ↺ Actor_2), then hydrate
 * stratified longitudinal checkpoints in parallel with SHA-1 deduplication.
 *
 * Usage:
 *   bun run examples/07-longitudinal-multi-year-audit.ts
 *   bun run examples/07-longitudinal-multi-year-audit.ts "Pluto" 2023-01-01
 */

import {
  annotateEvents,
  buildRevisionEvents,
  citationTracker,
  classifyCitationSource,
  computeCertaintyProfile,
  extractCitationIdentifiers,
  sectionDiffer,
} from "@refract-org/analyzers";
import { MediaWikiClient } from "@refract-org/ingestion";

const PAGE = process.argv[2] ?? "Climate change";
const SINCE = process.argv[3] ?? "2024-01-01";

const client = new MediaWikiClient({ minDelayMs: 100 });

console.log(`Scanning multi-year revision metadata for "${PAGE}" since ${SINCE}...`);
const t0 = Date.now();

const history = await client.fetchLongitudinalHistory(PAGE, {
  start: new Date(`${SINCE}T00:00:00Z`),
  direction: "newer",
  maxMetadataRevisions: 5_000,
  maxContentRevisions: 24,
  concurrency: 4,
});

const fetchSec = ((Date.now() - t0) / 1000).toFixed(1);
const { telemetry, revisions } = history;

console.log(
  `\nScanned ${telemetry.totalRevisions} revisions (${telemetry.distinctActors} distinct pseudonymous actors) in ${fetchSec}s`,
);
console.log(
  `Reverts across full window: ${telemetry.summaryReverts} summary reverts, ${telemetry.sha1IdentityReverts} SHA-1 identity reverts`,
);

if (telemetry.topRevertPairs.length > 0) {
  console.log("\nTop pseudonymous revert pairs (zero usernames exposed):");
  for (const [pair, count] of telemetry.topRevertPairs.slice(0, 5)) {
    console.log(`  ${pair}: ${count}`);
  }
}

const peakMonths = [...telemetry.monthlyVelocity].sort((a, b) => b.revisions - a.revisions).slice(0, 5);
if (peakMonths.length > 0) {
  console.log("\nPeak monthly velocity:");
  for (const m of peakMonths) {
    console.log(
      `  ${m.month}: ${m.revisions} revs, ${m.summaryReverts} summary reverts, ${m.sha1IdentityReverts} SHA-1 reverts (${m.distinctActors} actors)`,
    );
  }
}

const t1 = Date.now();
const events = annotateEvents(buildRevisionEvents(revisions), revisions);
const analyzeSec = ((Date.now() - t1) / 1000).toFixed(1);
console.log(`\nHydrated ${revisions.length} stratified checkpoints → built ${events.length} provenance events in ${analyzeSec}s`);

console.log("\nLongitudinal source-tier & lead-certainty checkpoints:");
for (const rev of revisions) {
  const citations = citationTracker.extractCitations(rev.content);
  const tiers: Record<string, number> = { academic: 0, intergovernmental: 0, ngo: 0, news: 0 };
  const ids = new Set<string>();

  for (const c of citations) {
    const t = classifyCitationSource(c);
    if (t in tiers) tiers[t]++;
    const extracted = extractCitationIdentifiers(c);
    if (extracted.doi) ids.add(`doi:${extracted.doi}`);
    if (extracted.isbn) ids.add(`isbn:${extracted.isbn}`);
  }

  const sections = sectionDiffer.extractSections(rev.content);
  const lead = sections.find((s) => !s.title || s.title === "(lead)")?.content ?? rev.content.slice(0, 4000);
  const leadCert = computeCertaintyProfile(lead);

  console.log(
    `  ${rev.timestamp.slice(0, 10)} (r${rev.revId}): refs=${citations.length} DOIs/ISBNs=${ids.size} acad=${tiers.academic} UN/IG=${tiers.intergovernmental} NGO=${tiers.ngo} news=${tiers.news} leadHedge=${leadCert.hedging}`,
  );
}
