import { describe, expect, it } from "vitest";
import {
  buildSectionCharMap,
  countCitations,
  countKeywordMentions,
  deriveSectionHeading,
  extractAnchorSnippet,
  extractHeadingMap,
  findSectionForText,
  sanitizeWikitext,
  stripWikitext,
} from "../wikitext-parser.js";

describe("stripWikitext", () => {
  it("drops category tags so they cannot join the next sentence", () => {
    expect(stripWikitext("[[Category:IAU planet debate]]\n\nPluto is small.")).toBe("Pluto is small.");
    expect(stripWikitext("Pluto is small.\n[[category:Dwarf planets|Pluto]]")).toBe("Pluto is small.");
  });

  it("keeps a visible link to a category", () => {
    expect(stripWikitext("See [[:Category:Dwarf planets]].")).toBe("See :Category:Dwarf planets.");
  });

  it("drops interlanguage links so their labels cannot join sentence text", () => {
    expect(stripWikitext("Pluto is small.\n\n[[de:Pluto (Zwergplanet)]]\n[[fr:Pluton]]")).toBe("Pluto is small.");
    expect(stripWikitext("[[zh-yue:冥王星]]Pluto is small.")).toBe("Pluto is small.");
    expect(stripWikitext("[[de:Pluto|Zwergplanet]] is small.")).toBe("is small.");
  });

  it("keeps a visible interlanguage link and a namespace link", () => {
    expect(stripWikitext("The German article: [[:de:Pluto (Zwergplanet)]].")).toBe(
      "The German article: :de:Pluto (Zwergplanet).",
    );
    expect(stripWikitext("See [[Wikipedia:Notability]] for the policy.")).toBe(
      "See Wikipedia:Notability for the policy.",
    );
  });
});

const SAMPLE = `'''Bold text''' and ''italic''.
== History ==
The {{citation needed}} theory was first proposed in 2005.<ref name="smith2005">Smith (2005)</ref>

<!-- This is a comment -->

[[Internal link]] and [[Piped|Display]].

== See also ==
* [[Related topic]]

== References ==
{{reflist}}`;

const HEADING_SAMPLE = `Lead text here.
== First section ==
Content.
=== Subsection ===
Deeper.
== Second section ==
More.`;

describe("sanitizeWikitext", () => {
  it("strips HTML comments", () => {
    expect(sanitizeWikitext("before <!-- comment --> after")).not.toContain("comment");
  });

  it("strips ref tags", () => {
    const result = sanitizeWikitext("text<ref>citation</ref>more");
    expect(result).not.toContain("citation");
    expect(result).toContain("text");
    expect(result).toContain("more");
  });

  it("strips templates", () => {
    expect(sanitizeWikitext("{{citation needed}}")).toBe("");
  });

  it("strips wikilinks, keeping display text", () => {
    expect(sanitizeWikitext("[[Foo]] and [[Bar|baz]]")).toBe("Foo and baz");
  });

  it("strips bold and italic markers", () => {
    expect(sanitizeWikitext("'''bold''' and ''italic''")).toBe("bold and italic");
  });

  it("collapses all whitespace sequences to single spaces", () => {
    const result = sanitizeWikitext("a\n\n\n\nb");
    expect(result).toBe("a b");
  });
});

describe("extractHeadingMap", () => {
  it("extracts headings with positions", () => {
    const map = extractHeadingMap(HEADING_SAMPLE);
    expect(map.length).toBeGreaterThanOrEqual(3);
    expect(map[0].heading).toBe("First section");
  });
});

describe("deriveSectionHeading", () => {
  it("returns heading for a position in a section", () => {
    const heading = deriveSectionHeading(HEADING_SAMPLE, HEADING_SAMPLE.indexOf("Content"));
    expect(heading).toBe("First section");
  });

  it("returns null for lead area", () => {
    const heading = deriveSectionHeading(HEADING_SAMPLE, HEADING_SAMPLE.indexOf("Lead text"));
    expect(heading).toBeNull();
  });

  it("handles positions at the end of content", () => {
    const heading = deriveSectionHeading(HEADING_SAMPLE, HEADING_SAMPLE.length - 1);
    expect(heading).toBe("Second section");
  });
});

