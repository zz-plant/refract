import { describe, expect, it } from "vitest";
import {
  buildSourceId,
  buildSourceLineage,
  citationDomain,
  citationTracker,
  extractCitationAnchors,
} from "../citation-tracker.js";

describe("citationTracker", () => {
  it("extracts named refs from wikitext", () => {
    const wikitext = `Content<ref name="src1">{{cite web |url=https://example.edu/research |title=Research Paper}}</ref>`;
    const refs = citationTracker.extractCitations(wikitext);
    expect(refs).toHaveLength(1);
    expect(refs[0].refName).toBe("src1");
    expect(refs[0].url).toBe("https://example.edu/research");
  });

  it("diff detects added citations", () => {
    const before: Parameters<typeof citationTracker.diffCitations>[0] = [];
    const after = citationTracker.extractCitations(
      `Content<ref name="a">{{cite web |url=https://example.edu/a}}</ref>`,
    );
    const changes = citationTracker.diffCitations(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("added");
  });

  it("diff detects replaced citations", () => {
    const before = citationTracker.extractCitations(
      `Content<ref name="x">{{cite web |url=https://example.edu/old}}</ref>`,
    );
    const after = citationTracker.extractCitations(
      `Content<ref name="x">{{cite web |url=https://example.edu/new}}</ref>`,
    );
    const changes = citationTracker.diffCitations(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("replaced");
  });

  it("diff detects removed citations", () => {
    const before = citationTracker.extractCitations(
      `Content<ref name="y">{{cite web |url=https://example.edu/y}}</ref>`,
    );
    const after: Parameters<typeof citationTracker.diffCitations>[1] = [];
    const changes = citationTracker.diffCitations(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("removed");
  });
});

describe("buildSourceId", () => {
  it("hashes URL when present", () => {
    const id = buildSourceId({ url: "https://example.edu/doc", raw: "<ref>...</ref>" });
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("hashes ref:name when no URL", () => {
    const id = buildSourceId({ refName: "Smith2024", raw: '<ref name="Smith2024"/>' });
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("hashes raw text when no URL or refName", () => {
    const id = buildSourceId({ raw: "<ref>Some bare citation</ref>" });
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces deterministic output", () => {
    const a = buildSourceId({ url: "https://example.edu/doc", raw: "" });
    const b = buildSourceId({ url: "https://example.edu/doc", raw: "" });
    expect(a).toBe(b);
  });
});

describe("buildSourceLineage", () => {
  it("builds source records and tracks replacement", () => {
    const rev1 = {
      revId: 1,
      timestamp: "2024-01-01T00:00:00Z",
      content: `Content<ref name="src1">{{cite web |url=https://example.edu/research |title=Original}}</ref>`,
    };
    const rev2 = {
      revId: 2,
      timestamp: "2024-01-02T00:00:00Z",
      content: `Content<ref name="src1">{{cite web |url=https://example.edu/research |title=Original}}</ref>`,
    };

    const result = buildSourceLineage([rev1, rev2]);
    expect(result.sources).toHaveLength(1);
    expect(result.lineage).toHaveLength(0);
    const src = result.sources[0];
    expect(src.sourceType).toBe("secondary");
    expect(src.authority).toBe("high");
    expect(src.firstSeenRevisionId).toBe(1);
  });

  it("tracks replacement when named ref changes content", () => {
    const rev1 = {
      revId: 1,
      timestamp: "2024-01-01T00:00:00Z",
      content: `Content<ref name="x">{{cite web |url=https://example.edu/old}}</ref>`,
    };
    const rev2 = {
      revId: 2,
      timestamp: "2024-01-02T00:00:00Z",
      content: `Content<ref name="x">{{cite web |url=https://reuters.com/article |title=New}}</ref>`,
    };

    const result = buildSourceLineage([rev1, rev2]);
    expect(result.sources).toHaveLength(2);
    expect(result.lineage).toHaveLength(1);

    const eduSource = result.sources.find((s) => s.url?.includes("example.edu"));
    if (!eduSource) throw new Error("Expected edu source to be found");
    const comSource = result.sources.find((s) => s.url?.includes("reuters.com"));
    if (!comSource) throw new Error("Expected com source to be found");

    expect(eduSource.sourceType).toBe("secondary");
    expect(eduSource.authority).toBe("high");
    expect(comSource.sourceType).toBe("news");
    expect(comSource.authority).toBe("medium");

    expect(result.lineage[0].sourceId).toBe(eduSource.sourceId);
    expect(result.lineage[0].replacements).toHaveLength(1);
    expect(result.lineage[0].replacements[0].replacedById).toBe(comSource.sourceId);
    expect(result.lineage[0].replacements[0].atRevisionId).toBe(2);
  });

  it("classifies .gov source as government/high", () => {
    const refUrl = "https://www.nasa.gov/report";
    const content = `<ref name="g">{{cite web |url=${refUrl} |title=Report}}</ref>`;
    const result = buildSourceLineage([{ revId: 1, timestamp: "2024-01-01T00:00:00Z", content }]);
    const src = result.sources.find((s) => s.url === refUrl);
    if (!src) throw new Error("Expected source to be found");
    expect(src.sourceType).toBe("government");
    expect(src.authority).toBe("high");
  });

  it("classifies doi.org as academic/medium", () => {
    const refUrl = "https://doi.org/10.1234/test";
    const content = `<ref name="d">{{cite journal |url=${refUrl} |title=Study}}</ref>`;
    const result = buildSourceLineage([{ revId: 1, timestamp: "2024-01-01T00:00:00Z", content }]);
    const src = result.sources.find((s) => s.url === refUrl);
    if (!src) throw new Error("Expected source to be found");
    expect(src.sourceType).toBe("academic");
    expect(src.authority).toBe("medium");
  });

  it("classifies unknown URL as unknown/unrated", () => {
    const refUrl = "https://someblog.example/page";
    const content = `<ref name="u">{{cite web |url=${refUrl} |title=Blog}}</ref>`;
    const result = buildSourceLineage([{ revId: 1, timestamp: "2024-01-01T00:00:00Z", content }]);
    const src = result.sources.find((s) => s.url === refUrl);
    if (!src) throw new Error("Expected source to be found");
    expect(src.sourceType).toBe("unknown");
    expect(src.authority).toBe("unrated");
  });

  it("tracks removal and sets lastSeenRevisionId", () => {
    const rev1 = {
      revId: 1,
      timestamp: "2024-01-01T00:00:00Z",
      content: `Content<ref name="a">{{cite web |url=https://example.edu/a}}</ref>`,
    };
    const rev2 = {
      revId: 2,
      timestamp: "2024-01-02T00:00:00Z",
      content: "Content without citations",
    };

    const result = buildSourceLineage([rev1, rev2]);
    const src = result.sources.find((s) => s.url?.includes("example.edu"));
    if (!src) throw new Error("Expected source to be found");
    expect(src.lastSeenRevisionId).toBe(1);
    expect(src.lastSeenAt).toBe("2024-01-01T00:00:00Z");
  });

  it("classifies no-url as unknown/unrated", () => {
    const result = buildSourceLineage([
      {
        revId: 1,
        timestamp: "2024-01-01T00:00:00Z",
        content: `Content<ref name="nourl">Some citation text</ref>`,
      },
    ]);
    const src = result.sources[0];
    expect(src.url).toBeUndefined();
    expect(src.sourceType).toBe("unknown");
    expect(src.authority).toBe("unrated");
  });
});

describe("citationTracker.extractCitations on hostile and edge-case markup", () => {
  // Until 2026-09-24 these took time quadratic or cubic in the input: every
  // unclosed "<ref" re-read the rest of the text, and the title pattern split
  // whitespace between three quantifiers.
  const timed = (text: string) => {
    const start = performance.now();
    const refs = citationTracker.extractCitations(text);
    return { refs, ms: performance.now() - start };
  };

  it("stays linear on many unclosed openers", () => {
    const { refs, ms } = timed(`e${"<ref/r".repeat(20000)}`);
    expect(refs).toEqual([]);
    expect(ms).toBeLessThan(1000);
  });

  it("stays linear on many openers sharing one closing bracket", () => {
    const { refs, ms } = timed(`${"<ref".repeat(20000)}>`);
    expect(refs).toEqual([]);
    expect(ms).toBeLessThan(1000);
  });

  it("stays linear on a long run of whitespace after title=", () => {
    // Followed by text, so the trim before the title search leaves the run in.
    const { refs, ms } = timed(`<ref>TITLE=${"\t".repeat(3000)}x</ref>`);
    expect(refs).toHaveLength(1);
    expect(refs[0].title).toBeUndefined();
    expect(ms).toBeLessThan(1000);
  });

  it("keeps the regex semantics it replaced", () => {
    // A title with nothing before its delimiter is skipped for the next one.
    expect(citationTracker.extractCitations("<ref>title=| Title = Found |</ref>")[0].title).toBe("Found");
    // A closing tag may carry whitespace; <refx> is not a ref.
    const refs = citationTracker.extractCitations('<refx>no</refx><ref name="a">x</ref \n>');
    expect(refs.map((r) => [r.refName, r.raw])).toEqual([["a", '<ref name="a">x</ref \n>']]);
    // A self-closing tag counts when "/" is its last non-space character.
    expect(citationTracker.extractCitations("<ref name=b / >").map((r) => r.refName)).toEqual(["b"]);
  });
});

describe("references after a reused named reference", () => {
  // <ref name="a"/> was read as an opener, so the match ran to the next
  // </ref> and the full reference after it was never extracted.
  it("extracts the full reference that follows a self-closing one", () => {
    const wikitext =
      'Alpha.<ref name="a">{{cite web|url=https://a.example/1}}</ref> Beta.<ref name="a"/> Gamma.<ref>{{cite web|url=https://b.example/2}}</ref>';
    expect(citationTracker.extractCitations(wikitext).map((r) => r.url)).toEqual([
      "https://a.example/1",
      "https://b.example/2",
    ]);
  });
});

describe("citation URLs", () => {
  it("reads a bare URL when there is no url parameter", () => {
    expect(citationTracker.extractCitations("A.<ref>https://news.example/story</ref>")[0].url).toBe(
      "https://news.example/story",
    );
    expect(citationTracker.extractCitations("A.<ref>[https://news.example/x Title]</ref>")[0].url).toBe(
      "https://news.example/x",
    );
  });

  it("takes the url parameter over an archive-url written before it", () => {
    const ref = "A.<ref>{{cite web |archive-url=https://archive.example/a |url=https://origin.example/a}}</ref>";
    expect(citationTracker.extractCitations(ref)[0].url).toBe("https://origin.example/a");
  });

  it("names the domain without www and in lower case", () => {
    expect(citationDomain("https://WWW.News.Example/story")).toBe("news.example");
    expect(citationDomain("not a url")).toBeUndefined();
    expect(citationDomain(undefined)).toBeUndefined();
  });
});

describe("extractCitationAnchors", () => {
  it("links each reference to the sentence it follows", () => {
    const { byKey } = extractCitationAnchors(
      'First claim.<ref name="a">x</ref> Second claim is longer.<ref>{{cite web|url=https://b.example}}</ref>',
    );
    expect(byKey.get("a")).toEqual(["First claim."]);
    expect([...byKey.values()]).toEqual([["First claim."], ["Second claim is longer."]]);
  });

  it("lists every sentence a reused named reference follows", () => {
    const { byKey } = extractCitationAnchors('One.<ref name="a">x</ref> Two.<ref name="a"/>');
    expect(byKey.get("a")).toEqual(["One.", "Two."]);
  });

  it("anchors a reference in mid-sentence to the text before it", () => {
    const { byKey } = extractCitationAnchors('Smith said it rained,<ref name="a">x</ref> while Jones disagreed.');
    expect(byKey.get("a")).toEqual(["Smith said it rained,"]);
  });

  it("gives a reference inside a template no anchor", () => {
    const { byKey } = extractCitationAnchors(
      '{{Infobox war\n| result = Victory<ref name="a">x</ref>\n}}\nThe war ended.<ref name="b">y</ref>',
    );
    expect(byKey.has("a")).toBe(false);
    expect(byKey.get("b")).toEqual(["The war ended."]);
  });

  it("stays linear on a long line with no sentence breaks", () => {
    const wikitext = `${"word ".repeat(200_000)}${'<ref name="r"/>'.repeat(20_000)}`;
    const t0 = performance.now();
    const anchor = extractCitationAnchors(wikitext).byKey.get("r")?.[0] ?? "";
    expect(anchor.length).toBeLessThanOrEqual(1000);
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it("counts the citations that follow each passage", () => {
    const { citationsPerAnchor } = extractCitationAnchors(
      'Shared.<ref name="a">x</ref><ref name="b">y</ref> Alone.<ref name="c">z</ref>',
    );
    expect(citationsPerAnchor.get("shared.")).toBe(2);
    expect(citationsPerAnchor.get("alone.")).toBe(1);
  });
});
