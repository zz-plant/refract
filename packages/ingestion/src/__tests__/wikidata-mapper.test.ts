import { describe, expect, it, vi } from "vitest";
import {
  diffWikidataStatements,
  fetchWikidataEntity,
  fetchWikidataId,
  mapPagesToEntities,
  mapPageToEntity,
  parseWikidataEntity,
  wikidataEntityToEvents,
  wikidataStatementHistory,
} from "../wikidata-mapper.js";

describe("fetchWikidataId", () => {
  it("returns null when page has no Wikidata ID", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: { "-1": { title: "NoSuchPage" } } } }),
    });

    const result = await fetchWikidataId("NoSuchPage");
    expect(result).toBeNull();
  });

  it("returns QID when pageprops contains wikibase_item", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: { pages: { "123": { pageprops: { wikibase_item: "Q42" } } } },
      }),
    });

    const result = await fetchWikidataId("Douglas_Adams");
    expect(result).toBe("Q42");
  });

  it("returns null on fetch error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const result = await fetchWikidataId("SomePage");
    expect(result).toBeNull();
  });
});

describe("mapPageToEntity", () => {
  it("returns empty qid when no Wikidata ID found", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: { "-1": {} } } }),
    });

    const result = await mapPageToEntity("NoPage");
    expect(result.qid).toBe("");
    expect(result.pageTitle).toBe("NoPage");
    expect(result.entity).toBeUndefined();
  });

  it("returns entity when Wikidata ID is found", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: { pages: { "123": { pageprops: { wikibase_item: "Q1" } } } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: {
            Q1: {
              labels: { en: { value: "Universe" } },
              descriptions: { en: { value: "everything" } },
              aliases: {},
              claims: {
                P31: [
                  {
                    mainsnak: {
                      snaktype: "value",
                      datavalue: { type: "wikibase-item", value: { id: "Q2" } },
                    },
                  },
                ],
                P569: [
                  {
                    mainsnak: {
                      snaktype: "value",
                      datavalue: { type: "time", value: { time: "+1800-01-01T00:00:00Z" } },
                    },
                  },
                ],
              },
            },
          },
        }),
      });

    globalThis.fetch = fetchMock;

    const result = await mapPageToEntity("Universe");
    expect(result.qid).toBe("Q1");
    expect(result.entity?.label).toBe("Universe");
    expect(result.entity?.description).toBe("everything");
    expect(result.entity?.instanceOf).toEqual(["Q2"]);
    expect(Object.keys(result.entity?.claims ?? {})).toHaveLength(2); // P31 (instance of) + P569 (date of birth)
  });
});

describe("mapPagesToEntities", () => {
  it("maps multiple pages concurrently", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: { "-1": {} } } }),
    });

    const results = await mapPagesToEntities(["PageA", "PageB", "PageC"], 2);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.qid === "")).toBe(true);
  });
});

describe("wikidataEntityToEvents", () => {
  it("generates events from entity data", () => {
    const entity = {
      qid: "Q42",
      label: "Test",
      description: "A test entity",
      aliases: [],
      instanceOf: ["Q5"],
      claims: {
        P31: {
          property: "P31",
          propertyLabel: "instance of",
          values: [{ type: "wikibase-item" as const, value: "Q5" }],
        },
      },
    };

    const events = wikidataEntityToEvents(entity, "Test_Page");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].eventType).toBe("sentence_first_seen");
    expect(events[0].deterministicFacts[0].fact).toBe("wikidata_entity_linked");
  });
});

// Wikidata's own serialization: entity IDs as wikibase-entityid, times with a
// precision, statements with IDs, ranks, qualifiers and references.
const item = (id: string) => ({ snaktype: "value", datavalue: { type: "wikibase-entityid", value: { id } } });
const time = (iso: string, precision = 11) => ({
  snaktype: "value",
  datavalue: { type: "time", value: { time: iso, precision } },
});
function office(holder: string, options: { start?: string; end?: string; rank?: string; references?: number } = {}) {
  const qualifiers: Record<string, unknown[]> = {};
  if (options.start) qualifiers.P580 = [time(options.start)];
  if (options.end) qualifiers.P582 = [time(options.end)];
  return {
    id: `Q100-${holder}`,
    rank: options.rank ?? "normal",
    mainsnak: { ...item(holder), property: "P488" },
    qualifiers,
    references: Array.from({ length: options.references ?? 0 }, () => ({})),
  };
}
const entityJson = (statements: unknown[]) => ({
  id: "Q100",
  labels: { en: { value: "Example Society" } },
  claims: { P31: [{ id: "Q100-type", rank: "normal", mainsnak: item("Q43229") }], P488: statements },
});

