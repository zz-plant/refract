import { annotateEvents, buildRevisionEvents } from "@refract-org/analyzers";
import { createEventIdentity } from "@refract-org/evidence-graph";
import { onboardingPageTitle, onboardingRevisions } from "../onboarding-sample.js";

export async function runInit(options: { json?: boolean } = {}): Promise<void> {
  const events = annotateEvents(buildRevisionEvents(onboardingRevisions, { depth: "detailed" }));
  for (const event of events) {
    event.deterministicFacts.push({ fact: "source_kind", detail: "fictional_onboarding_sample" });
    event.deterministicFacts.push({ fact: "source_page", detail: onboardingPageTitle });
    event.eventId = createEventIdentity(event);
  }

  if (options.json) {
    for (const event of events) console.log(JSON.stringify(event));
    return;
  }

  console.log();
  console.log("  Refract is a git log for Wikipedia.");
  console.log("  This offline example uses five fictional revisions of Rivergate Library.");
  console.log("  The text, dates, revision IDs, and reference URL are sample data.");
  console.log();

  const explanations: Record<string, string> = {
    sentence_modified: "Matched wording changed between these revisions.",
    citation_removed: "A reference disappeared; its significance needs review.",
    sentence_removed: "Previously observed wording has no match in the next revision.",
    sentence_reintroduced: "Previously observed wording returned in this sample history.",
  };
  for (const event of events) {
    const explanation = explanations[event.eventType];
    if (!explanation) continue;
    console.log(
      `  ${event.timestamp.slice(0, 10)}  ${event.eventType} (sample revision ${event.fromRevisionId} → ${event.toRevisionId})`,
    );
    if (event.before) console.log(`    Before: ${event.before}`);
    if (event.after) console.log(`    After:  ${event.after}`);
    console.log(`    ${explanation}`);
    console.log();
  }

  console.log("  Source inputs: packages/cli/src/onboarding-sample.ts in the Refract repository.");
  console.log("  The events above are computed by the same analyzers used for wiki revisions.");
  console.log();
  console.log("  Try the data workflow offline:");
  console.log("    refract init --json > sample-events.ndjson");
  console.log();
  console.log("  Try the review workflow offline:");
  console.log("    refract review --sample --from 1 --state-dir ./review-state");
  console.log("  Changes stay pending until you acknowledge the report.");
  console.log();
  console.log("  Then try a real page (requires network access):");
  console.log('    refract claim "Pluto" --text "ninth and smallest" --from 71593043 --to 71601937');
  console.log("  This follows one sentence through an hour on the day Pluto was reclassified.");
  console.log();
  console.log("  Get one of those changes as NDJSON events:");
  console.log('    refract analyze "Pluto" --from 71593165 --to 71593296 --depth detailed --json');
  console.log();
  console.log("  See what a page said on a date:");
  console.log('    refract snapshot "Bitcoin" --at 2024-01-15');
  console.log();
  console.log("  View a timeline in your browser:");
  console.log('    refract explore "Bitcoin"');
  console.log("  This starts a local server; Ctrl+C stops it.");
  console.log();
  console.log("  Walkthrough and recipes: https://github.com/refract-org/refract/blob/main/docs/recipes.md");
  console.log("  Full docs: https://zz-plant.github.io/refract/");
  console.log();
}