describe("countCitations", () => {
  it("counts ref tags, returning at least 1", () => {
    const wikitext = "One<ref>a</ref> two<ref name='b'>c</ref> three<ref>d</ref>";
    expect(countCitations(wikitext)).toBe(3);
  });

  it("counts combined refs", () => {
    expect(countCitations(SAMPLE)).toBeGreaterThan(0);
  });

  it("returns 0 when there are no refs", () => {
    expect(countCitations("Plain text with no citations.")).toBe(0);
  });
});

describe("countKeywordMentions", () => {
  it("counts mentions of a single phrase", () => {
    const result = countKeywordMentions("Earth is the third planet. Earth has one moon.", ["Earth"]);
    expect(result.totalMentions).toBe(2);
    expect(result.matchedPhrases).toBe(1);
  });

  it("counts multiple phrases", () => {
    const result = countKeywordMentions("Apple and orange are fruits. Apple is red.", ["Apple", "orange"]);
    expect(result.totalMentions).toBe(3);
    expect(result.matchedPhrases).toBe(2);
  });

  it("returns 0 for no matches", () => {
    const result = countKeywordMentions("No relevant content here.", ["pineapple"]);
    expect(result.totalMentions).toBe(0);
    expect(result.matchedPhrases).toBe(0);
  });
});

describe("extractAnchorSnippet", () => {
  it("extracts surrounding context for a keyword", () => {
    const text = "The Earth is the third planet from the Sun and the only known planet to support life.";
    const snippet = extractAnchorSnippet(text, ["Earth"]);
    expect(snippet).toBeTruthy();
    expect(snippet?.length).toBeGreaterThan(0);
  });

  it("returns null if keyword not found", () => {
    const snippet = extractAnchorSnippet("No relevant content here.", ["Nonexistent"]);
    expect(snippet).toBeNull();
  });

  it("respects radius parameter", () => {
    const text = `${"A".repeat(100)}TARGET${"B".repeat(100)}`;
    const snippet = extractAnchorSnippet(text, ["TARGET"], 10);
    expect(snippet).toBeTruthy();
    expect(snippet?.length).toBeLessThan(50);
  });
});

describe("findSectionForText", () => {
  const wikitext = `Lead text about the topic.

== History ==
Historical content about the subject.

== References ==
{{reflist}}`;

  it("finds section for text in lead", () => {
    const section = findSectionForText(wikitext, "Lead text about the topic.");
    expect(section).toBe("(lead)");
  });

  it("finds section for text in a named section", () => {
    const section = findSectionForText(wikitext, "Historical content about the subject.");
    expect(section).toBe("History");
  });

  it("returns lead for text that doesn't appear", () => {
    const section = findSectionForText(wikitext, "Text that does not appear anywhere.");
    expect(section).toBe("(lead)");
  });

  it("finds text under a heading that directly follows another", () => {
    const nested = "Lead text.\n\n== Parent ==\n=== Child ===\nText that sits in the child section.";
    expect(findSectionForText(nested, "Text that sits in the child section.")).toBe("Child");
  });
});

describe("heading parsing on a hostile line", () => {
  // A line of "=" or "==" followed by thousands of spaces took time cubic in
  // its length until 2026-09-24: four minutes at 8,000 characters.
  const spaces = " ".repeat(3000);
  // After the text being located: findSectionForText compares offsets in
  // whitespace-collapsed text with offsets in the wikitext, so a long run of
  // spaces before the text would move it, whatever the regex.
  const hostile = `Lead text.\n== History ==\nText in history.\n=${spaces}x\n==${spaces}x\n`;

  it("builds the section map in linear time", () => {
    const start = performance.now();
    expect(buildSectionCharMap(hostile).map((m) => m.section)).toEqual(["(lead)", "History"]);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("locates text in linear time", () => {
    const start = performance.now();
    expect(findSectionForText(hostile, "Text in history.")).toBe("History");
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("maps headings in linear time", () => {
    const start = performance.now();
    expect(extractHeadingMap(hostile).map((h) => h.heading)).toEqual(["History"]);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("keeps a heading to one line", () => {
    // The old pattern's \s matched newlines, so "==" and "Title ==" on
    // consecutive lines read as one heading.
    expect(extractHeadingMap("Lead.\n==\nTitle ==\n")).toEqual([]);
    expect(extractHeadingMap("== a = b ==  \n====\n")).toEqual([
      { position: 0, heading: "a = b" },
      { position: 14, heading: "" },
    ]);
  });
});
