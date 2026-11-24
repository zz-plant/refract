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
  const meta = (revId: number, hours: number, sha1: string): RevisionMetadata => ({
    revId,
    parentId: revId - 1,
    pageId: 1,
    pageTitle: "P",
    timestamp: new Date(START + hours * HOUR).toISOString(),
    comment: "",
    size: 10,
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
