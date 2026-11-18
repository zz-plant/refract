import { describe, expect, it } from "vitest";
import {
  buildSectionCharMap,
  countCitations,
  countKeywordMentions,
  deriveSectionHeading,
  extractAnchorSnippet,
  extractHeadingMap,
  findSectionForText,
  removeTemplates,
  sanitizeWikitext,
  stripWikitext,
} from "../wikitext-parser.js";

describe("nested templates", () => {
  // Real infoboxes hold other templates. A single pass that removed only
  // templates with none inside left the infobox's own braces and parameters in
  // the prose, so "| result = …" lines were read as sentences.
  const infobox = [
    "{{Infobox military conflict",
    "| conflict = Example war",
    "| date = {{start date|2026|2|28}} – {{end date|2026|6|17}}",
    "| result = Example victory{{efn|disputed}}",
    "}}",
    "The war began in February.",
  ].join("\n");

  it("removes an infobox that contains other templates", () => {
    expect(stripWikitext(infobox)).toBe("The war began in February.");
  });

  it("removes nested templates from sanitized text", () => {
    expect(sanitizeWikitext(infobox)).toBe("The war began in February.");
    expect(sanitizeWikitext("A{{outer|{{inner}}}}B")).toBe("A B");
  });

  it("keeps an opener that never closes, with balanced templates inside it removed", () => {
    expect(removeTemplates("before {{unclosed {{cn}} after", "")).toBe("before {{unclosed  after");
  });

  it("keeps a closer with no opener", () => {
    expect(removeTemplates("text }} more {{cn}} end", "")).toBe("text }} more  end");
  });

  it("returns text without templates unchanged", () => {
    expect(removeTemplates("plain prose", "")).toBe("plain prose");
  });

  it("stays linear on deep nesting", () => {
    const depth = 50_000;
    const text = `start ${"{{a|".repeat(depth)}${"}}".repeat(depth)} end`;
    const t0 = performance.now();
    expect(removeTemplates(text, "")).toBe("start  end");
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("stripWikitext", () => {
  it("drops category tags so they cannot join the next sentence", () => {
    expect(stripWikitext("[[Category:IAU planet debate]]\n\nPluto is small.")).toBe("Pluto is small.");
    expect(stripWikitext("Pluto is small.\n[[category:Dwarf planets|Pluto]]")).toBe("Pluto is small.");
  });

  it("keeps a visible link to a category", () => {
    expect(stripWikitext("See [[:Category:Dwarf planets]].")).toBe("See :Category:Dwarf planets.");
  });

  it("drops category tags written with a wiki's local namespace name", () => {
    expect(stripWikitext("[[Kategorie:Zwergplanet]]\n\nPluto ist klein.")).toBe("Pluto ist klein.");
    expect(stripWikitext("Pluton est petite.\n[[Catégorie:Planète naine|Pluton]]")).toBe("Pluton est petite.");
    expect(stripWikitext("Pluton est petite.\n[[CATÉGORIE : Planète naine]]")).toBe("Pluton est petite.");
    expect(stripWikitext("冥王星は小さい。\n[[カテゴリ:準惑星]]\n[[Category:冥王星]]")).toBe("冥王星は小さい。");
  });

  it("keeps a visible link to a category under a local namespace name", () => {
    expect(stripWikitext("Siehe [[:Kategorie:Zwergplanet]].")).toBe("Siehe :Kategorie:Zwergplanet.");
    expect(stripWikitext("Voir [[:Catégorie:Planète naine]].")).toBe("Voir :Catégorie:Planète naine.");
    expect(stripWikitext("[[:カテゴリ:準惑星]]を参照。")).toBe(":カテゴリ:準惑星を参照。");
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

describe("stripWikitext on headings", () => {
  it("removes heading lines so they cannot open the next sentence", () => {
    expect(stripWikitext("==Planetary status==\n===Planet X?===\nPluto was found in 1930.")).toBe(
      "Pluto was found in 1930.",
    );
    expect(stripWikitext("== Fees ==\n== Board License Fees: ==\nThe fee is due on filing.")).toBe(
      "The fee is due on filing.",
    );
  });

  it("leaves a paragraph break where a heading stood", () => {
    expect(stripWikitext("Its moons include:\n* Charon\n== Orbit ==\nPluto orbits the Sun.")).toBe(
      "Its moons include:\n* Charon\n\nPluto orbits the Sun.",
    );
    expect(stripWikitext("Lead.\n\n\n== A ==\n\n== B ==\n\nBody.")).toBe("Lead.\n\nBody.");
  });

  it("keeps equals signs that are not a heading line", () => {
    expect(stripWikitext("Then a == b holds.\nx = 1")).toBe("Then a == b holds.\nx = 1");
  });

  it("drops a commented-out section with its heading", () => {
    const page = "Lead.\n<!--\n== Draft ==\nUnfinished text.\n-->\n== Orbit ==\nPluto orbits the Sun.";
    expect(stripWikitext(page)).toBe("Lead.\n\nPluto orbits the Sun.");
    expect(buildSectionCharMap(page).map((m) => m.section)).toEqual(["(lead)", "Orbit"]);
    expect(findSectionForText(page, "Pluto orbits the Sun.")).toBe("Orbit");
  });
});

describe("section offsets", () => {
  // Markup above a heading is removed from the text a sentence is searched in.
  // Offsets taken in the wikitext ran ahead of that text by the markup's
  // length, and by the headings' own, so a sentence was put under a heading
  // that came before its own.
  const page = [
    "{{Infobox planet | name = Pluto | discovered = 1930 | discoverer = Clyde Tombaugh | moons = 5}}",
    "'''Pluto''' is a [[dwarf planet]] in the [[Kuiper belt]].<ref>{{cite web |url=https://example.org/pluto |title=Pluto}}</ref>",
    "",
    "== Discovery ==",
    'Pluto was found at [[Lowell Observatory]] in 1930.<ref name="lowell">{{cite book |title=Out of the Darkness |year=1980}}</ref>',
    "",
    "== Charon ==",
    "Charon is the largest of the five known moons.",
    "",
    "== Orbit ==",
    "The orbit is eccentric and inclined.",
  ].join("\n");

  it("starts each section where its prose starts in the stripped text", () => {
    const text = stripWikitext(page).toLowerCase().replace(/\s+/g, " ");
    expect(buildSectionCharMap(page).map((m) => [m.section, text.slice(m.charOffset, m.charOffset + 12)])).toEqual([
      ["(lead)", "pluto is a d"],
      ["Discovery", "pluto was fo"],
      ["Charon", "charon is th"],
      ["Orbit", "the orbit is"],
    ]);
  });

  it("names the section each sentence sits in", () => {
    expect(findSectionForText(page, "Pluto is a dwarf planet in the Kuiper belt.")).toBe("(lead)");
    expect(findSectionForText(page, "Pluto was found at Lowell Observatory in 1930.")).toBe("Discovery");
    expect(findSectionForText(page, "Charon is the largest of the five known moons.")).toBe("Charon");
    expect(findSectionForText(page, "The orbit is eccentric and inclined.")).toBe("Orbit");
  });

  it("gives an empty section the offset of the next one", () => {
    const nested = "Lead text.\n\n== Parent ==\n=== Child ===\nText in the child.";
    expect(buildSectionCharMap(nested)).toEqual([
      { charOffset: 0, section: "(lead)" },
      { charOffset: 11, section: "Parent" },
      { charOffset: 11, section: "Child" },
    ]);
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
