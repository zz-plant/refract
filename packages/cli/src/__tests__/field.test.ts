import type { Revision } from "@refract-org/evidence-graph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fieldHistory, readField, runFieldHistory } from "../commands/field.js";

function rev(revId: number, content: string, extra: Partial<Revision> = {}): Revision {
  return {
    revId,
    pageId: 7,
    pageTitle: "Example war",
    timestamp: `2026-06-${String(revId).padStart(2, "0")}T00:00:00Z`,
    comment: "",
    content,
    size: content.length,
    minor: false,
    ...extra,
  };
}

function infobox(result: string): string {
  return [
    "{{Infobox military conflict",
    "| conflict = Example war",
    "| date = {{start date|2026|2|28}}",
    `| result = ${result}`,
    "}}",
    "The war began in February.",
  ].join("\n");
}

describe("readField", () => {
  it("reads a parameter from an infobox that holds other templates", () => {
    expect(readField(infobox("Stalemate{{efn|disputed}}"), { param: "result" })).toEqual({
      template: "Infobox military conflict",
      value: "Stalemate{{efn|disputed}}",
      others: [],
    });
  });

  it("matches the template name without regard to case, underscores or a Template: prefix", () => {
    const found = readField(infobox("Stalemate"), { param: "Result", template: "Template:infobox_military_conflict" });
    expect(found?.value).toBe("Stalemate");
  });

  it("matches a module call to the template of the same name", () => {
    // Infobox templates expand to a module call, and some pages, such as an
    // infobox moved to a template of its own, make that call directly.
    const page = [
      "<noinclude>{{Pp-extended|small=yes}}</noinclude>",
      "{{#invoke:Infobox military conflict|main",
      "| conflict = Example war",
      "| status = Ongoing",
      "}}",
    ].join("\n");
    expect(readField(page, { param: "status", template: "Infobox military conflict" })).toEqual({
      template: "#invoke:Infobox military conflict",
      value: "Ongoing",
      others: [],
    });
    expect(readField(page, { param: "status", template: "Template:Infobox_military_conflict" })?.value).toBe("Ongoing");
    expect(readField(page, { param: "status", template: "Infobox planet" })).toBeUndefined();
  });

  it("treats an empty parameter as absent", () => {
    expect(readField(infobox(""), { param: "result" })).toBeUndefined();
  });

  it("names the other templates that carry the same parameter", () => {
    const page = `{{Infobox a | result = One}}\n{{Infobox b | result = Two}}`;
    expect(readField(page, { param: "result" })).toEqual({
      template: "Infobox a",
      value: "One",
      others: ["Infobox b"],
    });
    expect(readField(page, { param: "result", template: "Infobox b" })?.value).toBe("Two");
  });
});

