import type { AnalyzerConfig, EvidenceEvent, Revision } from "@refract-org/evidence-graph";
import { redactEditorIdentity } from "./redact-editor-identity.js";

const DEFAULT_WINDOW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export type TalkCorrelationOptions = AnalyzerConfig["talkCorrelation"];

export function correlateTalkRevisions(
  articleRevs: Revision[],
  talkRevs: Revision[],
  options?: AnalyzerConfig["talkCorrelation"],
): EvidenceEvent[] {
  const windowBefore = options?.windowBeforeMs ?? DEFAULT_WINDOW_BEFORE_MS;
  const windowAfter = options?.windowAfterMs ?? DEFAULT_WINDOW_AFTER_MS;
  const events: EvidenceEvent[] = [];

  if (articleRevs.length === 0 || talkRevs.length === 0) return events;

  const sortedTalk = [...talkRevs].map((r) => ({ r, ts: new Date(r.timestamp).getTime() }));
  sortedTalk.sort((a, b) => a.ts - b.ts);

  const articleTimes = articleRevs.map((r) => new Date(r.timestamp).getTime());

  for (let a = 0; a < articleRevs.length; a++) {
    const article = articleRevs[a];
    const articleTime = articleTimes[a];
    const windowStart = articleTime - windowBefore;
    const windowEnd = articleTime + windowAfter;

    let closest: Revision | null = null;
    let closestDelta = Infinity;

    for (let t = 0; t < sortedTalk.length; t++) {
      const talkTime = sortedTalk[t].ts;
      if (talkTime < windowStart) continue;
      if (talkTime > windowEnd) break;

      const delta = Math.abs(talkTime - articleTime);
      if (delta < closestDelta) {
        closestDelta = delta;
        closest = sortedTalk[t].r;
      }
    }

    if (closest) {
      const deltaHours = Math.round((closestDelta / (1000 * 60 * 60)) * 10) / 10;
      events.push({
        eventType: "talk_page_correlated",
        fromRevisionId: article.revId,
        toRevisionId: closest.revId,
        section: "",
        before: "",
        after: "",
        deterministicFacts: [
          {
            fact: "talk_page_correlated",
            detail: `time_delta_hours=${deltaHours} talk_comment=${redactEditorIdentity(closest.comment).slice(0, 200)}`,
          },
        ],
        layer: "observed",
        timestamp: closest.timestamp,
      });
    }
  }

  return events;
}
