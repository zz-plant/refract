import type { AnalyzerConfig, EvidenceEvent, Revision } from "@refract-org/evidence-graph";

const DEFAULT_SPIKE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_SPIKE_FACTOR = 3.0;
const DEFAULT_MA_PERIODS = 4;
const DEFAULT_FLOOR_THRESHOLD = 3;

export type TalkActivityOptions = AnalyzerConfig["talkSpike"];

export interface TalkActivityResult {
  spikes: EvidenceEvent[];
  activityByDay: Array<{ date: string; count: number }>;
  movingAverage: number;
}

export function detectTalkActivitySpikes(
  talkRevisions: Revision[],
  articleRevisions: Revision[],
  options?: AnalyzerConfig["talkSpike"],
  /**
   * The end of the lookback window. Default: now. Pass the last analyzed
   * revision's time so the same revisions give the same spikes on any day.
   */
  referenceTime?: string | Date,
): TalkActivityResult {
  const windowMs = options?.lookbackWindowMs ?? DEFAULT_SPIKE_WINDOW_MS;
  const spikeFactor = options?.spikeFactor ?? DEFAULT_SPIKE_FACTOR;
  const maPeriods = options?.movingAveragePeriods ?? DEFAULT_MA_PERIODS;
  const floorThreshold = options?.floorThreshold ?? DEFAULT_FLOOR_THRESHOLD;
  const spikes: EvidenceEvent[] = [];

  if (talkRevisions.length === 0) {
    return { spikes, activityByDay: [], movingAverage: 0 };
  }

  const dailyCounts = bucketByDay(talkRevisions);
  const sortedDays = Object.keys(dailyCounts).sort();

  if (sortedDays.length < maPeriods) {
    return { spikes, activityByDay: dailyActivity(dailyCounts), movingAverage: 0 };
  }

  const recentEnd = referenceTime === undefined ? Date.now() : new Date(referenceTime).getTime();
  const recentStart = recentEnd - windowMs;
  const recentDays = sortedDays.filter((d) => {
    const t = new Date(d).getTime();
    return t >= recentStart && t <= recentEnd;
  });

  const movingAverages: number[] = [];
  for (let i = maPeriods - 1; i < sortedDays.length; i++) {
    let sum = 0;
    for (let j = i - (maPeriods - 1); j <= i; j++) {
      sum += dailyCounts[sortedDays[j]];
    }
    movingAverages.push(sum / maPeriods);
  }

  const latestMA = movingAverages.length > 0 ? movingAverages[movingAverages.length - 1] : 0;
  const threshold = Math.max(latestMA * spikeFactor, floorThreshold);

  for (const day of recentDays) {
    const count = dailyCounts[day];
    if (count >= threshold) {
      const nearbyArticleEdits = articleRevisions.filter((r) => {
        const t = new Date(r.timestamp);
        const dayStart = new Date(day).getTime();
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        return t.getTime() >= dayStart && t.getTime() < dayEnd;
      });

      spikes.push({
        eventType: "talk_activity_spike",
        fromRevisionId: 0,
        toRevisionId: 0,
        section: "",
        before: "",
        after: "",
        deterministicFacts: [
          {
            fact: "talk_activity_spike",
            detail: `date=${day} talk_edits=${count} moving_average=${latestMA.toFixed(1)} threshold=${threshold.toFixed(1)} nearby_article_edits=${nearbyArticleEdits.length}`,
          },
        ],
        layer: "observed",
        timestamp: new Date(day).toISOString(),
      });
    }
  }

  return {
    spikes,
    activityByDay: dailyActivity(dailyCounts),
    movingAverage: latestMA,
  };
}

function bucketByDay(revisions: Revision[]): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (const r of revisions) {
    const day = r.timestamp.slice(0, 10);
    buckets[day] = (buckets[day] ?? 0) + 1;
  }
  return buckets;
}

function dailyActivity(counts: Record<string, number>): Array<{ date: string; count: number }> {
  return Object.entries(counts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
