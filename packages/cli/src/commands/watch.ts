import {
  citationTracker,
  redactEditorIdentity,
  revertDetector,
  sectionDiffer,
  templateTracker,
} from "@refract-org/analyzers";
import type { EvidenceEvent, EvidenceLayer } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { MediaWikiClient } from "@refract-org/ingestion";

const DEFAULT_POLL_INTERVAL_MS = 60_000;

export async function runWatch(
  pageTitle: string,
  section?: string,
  apiUrl?: string,
  intervalMs?: number,
  auth?: AuthConfig,
): Promise<void> {
  const pollInterval = intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const client = new MediaWikiClient(apiUrl ? { apiUrl, auth } : auth ? { auth } : undefined);
  console.log(`Watching "${pageTitle}"${section ? ` section="${section}"` : ""}`);
  console.log(`Polling every ${pollInterval / 1000}s. Press Ctrl+C to stop.\n`);

  let lastSeenRevId = 0;

  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      // The latest five. "newer" with a limit returned the page's first five,
      // so a watch never saw a revision made after it started.
      const revisions = await client.fetchRevisions(pageTitle, { limit: 5, direction: "older" });
      if (revisions.length === 0) return;

      const sortedRevs = [...revisions].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      const newRevs = sortedRevs.filter((r) => r.revId > lastSeenRevId);
      if (newRevs.length === 0) return;

      if (lastSeenRevId === 0) {
        const latest = sortedRevs[sortedRevs.length - 1];
        console.log(
          `[${new Date().toISOString()}] Initial watch — latest revision: ${latest.revId} (${latest.timestamp})`,
        );
        lastSeenRevId = latest.revId;
        return;
      }

      for (const rev of newRevs) {
        const events: EvidenceEvent[] = [];
        const layer: EvidenceLayer = "observed";

        const prevIdx = sortedRevs.findIndex((r) => r.revId === rev.revId) - 1;
        if (prevIdx >= 0) {
          const before = sortedRevs[prevIdx];
          const citeChanges = citationTracker.diffCitations(
            citationTracker.extractCitations(before.content),
            citationTracker.extractCitations(rev.content),
          );

          for (const cit of citeChanges) {
            if (cit.type === "unchanged") continue;
            events.push({
              eventType:
                cit.type === "added"
                  ? "citation_added"
                  : cit.type === "removed"
                    ? "citation_removed"
                    : "citation_replaced",
              fromRevisionId: before.revId,
              toRevisionId: rev.revId,
              section: "body",
              before: cit.before?.raw ?? "",
              after: cit.after?.raw ?? "",
              deterministicFacts: [{ fact: "citation_changed", detail: `type=${cit.type}` }],
              layer,
              timestamp: rev.timestamp,
            });
          }

          const tplChanges = templateTracker.diffTemplates(
            templateTracker.extractTemplates(before.content),
            templateTracker.extractTemplates(rev.content),
          );
          for (const tpl of tplChanges) {
            if (tpl.type === "unchanged") continue;
            events.push({
              eventType: tpl.type === "added" ? "template_added" : "template_removed",
              fromRevisionId: before.revId,
              toRevisionId: rev.revId,
              section: "body",
              before: "",
              after: tpl.template.name,
              deterministicFacts: [{ fact: "template_changed", detail: `name=${tpl.template.name} type=${tpl.type}` }],
              layer,
              timestamp: rev.timestamp,
            });
          }

          if (revertDetector.isRevert(rev.comment)) {
            events.push({
              eventType: "revert_detected",
              fromRevisionId: before.revId,
              toRevisionId: rev.revId,
              section: "",
              before: "",
              after: redactEditorIdentity(rev.comment),
              deterministicFacts: [{ fact: "revert_detected", detail: redactEditorIdentity(rev.comment) }],
              layer,
              timestamp: rev.timestamp,
            });
          }

          const secChanges = sectionDiffer.diffSections(
            sectionDiffer.extractSections(before.content),
            sectionDiffer.extractSections(rev.content),
          );
          for (const sc of secChanges) {
            if (sc.changeType === "unchanged") continue;
            if (section && sc.section !== section) continue;
            events.push({
              eventType: "section_reorganized",
              fromRevisionId: before.revId,
              toRevisionId: rev.revId,
              section: sc.section,
              before: sc.fromContent ?? "",
              after: sc.toContent ?? "",
              deterministicFacts: [{ fact: "section_changed", detail: `change=${sc.changeType}` }],
              layer,
              timestamp: rev.timestamp,
            });
          }
        }

        console.log(`\n[${rev.timestamp}] NEW REVISION ${rev.revId}`);
        console.log(`  Comment: ${rev.comment || "(none)"}`);
        console.log(`  Size: ${rev.size} bytes`);
        if (events.length > 0) {
          console.log(`  Events: ${events.length}`);
          for (const e of events) {
            console.log(`    - ${e.eventType} ${e.deterministicFacts.map((f) => f.detail).join(", ")}`);
          }
        }
      }

      lastSeenRevId = sortedRevs[sortedRevs.length - 1].revId;
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Watch error:`, (err as Error).message);
    } finally {
      running = false;
      // Rescheduled here rather than after the try: its early returns — the
      // first poll always takes one — skipped the reschedule, so the process
      // exited after one poll.
      if (!stopped) {
        timer = setTimeout(poll, pollInterval);
      }
    }
  };

  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  await poll();

  const shutdown = () => {
    stopped = true;
    clearTimeout(timer);
    console.log("\nWatch stopped.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
