import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FAKE_API, installFakeMediaWiki } from "../../../../tests/support/fake-mediawiki.js";

vi.mock("../commands/cache.js", () => ({
  loadCachedRevisions: vi.fn(() => []),
  saveRevisions: vi.fn(),
}));

import {
  buildCitedDomains,
  buildSharedIdentifiers,
  buildSourceTypeComparison,
  resolveDiffTitles,
  runDiff,
} from "../commands/diff.js";

/**
 * Every test here is a self-diff: the same wiki compared against itself, two or
 * three times over. What is asserted is that identical inputs produce identical
 * output — arithmetic over whatever came back, not anything about what
 * Wikipedia returns. Reaching en.wikipedia.org three times per test (at a
 * 120-second timeout each) added a network dependency to a tautology, and in a
 * sandbox without egress these five failed on a 403.
 */
describe("diff command", () => {
  let restore: () => void;

  beforeAll(() => {
    restore = installFakeMediaWiki();
  });

  afterAll(() => {
    restore();
  });

  it("self-diff produces zero differences", async () => {
    const result = await runDiff("Earth", [FAKE_API, FAKE_API], "brief");

    const { totalEvents, eventTypeDiffs } = result.comparison;

    expect(totalEvents[0]).toBe(totalEvents[1]);

    for (const d of eventTypeDiffs) {
      expect(d.diffs[1]).toBe(0);
    }
  });

  it("runs without error for same wiki self-diff", async () => {
    const result = await runDiff("Earth", [FAKE_API, FAKE_API], "brief");

    expect(result.pageTitle).toBe("Earth");
    expect(result.wikis[0].url).toBe(FAKE_API);
    expect(result.wikis[1].url).toBe(FAKE_API);
    expect(result.generatedAt).toBeTruthy();
  });

  it("handles 3-way diff", async () => {
    const result = await runDiff("Earth", [FAKE_API, FAKE_API, FAKE_API], "brief");

    expect(result.wikis).toHaveLength(3);
    expect(result.comparison.totalEvents).toHaveLength(3);
    expect(result.comparison.totalEvents[0]).toBe(result.comparison.totalEvents[1]);
    expect(result.comparison.totalEvents[1]).toBe(result.comparison.totalEvents[2]);

    for (const d of result.comparison.eventTypeDiffs) {
      expect(d.counts).toHaveLength(3);
    }
  });

  it("returns empty outliers for 2 or fewer wikis", async () => {
    const result = await runDiff("Earth", [FAKE_API, FAKE_API], "brief");
    expect(result.outliers).toHaveLength(0);
  });

  it("returns outliers for 3+ wikis with identical data", async () => {
    const result = await runDiff("Earth", [FAKE_API, FAKE_API, FAKE_API], "brief");

    const outlierEvents = result.outliers.filter((o) => Math.abs(o.zScore) > 2);
    for (const o of outlierEvents) {
      expect(o.count).toBeGreaterThanOrEqual(0);
    }
  });

  it("calculates citation network concentration and supports detectBorrowing", async () => {
    const result = await runDiff("Earth", [FAKE_API, FAKE_API], "brief", {
      detectBorrowing: true,
    });

    expect(result.wikis[0].citationNetwork).toBeDefined();
    expect(result.pairwiseBorrowing).toBeDefined();
    expect(result.pairwiseBorrowing).toHaveLength(1);
    expect(result.pairwiseBorrowing?.[0].sourceWikiLabel).toBe("A");
    expect(result.pairwiseBorrowing?.[0].targetWikiLabel).toBe("B");
    expect(result.pairwiseBorrowing?.[0].propagation.jaccardSimilarity).toBeGreaterThanOrEqual(0);
  });
});

