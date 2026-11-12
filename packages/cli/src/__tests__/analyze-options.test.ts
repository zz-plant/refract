import type { AnalyzerConfig, EvidenceEvent, Revision } from "@refract-org/evidence-graph";
import { afterEach, describe, expect, it, vi } from "vitest";

const TEXT = "Earth formed about 4.5 billion years ago from the solar nebula.";

function revision(revId: number, timestamp: string, content: string, title = "Earth"): Revision {
  return {
    revId,
    parentId: revId - 1,
    pageId: 1,
    pageTitle: title,
    timestamp,
    user: `Editor${revId}`,
    comment: "",
    content,
    size: content.length,
    minor: false,
  };
}

// Four edits within 30 minutes; the last one renames a section.
const ARTICLE = [
  revision(1, "2010-06-14T10:00:00Z", `Lead.\n\n== Origin ==\n${TEXT}`),
  revision(2, "2010-06-14T10:10:00Z", `Lead one.\n\n== Origin ==\n${TEXT}`),
  revision(3, "2010-06-14T10:20:00Z", `Lead two.\n\n== Origin ==\n${TEXT}`),
  revision(4, "2010-06-14T10:30:00Z", `Lead two.\n\n== Formation ==\n${TEXT}`),
];

// Six talk edits on the 10th, then one a day up to the last article edit.
const TALK = [
  ...[1, 2, 3, 4, 5, 6].map((n) => revision(100 + n, "2010-06-10T12:00:00Z", "", "Talk:Earth")),
  ...[11, 12, 13].map((day) => revision(100 + day, `2010-06-${day}T09:00:00Z`, "", "Talk:Earth")),
  // Made between the first and last analyzed revisions: it opens a thread.
  revision(
    114,
    "2010-06-14T10:15:00Z",
    "== Section name ==\nShould this be Formation? [[User:A|A]] 10:15, 14 June 2010 (UTC)\n",
    "Talk:Earth",
  ),
];

vi.mock("../commands/analyze-helpers.js", async (original) => ({
  ...(await original<typeof import("../commands/analyze-helpers.js")>()),
  fetchRevisionsWithCache: vi.fn(async () => ({
    client: {
      fetchPageMoves: async () => [],
      fetchProtectionLogs: async () => [],
      fetchTalkRevisions: async () => TALK,
    },
    revisions: ARTICLE,
    coverage: undefined,
  })),
}));

import { runAnalyze } from "../commands/analyze.js";

async function analyze(config?: AnalyzerConfig): Promise<EvidenceEvent[]> {
  const { events } = await runAnalyze(
    "Earth",
    "detailed",
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    config,
    { recordObservation: false },
  );
  return events;
}

const details = (events: EvidenceEvent[], type: string) =>
  events.filter((e) => e.eventType === type).map((e) => e.deterministicFacts[0]?.detail);

describe("analyzer options reach the analysis", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits edit clusters and talk spikes at the defaults, and one event for a renamed section", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await analyze();

    expect(details(events, "edit_cluster_detected")).toEqual([
      "revisions=4 editors=4 window_ms=3600000 single_editor=false",
    ]);
    expect(details(events, "talk_activity_spike")).toEqual([
      "date=2010-06-10 talk_edits=6 moving_average=1.0 threshold=3.0 nearby_article_edits=0",
    ]);
    expect(details(events, "section_reorganized")).toContain("change=moved from=Origin");
  });

  it("emits thread events for talk edits made within the analyzed span only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const threads = (await analyze()).filter(
      (e) => e.eventType.startsWith("talk_thread") || e.eventType === "talk_reply_added",
    );

    expect(threads.map((e) => [e.eventType, e.fromRevisionId, e.toRevisionId, e.section])).toEqual([
      ["talk_thread_opened", 113, 114, "Section name"],
    ]);
  });

  it("--cluster-window narrows what counts as a cluster", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await analyze({ editCluster: { windowMs: 5 * 60 * 1000 } });

    expect(details(events, "edit_cluster_detected")).toEqual([]);
  });

  it("--spike-factor raises the spike threshold", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await analyze({ talkSpike: { spikeFactor: 7 } });

    expect(details(events, "talk_activity_spike")).toEqual([]);
  });

  it("--section-rename none reports the rename as a removal and an addition", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sections = details(await analyze({ section: { renameDetection: "none" } }), "section_reorganized");

    expect(sections).not.toContain("change=moved from=Origin");
    expect(sections).toEqual(expect.arrayContaining(["change=added", "change=removed"]));
  });
});