describe("fieldHistory", () => {
  it("records each change, and flags a value that returns to an earlier one", () => {
    const result = fieldHistory(
      "Example war",
      [
        rev(1, infobox("Ongoing")),
        rev(2, infobox("Side A victory")),
        rev(3, infobox("Side B victory")),
        rev(4, infobox("Side A victory")),
        rev(5, infobox("Side A victory")),
      ],
      { param: "result" },
    );
    expect(result.changes.map((c) => [c.revisionId, c.kind, c.text, c.returnsToEarlierText])).toEqual([
      [1, "added", "Ongoing", false],
      [2, "text", "Side A victory", false],
      [3, "text", "Side B victory", false],
      [4, "text", "Side A victory", true],
    ]);
    expect(result.returns).toBe(1);
    expect(result.status).toBe("present");
    expect(result.latestText).toBe("Side A victory");
  });

  it("reports a reference removed while the words stay as a markup change", () => {
    const result = fieldHistory(
      "Example war",
      [rev(1, infobox("Side A victory<ref>https://example.org/report</ref>")), rev(2, infobox("Side A victory"))],
      { param: "result" },
    );
    expect(result.changes.map((c) => [c.kind, c.text])).toEqual([
      ["added", "Side A victory"],
      ["markup", "Side A victory"],
    ]);
    expect(result.changes[1].value).toBe("Side A victory");
  });

  it("reports an item added to a listed value as a text change", () => {
    const result = fieldHistory(
      "Example war",
      [
        rev(1, infobox("Ongoing<br>{{blist|Strait crisis}}")),
        rev(2, infobox("Ongoing<br>{{blist|Strait crisis|[[Border war (2026)|Border war]]}}")),
        rev(3, infobox("Ongoing<br />{{blist|Strait crisis|[[Border war (2026)|Border war]]}}")),
      ],
      { param: "result" },
    );
    expect(result.changes.map((c) => [c.revisionId, c.kind, c.text])).toEqual([
      [1, "added", "Ongoing · Strait crisis"],
      [2, "text", "Ongoing · Strait crisis · Border war"],
      [3, "markup", "Ongoing · Strait crisis · Border war"],
    ]);
  });

  it("names the revision before each change and whether it is the parent", () => {
    const result = fieldHistory(
      "Example war",
      [
        rev(1, infobox("Ongoing")),
        rev(2, infobox("Side A victory"), { parentId: 1 }),
        rev(5, infobox("Side B victory"), { parentId: 4 }),
        rev(6, "No infobox now.", { parentId: 5 }),
      ],
      { param: "result" },
    );
    expect(result.changes.map((c) => [c.revisionId, c.previousRevisionId, c.adjacent])).toEqual([
      [1, undefined, false],
      [2, 1, true],
      [5, 2, false],
      [6, 5, true],
    ]);
    expect(result.changes[1].previousTimestamp).toBe("2026-06-01T00:00:00Z");
    expect("previousTimestamp" in result.changes[0]).toBe(false);
  });

  it("skips a revision with withheld text when naming the one before a change", () => {
    const result = fieldHistory(
      "Example war",
      [
        rev(1, infobox("Ongoing")),
        rev(2, "", { parentId: 1, contentAvailable: false }),
        rev(3, infobox("Side A victory"), { parentId: 2 }),
      ],
      { param: "result" },
    );
    expect(result.changes[1]).toMatchObject({ revisionId: 3, previousRevisionId: 1, adjacent: false });
  });

  it("records the field's removal and reports it absent", () => {
    const result = fieldHistory("Example war", [rev(1, infobox("Ongoing")), rev(2, "No infobox now.")], {
      param: "result",
    });
    expect(result.changes.map((c) => c.kind)).toEqual(["added", "removed"]);
    expect(result.status).toBe("absent");
    expect(result.latestValue).toBeUndefined();
  });

  it("is unknown when the latest revision's text was withheld", () => {
    const result = fieldHistory("Example war", [rev(1, infobox("Ongoing")), rev(2, "", { contentAvailable: false })], {
      param: "result",
    });
    expect(result.status).toBe("unknown");
    expect(result.caveats.some((c) => c.includes("withheld"))).toBe(true);
  });

  it("says which template it read when more than one has the parameter", () => {
    const page = `{{Infobox a | result = One}}\n{{Infobox b | result = Two}}`;
    const result = fieldHistory("Example war", [rev(1, page)], { param: "result" });
    expect(result.caveats.some((c) => c.includes("Infobox b") && c.includes("--template"))).toBe(true);
  });

  it("rejects an empty parameter name", () => {
    expect(() => fieldHistory("Example war", [], { param: " " })).toThrow(/parameter/);
  });
});

describe("runFieldHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the latest revisions from the wiki", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 7,
                  title: "Example war",
                  revisions: [
                    {
                      revid: 2,
                      parentid: 1,
                      timestamp: "2026-06-02T00:00:00Z",
                      comment: "",
                      size: 1,
                      slots: { main: { content: infobox("Side B victory") } },
                    },
                    {
                      revid: 1,
                      parentid: 0,
                      timestamp: "2026-06-01T00:00:00Z",
                      comment: "",
                      size: 1,
                      slots: { main: { content: infobox("Ongoing") } },
                    },
                  ],
                },
              ],
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await runFieldHistory("Example war", { param: "result" }, "https://wiki.example/w/api.php");
    expect(result.changes.map((c) => c.text)).toEqual(["Ongoing", "Side B victory"]);
    expect(result.latestRevisionId).toBe(2);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("rvdir")).toBe("older");
  });
});