describe("parseWikidataEntity", () => {
  it("reads statement IDs, ranks, qualifiers with precision, and reference counts", () => {
    const entity = parseWikidataEntity(
      "Q100",
      entityJson([
        office("Q1", { start: "+2015-06-01T00:00:00Z", end: "+2024-01-15T00:00:00Z", references: 2 }),
        office("Q2", { start: "+2024-01-15T00:00:00Z", rank: "preferred" }),
        { id: "Q100-unknown", rank: "normal", mainsnak: { snaktype: "somevalue", property: "P488" } },
      ]),
    );

    expect(entity.instanceOf).toEqual(["Q43229"]);
    expect(entity.claims.P488.values.map((v) => v.value)).toEqual(["Q1", "Q2"]);
    expect(entity.statements?.filter((s) => s.property === "P488")).toEqual([
      {
        id: "Q100-Q1",
        property: "P488",
        rank: "normal",
        snaktype: "value",
        value: { type: "wikibase-item", value: "Q1" },
        qualifiers: {
          P580: [{ type: "time", value: "+2015-06-01T00:00:00Z", precision: 11 }],
          P582: [{ type: "time", value: "+2024-01-15T00:00:00Z", precision: 11 }],
        },
        referenceCount: 2,
      },
      {
        id: "Q100-Q2",
        property: "P488",
        rank: "preferred",
        snaktype: "value",
        value: { type: "wikibase-item", value: "Q2" },
        qualifiers: { P580: [{ type: "time", value: "+2024-01-15T00:00:00Z", precision: 11 }] },
        referenceCount: 0,
      },
      {
        id: "Q100-unknown",
        property: "P488",
        rank: "normal",
        snaktype: "somevalue",
        qualifiers: {},
        referenceCount: 0,
      },
    ]);
  });
});

describe("fetchWikidataEntity", () => {
  it("asks for the entity as it stood at a revision when one is given", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ entities: { Q100: entityJson([]) } }) });
    globalThis.fetch = fetchMock;

    const entity = await fetchWikidataEntity("Q100", { revisionId: 1234 });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://www.wikidata.org/wiki/Special:EntityData/Q100.json?revision=1234",
    );
    expect(entity?.label).toBe("Example Society");
  });
});

describe("diffWikidataStatements", () => {
  it("matches statements by ID and names the parts that changed", () => {
    const before = parseWikidataEntity("Q100", entityJson([office("Q1", { start: "+2015-06-01T00:00:00Z" })]));
    const after = parseWikidataEntity(
      "Q100",
      entityJson([
        office("Q1", { start: "+2015-06-01T00:00:00Z", end: "+2024-01-15T00:00:00Z", references: 1 }),
        office("Q2", { start: "+2024-01-15T00:00:00Z", rank: "preferred" }),
      ]),
    );

    const changes = diffWikidataStatements(before.statements ?? [], after.statements ?? []);
    expect(changes.map((c) => [c.kind, c.statementId, c.parts])).toEqual([
      ["changed", "Q100-Q1", ["qualifiers", "references"]],
      ["added", "Q100-Q2", undefined],
    ]);
    expect(diffWikidataStatements(after.statements ?? [], before.statements ?? []).at(-1)).toMatchObject({
      kind: "removed",
      statementId: "Q100-Q2",
    });
    expect(diffWikidataStatements(before.statements ?? [], before.statements ?? [])).toEqual([]);
  });
});

describe("wikidataStatementHistory", () => {
  const rev = (revId: number, parentId: number, day: string, content: string, comment = "") => ({
    revId,
    parentId,
    pageId: 1,
    pageTitle: "Q100",
    timestamp: `2024-01-${day}T00:00:00Z`,
    comment,
    content,
    size: content.length,
    minor: false,
  });

  it("places each statement change between the entity revisions it lies between", () => {
    const history = wikidataStatementHistory(
      "Q100",
      [
        rev(
          30,
          20,
          "20",
          JSON.stringify(entityJson([office("Q1", { end: "+2024-01-15T00:00:00Z" }), office("Q2")])),
          "end",
        ),
        rev(10, 9, "02", JSON.stringify(entityJson([office("Q1")]))),
        rev(20, 10, "18", JSON.stringify(entityJson([office("Q1"), office("Q2")])), "add Q2"),
        { ...rev(25, 20, "19", ""), contentAvailable: false },
      ],
      { properties: ["P488"] },
    );

    expect(history.baselineRevisionId).toBe(10);
    expect(history.baseline.map((s) => s.id)).toEqual(["Q100-Q1"]);
    expect(history.revisionsRead).toBe(3);
    expect(history.revisionsSkipped).toEqual([25]);
    expect(
      history.transitions.map((t) => [
        t.kind,
        t.statementId,
        t.previousRevisionId,
        t.revisionId,
        t.adjacent,
        t.editSummary,
      ]),
    ).toEqual([
      ["added", "Q100-Q2", 10, 20, true, "add Q2"],
      ["changed", "Q100-Q1", 20, 30, true, "end"],
    ]);
    expect(history.transitions[1].after?.qualifiers.P582).toEqual([
      { type: "time", value: "+2024-01-15T00:00:00Z", precision: 11 },
    ]);
  });
});
