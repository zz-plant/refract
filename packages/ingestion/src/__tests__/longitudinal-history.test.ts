import { afterEach, describe, expect, it } from "vitest";
import {
  FAKE_API,
  type FakeHistoryRevision,
  fakeMediaWikiStats,
  installFakeMediaWiki,
} from "../../../../tests/support/fake-mediawiki.js";
import {
  findRevertedStates,
  MediaWikiClient,
  type RevisionMetadata,
  selectLongitudinalRevisions,
  yearlyPressure,
} from "../mediawiki-client.js";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2020, 0, 1);

/**
 * Forty days of one edit a day, each adding a sentence, with vandalism every
 * fifth day that the next edit, an hour later, reverts by restoring the text
 * before it. Day 30's vandalism stays up for three days before its revert.
 */
function vandalisedHistory(): FakeHistoryRevision[] {
  const history: FakeHistoryRevision[] = [];
  let text = "Intro.";
  let revid = 100;
  for (let day = 0; day < 40; day++) {
    text += ` Fact ${day}.`;
    history.push({ revid: revid++, timestamp: new Date(START + day * 24 * HOUR).toISOString(), content: text });
    if (day % 5 === 4) {
      const lag = day === 29 ? 72 * HOUR : HOUR;
      history.push({
        revid: revid++,
        timestamp: new Date(START + day * 24 * HOUR + 10 * 60 * 1000).toISOString(),
        content: `is still gay (day ${day})`,
      });
      history.push({
        revid: revid++,
        timestamp: new Date(START + day * 24 * HOUR + 10 * 60 * 1000 + lag).toISOString(),
        content: text,
        comment: "Reverted edits by [[Special:Contributions/1.2.3.4|1.2.3.4]] to last version",
      });
    }
  }
  return history.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("findRevertedStates", () => {
  const meta = (revId: number, hours: number, sha1: string, size = 10): RevisionMetadata => ({
    revId,
    parentId: revId - 1,
    pageId: 1,
    pageTitle: "P",
    timestamp: new Date(START + hours * HOUR).toISOString(),
    comment: "",
    size,
    minor: false,
    sha1,
  });

  it("marks every state between a restored revision and its restoration", () => {
    const reverted = findRevertedStates([
      meta(1, 0, "a"),
      meta(2, 1, "b"),
      meta(3, 2, "c"),
      meta(4, 3, "a"),
      meta(5, 4, "d"),
    ]);
    expect([...reverted]).toEqual([2, 3]);
  });

  it("measures the window from the first reverted edit, not from the state restored", () => {
    // State "a" stood for a year; the vandalism lasted an hour.
    const reverted = findRevertedStates([meta(1, 0, "a"), meta(2, 24 * 365, "b"), meta(3, 24 * 365 + 1, "a")]);
    expect([...reverted]).toEqual([2]);
  });

  it("keeps states that stood longer than the window, and null edits", () => {
    expect(findRevertedStates([meta(1, 0, "a"), meta(2, 1, "b"), meta(3, 60, "a")]).size).toBe(0);
    expect(findRevertedStates([meta(1, 0, "a"), meta(2, 1, "a")]).size).toBe(0);
    expect(findRevertedStates([meta(1, 0, "a"), meta(2, 1, "b"), meta(3, 60, "a")], 72).size).toBe(1);
    expect(findRevertedStates([meta(1, 0, "a"), meta(2, 1, "b"), meta(3, 60, "a")], { windowHours: 72 }).size).toBe(1);
  });

  /** Rows as `[revId, timestamp, size, sha1]`, from a page's real metadata with each sha1 replaced by a letter. */
  const rows = (entries: Array<[number, string, number, string]>): RevisionMetadata[] =>
    entries.map(([revId, timestamp, size, sha1]) => ({ ...meta(revId, 0, sha1, size), timestamp }));

  it("catches Pluto's October 2021 paste-over by its exact restoration", () => {
    // An editor pasted a much older version over the article and others edited
    // on top of it for two days; "restoring page before insanity" (1050517063)
    // put back 1049857924's text byte for byte. The window runs from the first
    // undone state, 35.6 hours before the restoration; from the state restored,
    // it would be 96.9, and none of it would count.
    const pluto = rows([
      [1049857924, "2021-10-14T08:15:23Z", 145703, "b"],
      [1050278205, "2021-10-16T21:32:31Z", 145896, "c"],
      [1050482319, "2021-10-18T03:17:11Z", 117752, "d"],
      [1050483293, "2021-10-18T03:26:27Z", 100957, "e"],
      [1050485259, "2021-10-18T03:46:00Z", 45639, "i"],
      [1050490141, "2021-10-18T04:28:50Z", 45233, "s"],
      [1050490453, "2021-10-18T04:31:26Z", 145896, "c"],
      [1050495750, "2021-10-18T05:21:42Z", 45233, "s"],
      [1050496444, "2021-10-18T05:29:48Z", 145896, "c"],
      [1050497206, "2021-10-18T05:38:25Z", 45233, "s"],
      [1050497590, "2021-10-18T05:42:52Z", 45040, "t"],
      [1050509393, "2021-10-18T07:47:24Z", 46466, "{"],
      [1050517063, "2021-10-18T09:11:15Z", 145703, "b"],
    ]);
    const undone = pluto.slice(1, -1).map((m) => m.revId);
    expect([...findRevertedStates(pluto, { nearRestorations: false })].sort()).toEqual(undone.sort());
    expect([...findRevertedStates(pluto)].sort()).toEqual(undone.sort());
  });

  describe("near-restorations", () => {
    it("catch a state repaired by hand, which no sha1 matches", () => {
      // Anarchism, 13 October 2004: a third of the article deleted, then put
      // back by hand 42 bytes short.
      const anarchism = rows([
        [6539824, "2004-10-13T04:04:05Z", 75821, "a"],
        [6539886, "2004-10-13T04:15:03Z", 50570, "b"],
        [6540619, "2004-10-13T04:18:41Z", 75779, "c"],
        [6540818, "2004-10-13T05:07:47Z", 50576, "d"],
        [6549053, "2004-10-13T05:21:12Z", 24326, "e"],
      ]);
      expect([...findRevertedStates(anarchism)]).toEqual([6539886]);
      expect(findRevertedStates(anarchism, { nearRestorations: false }).size).toBe(0);
    });

    it("mark the states between a large size change and a return to within 1% of the size before it", () => {
      const pasteOver = [
        meta(1, 0, "current", 100_000),
        meta(2, 24, "old version pasted over", 40_000),
        meta(3, 25, "edit on the pasted version", 40_100),
        meta(4, 27, "repaired by hand", 100_400),
        meta(5, 50, "next edit", 100_500),
      ];
      expect([...findRevertedStates(pasteOver)]).toEqual([2, 3]);
      expect(findRevertedStates(pasteOver, { nearRestorations: false }).size).toBe(0);
    });

    it("keep a large edit that is not undone", () => {
      const expansion = [
        meta(1, 0, "a", 50_000),
        meta(2, 1, "doubled", 100_000),
        meta(3, 2, "copyedit", 100_200),
        meta(4, 3, "trimmed back a little", 98_000),
      ];
      expect(findRevertedStates(expansion).size).toBe(0);
    });

    it("keep a large edit whose size comes back only after the window, or only to within 2%", () => {
      expect(findRevertedStates([meta(1, 0, "a", 10_000), meta(2, 1, "b", 5_000), meta(3, 60, "c", 10_050)]).size).toBe(
        0,
      );
      expect(findRevertedStates([meta(1, 0, "a", 10_000), meta(2, 1, "b", 5_000), meta(3, 2, "c", 10_200)]).size).toBe(
        0,
      );
    });

    it("keep an edit under 30%", () => {
      expect(findRevertedStates([meta(1, 0, "a", 10_000), meta(2, 1, "b", 7_100), meta(3, 2, "c", 10_000)]).size).toBe(
        0,
      );
    });

    it("measure a change only from a state that survived", () => {
      // Pluto, November 2006: a vandal cut a section twice and was reverted
      // each time. Measured from the cut state, the revert is a 41% change,
      // and the second cut lands within 1% of the first.
      const history = [
        meta(1, 0, "good", 48_847),
        meta(2, 1, "section cut", 34_687),
        meta(3, 2, "good", 48_847),
        meta(4, 3, "copyedit", 48_882),
        meta(5, 4, "section cut again", 34_700),
        meta(6, 5, "copyedit", 48_882),
      ];
      expect([...findRevertedStates(history)]).toEqual([2, 5]);
    });

    it("count a large edit undone by hand and then redone, the trade-off they make", () => {
      const redone = [
        meta(1, 0, "a", 10_000),
        meta(2, 1, "expanded", 20_000),
        meta(3, 2, "undone by hand", 10_010),
        meta(4, 3, "expanded again", 20_000),
      ];
      expect([...findRevertedStates(redone)]).toEqual([2]);
    });

    it("count ordinary edits that end the window within 1% of where they began", () => {
      // Anarchism, January 2003: 596134 added a list of links, and 599522 moved
      // it to the talk page. 599522 and 600841 are ordinary edits, counted
      // because the size came back within 1% of 22,025 bytes only at 600890.
      const anarchism = rows([
        [596130, "2003-01-18T07:17:05Z", 22025, "g"],
        [596134, "2003-01-18T07:20:12Z", 30539, "h"],
        [596433, "2003-01-18T07:22:26Z", 25844, "i"],
        [599522, "2003-01-18T11:10:56Z", 21244, "j"],
        [600841, "2003-01-19T11:13:24Z", 21343, "k"],
        [600890, "2003-01-19T21:54:40Z", 21840, "l"],
      ]);
      expect([...findRevertedStates(anarchism)]).toEqual([596134, 596433, 599522, 600841]);
    });
  });
});

describe("selectLongitudinalRevisions timeCoverage", () => {
  const at = (iso: string, i: number, size = 1_000 + (i % 7) * 50): RevisionMetadata => ({
    revId: i + 1,
    parentId: i,
    pageId: 1,
    pageTitle: "P",
    timestamp: iso,
    comment: "",
    size,
    minor: false,
    sha1: `s${i}`,
  });

  /** Ten years of one edit a quarter, and 2,000 edits in March 2013. */
  function burstHistory(): RevisionMetadata[] {
    const stamps: string[] = [];
    for (let year = 2010; year < 2020; year++) {
      for (const month of ["01", "04", "07", "10"]) stamps.push(`${year}-${month}-15T00:00:00Z`);
    }
    for (let i = 0; i < 2_000; i++) {
      stamps.push(new Date(Date.UTC(2013, 2, 1) + i * 20 * 60 * 1000).toISOString());
    }
    return stamps.sort().map((iso, i) => at(iso, i));
  }

  const perYear = (selected: RevisionMetadata[]) => {
    const counts = new Map<string, number>();
    for (let year = 2010; year < 2020; year++) counts.set(String(year), 0);
    for (const m of selected) counts.set(m.timestamp.slice(0, 4), (counts.get(m.timestamp.slice(0, 4)) ?? 0) + 1);
    return counts;
  };

  it("keeps a burst of edits from starving the quiet years", () => {
    const history = burstHistory();
    // The month anchors are spaced by position, so the burst takes most of them.
    const byPosition = perYear(selectLongitudinalRevisions(history, 60));
    expect([...byPosition.values()].filter((n) => n === 0).length).toBeGreaterThan(0);

    const selected = selectLongitudinalRevisions(history, 60, { timeCoverage: 0.75 });
    expect(selected.length).toBeLessThanOrEqual(60);
    for (const [year, n] of perYear(selected)) expect(n, year).toBeGreaterThanOrEqual(3);
    expect(selected[0].revId).toBe(history[0].revId);
    expect(selected[selected.length - 1].revId).toBe(history[history.length - 1].revId);
  });

  it("gives each checkpoint the last revision at or before it, and spare slots to high-signal picks", () => {
    // Two revisions a decade apart and a busy final week: most checkpoints
    // land on the first revision, which is counted once.
    const history = [
      at("2010-01-01T00:00:00Z", 0, 100),
      ...Array.from({ length: 50 }, (_, i) =>
        at(`2020-01-0${1 + Math.floor(i / 10)}T0${i % 10}:00:00Z`, i + 1, 100 + i * i),
      ),
    ];
    const selected = selectLongitudinalRevisions(history, 20, { timeCoverage: 1 });
    expect(selected).toHaveLength(20);
    expect(selected.filter((m) => m.timestamp < "2020").map((m) => m.revId)).toEqual([1]);
  });

  it("picks checkpoints among surviving states with excludeRevertedStates", () => {
    const history = burstHistory();
    // Every burst edit is a state some later burst edit undid.
    const vandalised = history.map((m) => (m.timestamp.startsWith("2013-03") ? { ...m, sha1: "burst" } : m));
    const reverted = findRevertedStates(vandalised);
    const selected = selectLongitudinalRevisions(vandalised, 40, { timeCoverage: 0.75, excludeRevertedStates: true });
    expect(selected.some((m) => reverted.has(m.revId))).toBe(false);
  });

  it("rejects a share outside 0 to 1", () => {
    expect(() => selectLongitudinalRevisions(burstHistory(), 60, { timeCoverage: 1.5 })).toThrow(RangeError);
    expect(() => selectLongitudinalRevisions(burstHistory(), 60, { timeCoverage: Number.NaN })).toThrow(RangeError);
  });
});

describe("yearlyPressure", () => {
  const rev = (revId: number, timestamp: string, sha1: string, size = 1_000): RevisionMetadata => ({
    revId,
    parentId: revId - 1,
    pageId: 1,
    pageTitle: "P",
    timestamp,
    comment: "",
    size,
    minor: false,
    sha1,
  });

  // 2019: an edit, vandalism and its revert. 2020: nothing. 2021: two edits.
  const metadata = [
    rev(1, "2019-03-01T00:00:00Z", "a"),
    rev(2, "2019-03-01T01:00:00Z", "vandalised"),
    rev(3, "2019-03-01T02:00:00Z", "a"),
    rev(4, "2021-06-01T00:00:00Z", "b"),
    rev(5, "2021-07-01T00:00:00Z", "c"),
  ];
  const protections = [
    { timestamp: "2019-03-02T00:00:00Z", action: "protect" as const, reasonCategory: "vandalism" as const },
    { timestamp: "2021-06-02T00:00:00Z", action: "modify" as const, reasonCategory: "content_dispute" as const },
    { timestamp: "2021-06-09T00:00:00Z", action: "unprotect" as const, reasonCategory: "other" as const },
  ];

  it("counts edits, reverted states, talk edits and protections per year, with quiet years as zeros", () => {
    const talkTimestamps = ["2019-03-01T03:00:00Z", "2020-05-01T00:00:00Z", "2020-05-02T00:00:00Z"];
    expect(yearlyPressure(metadata, { talkTimestamps, protections })).toEqual([
      {
        year: 2019,
        edits: 3,
        revertedEdits: 1,
        revertedShare: 1 / 3,
        talkEdits: 1,
        protections: 1,
        contentDisputeProtections: 0,
      },
      {
        year: 2020,
        edits: 0,
        revertedEdits: 0,
        revertedShare: null,
        talkEdits: 2,
        protections: 0,
        contentDisputeProtections: 0,
      },
      {
        year: 2021,
        edits: 2,
        revertedEdits: 0,
        revertedShare: 0,
        talkEdits: 0,
        protections: 1,
        contentDisputeProtections: 1,
      },
    ]);
  });

  it("uses reverted states it is given", () => {
    const rows = yearlyPressure(metadata, { talkTimestamps: [], protections: [], revertedStates: new Set([4, 5]) });
    expect(rows.map((r) => [r.year, r.revertedEdits])).toEqual([
      [2019, 0],
      [2020, 0],
      [2021, 2],
    ]);
  });

  it("is empty with nothing to count", () => {
    expect(yearlyPressure([], { talkTimestamps: [], protections: [] })).toEqual([]);
  });
});

describe("fetchLongitudinalHistory", () => {
  const client = () => new MediaWikiClient({ apiUrl: FAKE_API, minDelayMs: 0 });

  it("leaves reverted states out of the sample by default and fills the slots with surviving states", async () => {
    const history = vandalisedHistory();
    restore = installFakeMediaWiki({ history });
    const result = await client().fetchLongitudinalHistory("Stoicism", { maxContentRevisions: 30 });

    expect(result.metadata).toHaveLength(history.length);
    expect(result.revisions).toHaveLength(30);
    const vandalised = result.revisions.filter((r) => r.content.startsWith("is still gay")).map((r) => r.content);
    // Only the vandalism that stood longer than the window remains eligible.
    expect(vandalised.every((c) => c === "is still gay (day 29)")).toBe(true);
    // Seven hour-long vandalisms are excluded; day 30's stood 72 hours and is kept.
    expect(result.coverage).toMatchObject({
      revertedStatesExcluded: 7,
      revertedStateWindowHours: 48,
      truncated: false,
    });
    // Telemetry still reads every revision.
    expect(result.telemetry.totalRevisions).toBe(history.length);
    expect(result.telemetry.sha1IdentityReverts).toBe(8);
  });

  it("reports which reverted-state rules applied, and takes timeCoverage", async () => {
    const history = vandalisedHistory();
    restore = installFakeMediaWiki({ history });
    const result = await client().fetchLongitudinalHistory("Stoicism", {
      maxContentRevisions: 30,
      timeCoverage: 0.75,
      excludeRevertedStates: { nearRestorations: false },
    });
    expect(result.coverage).toMatchObject({ revertedStateWindowHours: 48, revertedStateNearRestorations: false });
    expect(result.selectedMetadata.map((m) => m.revId)).toEqual(
      selectLongitudinalRevisions(result.metadata, 30, {
        timeCoverage: 0.75,
        excludeRevertedStates: { nearRestorations: false },
      }).map((m) => m.revId),
    );
  });

  it("keeps reverted states with excludeRevertedStates: false, as selectLongitudinalRevisions does", async () => {
    const history = vandalisedHistory();
    restore = installFakeMediaWiki({ history });
    const result = await client().fetchLongitudinalHistory("Stoicism", {
      maxContentRevisions: 30,
      excludeRevertedStates: false,
    });
    const vandalised = result.revisions.filter((r) => r.content.startsWith("is still gay")).length;
    expect(vandalised).toBeGreaterThan(0);
    expect(result.coverage.revertedStatesExcluded).toBe(0);
    expect(selectLongitudinalRevisions(result.metadata, 30).map((m) => m.revId)).toEqual(
      result.selectedMetadata.map((m) => m.revId),
    );
  });

  it("reads the whole history by default and flags a limit that cut it short", async () => {
    const history = Array.from({ length: 1203 }, (_, i) => ({
      revid: 10_000 + i,
      timestamp: new Date(START + i * HOUR).toISOString(),
      content: `Revision ${i}`,
    }));
    restore = installFakeMediaWiki({ history });

    const full = await client().fetchLongitudinalHistory("World War II", { maxContentRevisions: 10 });
    expect(full.metadata).toHaveLength(1203);
    expect(full.coverage).toMatchObject({ metadataRevisions: 1203, truncated: false });
    expect(full.coverage.maxMetadataRevisions).toBeUndefined();

    const cut = await client().fetchLongitudinalHistory("World War II", {
      maxContentRevisions: 10,
      maxMetadataRevisions: 700,
    });
    expect(cut.metadata).toHaveLength(700);
    expect(cut.coverage).toMatchObject({ truncated: true, maxMetadataRevisions: 700, direction: "older" });
    // "older" keeps the newest rows.
    expect(cut.metadata[cut.metadata.length - 1].revId).toBe(10_000 + 1202);

    const exact = await client().fetchLongitudinalHistory("World War II", {
      maxContentRevisions: 10,
      maxMetadataRevisions: 1203,
    });
    expect(exact.coverage.truncated).toBe(false);
  });

  it("hydrates with at most three requests in flight by default", async () => {
    const history = Array.from({ length: 400 }, (_, i) => ({
      revid: 20_000 + i,
      timestamp: new Date(START + i * HOUR).toISOString(),
      content: `Revision ${i}`,
    }));
    restore = installFakeMediaWiki({ history });
    const result = await client().fetchLongitudinalHistory("Pluto", { maxContentRevisions: 400 });
    expect(result.revisions).toHaveLength(400);
    const hydrations = fakeMediaWikiStats.requests.filter((u) => u.searchParams.has("revids"));
    expect(hydrations).toHaveLength(8);
    expect(fakeMediaWikiStats.maxInFlight).toBe(3);
  });
});