describe("diff titles across languages", () => {
  const EN = "https://en.wikipedia.example/w/api.php";
  const RU = "https://ru.wikipedia.example/w/api.php";
  const NB = "https://no.wikipedia.example/w/api.php";

  function json(body: unknown): Response {
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }

  function stubWikis() {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.get("prop") === "langlinks") {
        return json({
          query: {
            pages: [
              {
                title: "Kaja Kallas",
                langlinks: [
                  { lang: "ru", title: "Каллас, Кая" },
                  { lang: "no", title: "Kaja Kallas (politiker)" },
                ],
              },
            ],
          },
        });
      }
      if (url.searchParams.get("meta") === "siteinfo") {
        const lang = url.hostname.startsWith("no.") ? "nb" : url.hostname.split(".")[0];
        return json({ query: { general: { lang, wikiid: `${lang}wiki`, sitename: "Wikipedia" } } });
      }
      throw new Error(`unexpected request ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("reads the topic everywhere unless asked otherwise", async () => {
    expect(await resolveDiffTitles("Kaja Kallas", [EN, RU])).toEqual(["Kaja Kallas", "Kaja Kallas"]);
  });

  it("uses a title given for a wiki", async () => {
    expect(await resolveDiffTitles("Kaja Kallas", [EN, RU], { titles: [undefined, "Каллас, Кая"] })).toEqual([
      "Kaja Kallas",
      "Каллас, Кая",
    ]);
  });

  it("follows the first wiki's interlanguage links", async () => {
    stubWikis();
    expect(await resolveDiffTitles("Kaja Kallas", [EN, RU], { resolveTitles: true })).toEqual([
      "Kaja Kallas",
      "Каллас, Кая",
    ]);
  });

  it("matches a wiki by its host prefix when its content language differs", async () => {
    stubWikis();
    expect(await resolveDiffTitles("Kaja Kallas", [EN, NB], { resolveTitles: true })).toEqual([
      "Kaja Kallas",
      "Kaja Kallas (politiker)",
    ]);
  });

  it("names the --title to give when there is no link", async () => {
    stubWikis();
    const DE = "https://de.wikipedia.example/w/api.php";
    await expect(resolveDiffTitles("Kaja Kallas", [EN, RU, DE], { resolveTitles: true })).rejects.toThrow(
      /--title c=<title>/,
    );
  });
});

describe("buildCitedDomains", () => {
  it("lists every domain with each wiki's count, most cited first", () => {
    const network = (domainDistribution: Record<string, number>) => ({
      citationNetwork: {
        uniqueSourceCount: 0,
        domainDistribution,
        topSources: [],
        sourceConcentrationIndex: 0,
        isHighConcentration: false,
      },
    });
    expect(
      buildCitedDomains([
        network({ "a.example": 3, "b.example": 1, unknown: 9 }),
        network({ "b.example": 4, "c.example": 1 }),
      ]),
    ).toEqual([
      { domain: "b.example", counts: [1, 4] },
      { domain: "a.example", counts: [3, 0] },
      { domain: "c.example", counts: [0, 1] },
    ]);
  });

  it("compares shared DOIs/ISBNs and structural source types across wikis", () => {
    const wikiA = {
      citationNetwork: {
        uniqueSourceCount: 3,
        domainDistribution: { "doi.org": 2, "ohchr.org": 1 },
        sourceTypeDistribution: { academic: 2, intergovernmental: 1 },
        sharedIdentifiers: { dois: ["10.1080/14623528.2024.111", "10.1000/only-en"], isbns: ["9780199535569"] },
        topSources: [],
        sourceConcentrationIndex: 0.5,
        isHighConcentration: true,
      },
    };
    const wikiB = {
      citationNetwork: {
        uniqueSourceCount: 2,
        domainDistribution: { "doi.org": 1, "amnesty.org": 1 },
        sourceTypeDistribution: { academic: 1, ngo: 1 },
        sharedIdentifiers: { dois: ["10.1080/14623528.2024.111"], isbns: ["9780199535569"] },
        topSources: [],
        sourceConcentrationIndex: 0.5,
        isHighConcentration: false,
      },
    };

    const shared = buildSharedIdentifiers([wikiA, wikiB]);
    expect(shared).toEqual([
      {
        kind: "doi",
        identifier: "10.1080/14623528.2024.111",
        presentOnWikis: [true, true],
        sharedCount: 2,
      },
      {
        kind: "isbn",
        identifier: "9780199535569",
        presentOnWikis: [true, true],
        sharedCount: 2,
      },
      {
        kind: "doi",
        identifier: "10.1000/only-en",
        presentOnWikis: [true, false],
        sharedCount: 1,
      },
    ]);

    const sourceTypes = buildSourceTypeComparison([wikiA, wikiB]);
    expect(sourceTypes).toEqual([
      { sourceType: "academic", counts: [2, 1] },
      { sourceType: "intergovernmental", counts: [1, 0] },
      { sourceType: "ngo", counts: [0, 1] },
    ]);
  });
});
