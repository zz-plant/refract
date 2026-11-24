import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_API, installFakeMediaWiki } from "../../../../tests/support/fake-mediawiki.js";
import { describeLive } from "../../../../tests/support/live.js";
import { MediaWikiClient } from "../mediawiki-client.js";

const STABLE_PAGE = "Earth";

/**
 * Split by what each test is actually about. The first asserts that a revision
 * and a diff coming back from MediaWiki carry the fields this client promises —
 * a claim about Wikipedia's response, which only the real API can settle. The
 * other two are about Refract's own analyzers, and a fixture serves them
 * without weakening anything.
 */
describeLive("Integration: MediaWiki response contract", () => {
  it("fetches revisions for a stable page and produces valid shape", { timeout: 60000 }, async () => {
    const client = new MediaWikiClient({ minDelayMs: 100 });
    const revisions = await client.fetchRevisions(STABLE_PAGE, {
      limit: 5,
      direction: "newer",
    });

    expect(revisions.length).toBeGreaterThanOrEqual(2);

    for (const rev of revisions) {
      expect(rev).toHaveProperty("revId");
      expect(rev).toHaveProperty("pageId");
      expect(rev).toHaveProperty("pageTitle");
      expect(rev).toHaveProperty("timestamp");
      expect(rev).toHaveProperty("comment");
      expect(rev).toHaveProperty("content");
      expect(rev).toHaveProperty("size");
      expect(rev).toHaveProperty("minor");

      expect(typeof rev.revId).toBe("number");
      expect(rev.revId).toBeGreaterThan(0);
      expect(typeof rev.pageId).toBe("number");
      expect(rev.pageId).toBeGreaterThan(0);
      expect(rev.pageTitle).toContain(STABLE_PAGE);
      expect(typeof rev.timestamp).toBe("string");
      expect(typeof rev.size).toBe("number");
      expect(typeof rev.minor).toBe("boolean");

      expect(rev.content.length).toBeGreaterThan(0);
    }

    const sorted = [...revisions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (let i = 1; i < sorted.length; i++) {
      const before = sorted[i - 1];
      const after = sorted[i];

      const diff = await client.fetchDiff(before.revId, after.revId);
      expect(diff).toHaveProperty("fromRevId", before.revId);
      expect(diff).toHaveProperty("toRevId", after.revId);
      expect(diff).toHaveProperty("lines");
      expect(diff).toHaveProperty("sections");
      expect(diff).toHaveProperty("sizeDelta");
      expect(typeof diff.sizeDelta).toBe("number");
      expect(Array.isArray(diff.lines)).toBe(true);

      for (const line of diff.lines) {
        expect(line).toHaveProperty("type");
        expect(line).toHaveProperty("content");
        expect(line).toHaveProperty("lineNumber");
        expect(["added", "removed", "unchanged"]).toContain(line.type);
        expect(typeof line.lineNumber).toBe("number");
      }
    }
  });

  // `refract linksearch` reads list=exturlusage and follows its continuation,
  // whose key has changed between MediaWiki versions. A domain linked from far
  // more than one 500-link batch makes the second request happen.
  it("lists pages linking to a domain across a continuation", { timeout: 60000 }, async () => {
    const client = new MediaWikiClient({ minDelayMs: 100 });
    const links = await client.fetchExternalLinkUsage("nytimes.com", { maxLinks: 600 });

    expect(links).toHaveLength(600);
    for (const link of links) {
      expect(typeof link.pageId).toBe("number");
      expect(link.pageId).toBeGreaterThan(0);
      expect(link.namespace).toBe(0);
      expect(typeof link.title).toBe("string");
      expect(link.url).toMatch(/^https?:\/\/([^/]*\.)?nytimes\.com/i);
    }
    // The second batch is new links, not the first one again.
    const firstBatch = new Set(links.slice(0, 500).map((l) => `${l.pageId} ${l.url}`));
    expect(links.slice(500).some((l) => !firstBatch.has(`${l.pageId} ${l.url}`))).toBe(true);
  });

  // `refract diff --resolve-titles` reads prop=langlinks on one wiki and
  // meta=siteinfo on another to find a page's title in another language.
  it("reads interlanguage links and another wiki's language", { timeout: 60000 }, async () => {
    const english = new MediaWikiClient({ minDelayMs: 100 });
    const links = await english.fetchLanguageLinks("Estonia");
    expect(links.length).toBeGreaterThan(50);
    for (const link of links) {
      expect(typeof link.lang).toBe("string");
      expect(typeof link.title).toBe("string");
    }
    expect(links.find((l) => l.lang === "et")?.title).toBe("Eesti");

    const russian = new MediaWikiClient({ apiUrl: "https://ru.wikipedia.org/w/api.php", minDelayMs: 100 });
    expect(await russian.fetchSiteInfo()).toMatchObject({ lang: "ru", wikiId: "ruwiki" });
  });

  // resolveTitle reads a bare titles= query: a page with no prop, flagged
  // missing or invalid rather than left out.
  it("resolves a redirect, a talk page, a missing page and an invalid title", { timeout: 60000 }, async () => {
    const client = new MediaWikiClient({ minDelayMs: 100 });
    expect(await client.resolveTitle("UK")).toEqual({ pageId: 31717, title: "United Kingdom", ns: 0 });
    expect(await client.resolveTitle("Talk:Pluto")).toEqual({ pageId: 186148, title: "Talk:Pluto", ns: 1 });
    expect(await client.resolveTitle("ThisPageDoesNotExistXYZ123")).toBeNull();
    expect(await client.resolveTitle("<>")).toBeNull();
  });

  // fetchSections batches revids= with rvsection; a revision without the
  // section is flagged nosuchsection on its own instead of failing the batch.
  it("reads one section of several revisions in one request", { timeout: 60000 }, async () => {
    const client = new MediaWikiClient({ minDelayMs: 100 });
    // Pluto's first revision (2001) and one from 2026.
    const leads = await client.fetchSections([273963, 1387362520], 0);
    expect(leads.get(273963)).toMatch(/^<b>Pluto<\/b> is the ninth and smallest \[\[planet\]\]/);
    expect(leads.get(1387362520)?.length).toBeGreaterThan(1000);

    const fifth = await client.fetchSections([273963, 1387362520], 5);
    expect([...fifth.keys()]).toEqual([1387362520]);
    expect(fifth.get(1387362520)).toMatch(/^=== Planet X disproved ===/);
  });

  // revisionAt relies on rvstart being inclusive going older, and rvstartid
  // starting at that revision going newer.
  it("finds the revision live at a moment and its neighbours", { timeout: 60000 }, async () => {
    const client = new MediaWikiClient({ minDelayMs: 100 });
    const at = await client.revisionAt("Pluto", "2001-11-25T00:00:00Z", { around: 1 });
    expect(at.revision).toMatchObject({ revId: 273964, timestamp: "2001-11-20T01:24:21Z", size: 2117 });
    expect(at.revision?.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(at.before.map((m) => m.revId)).toEqual([273963]);
    expect(at.after.map((m) => m.revId)).toEqual([273965]);

    const exact = await client.revisionAt("Pluto", "2001-11-20T01:24:21Z", { around: 0 });
    expect(exact.revision?.revId).toBe(273964);
  });

  // Protection levels sit in three places by era: details since about 2015,
  // a description string before that, and the comment before 2009.
  it("reads protection levels and reasons from each era of the log", { timeout: 60000 }, async () => {
    const client = new MediaWikiClient({ minDelayMs: 100 });
    const logs = await client.fetchProtectionLogs("Anarchism");
    const byId = new Map(logs.map((l) => [l.logId, { level: l.level, reasonCategory: l.reasonCategory }]));
    expect(byId.get(116237384)).toEqual({ level: "semi", reasonCategory: "disruption" });
    expect(byId.get(51255393)).toEqual({ level: "full", reasonCategory: "content_dispute" });
    expect(byId.get(5482523)).toEqual({ level: "full", reasonCategory: "content_dispute" });
  });
});

describe("Integration: analyzers over revision content", () => {
  let restore: () => void;

  beforeAll(() => {
    restore = installFakeMediaWiki();
  });

  afterAll(() => {
    restore();
  });

  it("section differ extracts sections from revision content", async () => {
    const client = new MediaWikiClient({ apiUrl: FAKE_API });
    const revisions = await client.fetchRevisions(STABLE_PAGE, {
      limit: 1,
      direction: "newer",
    });
    expect(revisions.length).toBeGreaterThan(0);

    const { sectionDiffer } = await import("../../../analyzers/dist/src/index.js");
    const sections = sectionDiffer.extractSections(revisions[0].content);
    expect(sections.length).toBeGreaterThan(0);

    for (const section of sections) {
      expect(section).toHaveProperty("title");
      expect(section).toHaveProperty("level");
      expect(section).toHaveProperty("content");
      expect(section).toHaveProperty("byteOffset");
      expect(typeof section.title).toBe("string");
      expect(typeof section.level).toBe("number");
      expect(typeof section.byteOffset).toBe("number");
    }
  });

  it("revert detector identifies reverts in edit comments", { timeout: 5000 }, async () => {
    const { revertDetector } = await import("../../../analyzers/dist/src/index.js");

    expect(revertDetector.isRevert("Reverted to previous version")).toBe(true);
    expect(revertDetector.isRevert("Undid revision 12345 by User (talk)")).toBe(true);
    expect(revertDetector.isRevert("rvv")).toBe(true);
    expect(revertDetector.isRevert("Fixed typo in introduction")).toBe(false);
    expect(revertDetector.isRevert("Added new section on climate")).toBe(false);
  });
});
