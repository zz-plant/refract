import type { EvidenceEvent, Revision } from "@refract-org/evidence-graph";
import { EVENT_SCHEMA_VERSION } from "@refract-org/evidence-graph";
import { describe, expect, it } from "vitest";
import type { ProtectionLogRecord } from "../protection-tracker.js";
import { annotateEvents, buildRevisionEvents, parseContent } from "../revision-events.js";

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();

function rev(revId: number, minute: number, content: string, comment = ""): Revision {
  return {
    revId,
    pageId: 1,
    pageTitle: "Topic",
    timestamp: at(minute),
    user: "Editor",
    comment,
    content,
    size: content.length,
    minor: false,
  };
}

const pair = (events: EvidenceEvent[], to: number) => events.filter((e) => e.toRevisionId === to);
const types = (events: EvidenceEvent[]) => events.map((e) => e.eventType).sort();
const facts = (event: EvidenceEvent | undefined) => event?.deterministicFacts.map((f) => `${f.fact}: ${f.detail}`);

const ARTICLE = "Text.<ref>https://example.org/a</ref>";
const TAGGED = "{{NPOV}}\nText.<ref>https://example.org/a</ref><ref>https://example.org/b</ref>";

describe("buildRevisionEvents", () => {
  it("returns no events without a pair to diff", () => {
    expect(buildRevisionEvents([])).toEqual([]);
    expect(buildRevisionEvents([rev(1, 0, ARTICLE)])).toEqual([]);
  });

  it("orders revisions by timestamp and leaves the input alone", () => {
    const history = [rev(1, 0, ARTICLE), rev(2, 10, TAGGED, "tag"), rev(3, 20, ARTICLE, "untag")];
    const reversed = [...history].reverse();

    expect(buildRevisionEvents(reversed)).toEqual(buildRevisionEvents(history));
    expect(reversed.map((r) => r.revId)).toEqual([3, 2, 1]);
    expect(buildRevisionEvents(reversed).map((e) => e.toRevisionId)).toEqual(
      buildRevisionEvents(history).map((e) => e.toRevisionId),
    );
  });

  it("names a renamed section's old heading, unless rename detection is off", () => {
    const history = [
      rev(1, 0, "Lead.\n\n== Origin ==\nBody text here."),
      rev(2, 10, "Lead.\n\n== Formation ==\nBody text here."),
    ];
    const sections = (events: EvidenceEvent[]) =>
      events.filter((e) => e.eventType === "section_reorganized").map((e) => `${e.section}: ${facts(e)?.[0]}`);

    expect(sections(buildRevisionEvents(history))).toEqual(["Formation: section_changed: change=moved from=Origin"]);
    expect(sections(buildRevisionEvents(history, { sectionRename: "none" }))).toEqual([
      "Formation: section_changed: change=added",
      "Origin: section_changed: change=removed",
    ]);
  });

  it("keeps a localized category tag out of sentence text", () => {
    const tags = "[[Kategorie:Zwergplanet]]\n[[Catégorie:Planète naine|Pluton]]\n[[カテゴリ:準惑星]]";
    const rest = "Seine Umlaufbahn ist stark exzentrisch und geneigt.";
    const history = [
      rev(1, 0, `${tags}\n\nPluto ist ein Zwergplanet im Kuipergürtel. ${rest}`),
      rev(2, 10, `${tags}\n\nPluto ist ein kleiner Zwergplanet im Kuipergürtel. ${rest}`),
    ];
    const sentences = buildRevisionEvents(history, { similarityThreshold: 0.5 }).filter((e) =>
      e.eventType.startsWith("sentence_"),
    );

    expect(sentences.map((e) => [e.eventType, e.before, e.after])).toEqual([
      [
        "sentence_modified",
        "Pluto ist ein Zwergplanet im Kuipergürtel",
        "Pluto ist ein kleiner Zwergplanet im Kuipergürtel",
      ],
    ]);
  });

  describe("sentences and section headings", () => {
    // Shaped like the 2006 Pluto article: an infobox and references above the
    // headings, a heading directly under another, a section that ends in a list.
    const article = (discovery: string, charon: string) =>
      [
        "{{Infobox planet | name = Pluto | discovered = 1930 | discoverer = Clyde Tombaugh | moons = 3}}",
        "'''Pluto''' is the second-largest known [[dwarf planet]] in the [[Solar System]].<ref>{{cite web |url=https://example.org/iau |title=Resolution 5A}}</ref>",
        "",
        "==Planetary status==",
        "===Planet X?===",
        discovery,
        "",
        "Objects found near it since 1992 include:",
        "* [[Quaoar]]",
        "* [[Sedna]]",
        "==Charon==",
        charon,
        "",
        "==Orbit==",
        "The orbit of Pluto is eccentric and highly inclined to the ecliptic.",
      ].join("\n");
    const history = [
      rev(
        1,
        0,
        article(
          "Pluto was originally discovered in 1930 during a search for a ninth planet.",
          "Charon was found in 1978 and is about half the diameter of Pluto.",
        ),
      ),
      rev(
        2,
        10,
        article(
          "Pluto was originally discovered in 1930 by Clyde Tombaugh during a search for a ninth planet.",
          "Charon was found in 1978 by James Christy and is about half the diameter of Pluto.",
        ),
      ),
    ];
    const sentences = (revisions: Revision[]) =>
      buildRevisionEvents(revisions, { similarityThreshold: 0.7 })
        .filter((e) => e.eventType.startsWith("sentence_"))
        .map((e) => ({ type: e.eventType, section: e.section, before: e.before, after: e.after }));

    it("keeps headings out of sentence text and names each sentence's own section", () => {
      expect(sentences(history)).toEqual([
        {
          type: "sentence_modified",
          section: "Planet X?",
          before: "Pluto was originally discovered in 1930 during a search for a ninth planet",
          after: "Pluto was originally discovered in 1930 by Clyde Tombaugh during a search for a ninth planet",
        },
        {
          type: "sentence_modified",
          section: "Charon",
          before: "Charon was found in 1978 and is about half the diameter of Pluto",
          after: "Charon was found in 1978 by James Christy and is about half the diameter of Pluto",
        },
      ]);
    });

    it("emits no sentence text that holds a heading", () => {
      const texts = buildRevisionEvents([rev(0, 0, "Stub."), ...history])
        .filter((e) => e.eventType.startsWith("sentence_"))
        .flatMap((e) => [e.before, e.after]);

      expect(texts.length).toBeGreaterThan(4);
      expect(texts.filter((text) => /==|Planetary status|Planet X\?/.test(text))).toEqual([]);
    });

    it("splits a document whose headings follow lines without punctuation", () => {
      const page = (fee: string) =>
        [
          "Professions",
          "== Contractor - Resident Licensure ==",
          "Understand the requirements before you submit an application to the board.",
          "",
          "== Fees ==",
          "== Board License Fees: ==",
          `The application fee is ${fee} dollars and is not refundable.`,
        ].join("\n");

      expect(sentences([rev(1, 0, page("150")), rev(2, 10, page("175"))])).toEqual([
        {
          type: "sentence_modified",
          section: "Board License Fees:",
          before: "The application fee is 150 dollars and is not refundable.",
          after: "The application fee is 175 dollars and is not refundable.",
        },
      ]);
      expect(sentences([rev(1, 0, "Professions"), rev(2, 10, page("150"))])).toEqual([
        {
          type: "sentence_first_seen",
          section: "Contractor - Resident Licensure",
          before: "",
          after: "Understand the requirements before you submit an application to the board",
        },
        {
          type: "sentence_first_seen",
          section: "Board License Fees:",
          before: "",
          after: "The application fee is 150 dollars and is not refundable.",
        },
      ]);
    });
  });

  it("places a citation event in the section that holds the reference", () => {
    const ref = (n: string) => `<ref>https://example.org/${n}</ref>`;
    const history = [
      rev(1, 0, `Lead.${ref("lead")}\n\n== History ==\nPast.${ref("old")}`),
      rev(2, 10, `Lead.\n\n== History ==\nPast.\n\n== Design ==\nShape.${ref("new")}`),
    ];
    const citations = buildRevisionEvents(history)
      .filter((e) => e.eventType.startsWith("citation_"))
      .map((e) => `${e.eventType} ${e.section}`)
      .sort();

    expect(citations).toEqual(["citation_added Design", "citation_removed (lead)", "citation_removed History"]);
  });

  it("uses the caller's revert patterns in place of the defaults", () => {
    // Revision 3's text differs from revision 1's, so only its summary can make it a revert.
    const history = [
      rev(1, 0, ARTICLE),
      rev(2, 10, TAGGED, "rv unexplained removal"),
      rev(3, 20, `${ARTICLE} More.`, "revert"),
    ];
    const reverts = (events: EvidenceEvent[]) =>
      events.filter((e) => e.eventType === "revert_detected").map((e) => e.toRevisionId);

    expect(reverts(buildRevisionEvents(history))).toEqual([3]);
    expect(reverts(buildRevisionEvents(history, { revertPatterns: [/^rv\b/] }))).toEqual([2]);
  });

  it("finds a revert whose summary says nothing by its restored text", () => {
    const events = buildRevisionEvents([
      rev(1, 0, ARTICLE),
      rev(2, 10, TAGGED, "tag"),
      rev(3, 20, ARTICLE, "copyedit"),
    ]);
    const revert = pair(events, 3).find((e) => e.eventType === "revert_detected");
    expect(facts(revert)).toEqual([
      "identity_revert: restores=1",
      "policy_signal: dimension=edit_warring signal=revert_detected",
    ]);
    expect(pair(events, 2).some((e) => e.eventType === "revert_detected")).toBe(false);
  });

  it("gives a revert found by summary and by text one event with both facts", () => {
    const events = buildRevisionEvents([rev(1, 0, ARTICLE), rev(2, 10, TAGGED, "tag"), rev(3, 20, ARTICLE, "rvv")]);
    const reverts = pair(events, 3).filter((e) => e.eventType === "revert_detected");
    expect(reverts).toHaveLength(1);
    expect(facts(reverts[0])).toEqual([
      "revert_detected: rvv",
      "identity_revert: restores=1",
      "policy_signal: dimension=edit_warring signal=revert_detected",
    ]);
  });

  it("records citation, template and revert events on the pair that made them", () => {
    const events = buildRevisionEvents([
      rev(1, 0, ARTICLE),
      rev(2, 10, TAGGED, "tag"),
      rev(3, 20, ARTICLE, "Reverted edits by B (talk) to last version by A"),
    ]);

    // The lead's text changed too, so each pair also reorganizes the lead.
    expect(types(pair(events, 2))).toEqual(["citation_added", "section_reorganized", "template_added"]);
    const tagged = pair(events, 2).find((e) => e.eventType === "template_added");
    expect(tagged?.layer).toBe("policy_coded");
    expect(facts(tagged)).toEqual([
      "template_changed: name=NPOV type=added",
      "policy_signal: dimension=npov signal=npov",
    ]);

    expect(types(pair(events, 3))).toEqual([
      "citation_removed",
      "revert_detected",
      "section_reorganized",
      "template_removed",
    ]);
    const revert = pair(events, 3).find((e) => e.eventType === "revert_detected");
    expect(facts(revert)).toContain("policy_signal: dimension=edit_warring signal=revert_detected");
  });

  it("puts a protection log entry on the pair whose span contains it", () => {
    const log = (logId: number, minute: number): ProtectionLogRecord => ({
      logId,
      pageTitle: "Topic",
      timestamp: at(minute),
      comment: "",
      action: "protect",
    });
    const events = buildRevisionEvents([rev(1, 0, ARTICLE), rev(2, 10, `${ARTICLE} More.`), rev(3, 20, ARTICLE)], {
      // Before the history; inside the first span; on its upper bound; on the
      // lower bound of nothing; after the history.
      protectionLogs: [log(1, -5), log(2, 5), log(3, 10), log(4, 0), log(5, 30)],
    });

    const logged = events
      .filter((e) => e.eventType === "protection_changed")
      .map((e) => [e.toRevisionId, e.deterministicFacts[0].detail]);
    expect(logged).toEqual([
      [2, "action=protect logId=2"],
      [2, "action=protect logId=3"],
    ]);
  });

  it("follows a sentence from first seen through removal to reintroduction", () => {
    const alpha = "Alpha is a sentence that is certainly long enough to be counted by the splitter here.";
    const beta = "Beta is another sentence long enough to be counted on its own.";
    // The splitter keeps the page's final full stop and drops the others, so a
    // fixed closing sentence keeps alpha and beta from changing punctuation as
    // sentences come and go after them.
    const closing = "Omega closes the page and stays the same in every revision.";
    const events = buildRevisionEvents([
      rev(1, 0, `${alpha} ${closing}`),
      rev(2, 10, `${alpha} ${beta} ${closing}`),
      rev(3, 20, `${alpha} ${closing}`),
      rev(4, 30, `${alpha} ${beta} ${closing}`),
      rev(5, 40, `${alpha.replace("here", "there")} ${beta} ${closing}`),
    ]);

    const sentences = events
      .filter((e) => e.eventType.startsWith("sentence_"))
      .map((e) => [e.toRevisionId, e.eventType]);
    expect(sentences).toEqual([
      [2, "sentence_first_seen"],
      [3, "sentence_removed"],
      [4, "sentence_reintroduced"],
      [5, "sentence_modified"],
    ]);
  });

  it("counts a reworded sentence as modified only above the similarity threshold", () => {
    const before = "The committee approved the proposal after a long and careful review of the evidence.";
    const after = "The board rejected the proposal after a short and hurried review of the evidence.";
    const history = [rev(1, 0, before), rev(2, 10, after)];

    const sentenceTypes = (events: EvidenceEvent[]) => types(events.filter((e) => e.eventType.startsWith("sentence_")));

    expect(sentenceTypes(buildRevisionEvents(history, { similarityThreshold: 0.5 }))).toEqual(["sentence_modified"]);
    expect(sentenceTypes(buildRevisionEvents(history))).toEqual(["sentence_first_seen", "sentence_removed"]);
  });

  it("blanks the changed text at brief depth and carries both revisions at forensic depth", () => {
    const history = [rev(1, 0, ARTICLE), rev(2, 10, TAGGED)];
    const added = (events: EvidenceEvent[]) => events.find((e) => e.eventType === "citation_added");

    expect(added(buildRevisionEvents(history))?.after).toBe("<ref>https://example.org/b</ref>");
    expect(added(buildRevisionEvents(history, { depth: "brief" }))?.after).toBe("");

    const forensic = added(buildRevisionEvents(history, { depth: "forensic" }));
    expect(forensic?.deterministicFacts).toContainEqual({ fact: "full_wikitext_before", detail: ARTICLE });
    expect(forensic?.deterministicFacts).toContainEqual({ fact: "full_wikitext_after", detail: TAGGED });
  });
});

describe("annotateEvents", () => {
  it("stamps the schema version and the semantic fields, in place", () => {
    const events = buildRevisionEvents([rev(1, 0, ARTICLE), rev(2, 10, TAGGED)]);
    expect(events.some((e) => e.schemaVersion !== undefined)).toBe(false);

    const annotated = annotateEvents(events);
    expect(annotated).toBe(events);
    for (const e of annotated) {
      expect(e.schemaVersion).toBe(EVENT_SCHEMA_VERSION);
      expect(e.editMagnitude).toBeDefined();
      expect(e.contentChange).toBeDefined();
      expect(e.keyTerms).toBeDefined();
      expect(e.certaintyProfile).toBeDefined();
      expect(e.directionSignal).toBeDefined();
      expect(e.quantitativeFindings).toBeDefined();
    }
  });
});

describe("parseContent", () => {
  it("reads what the diffs compare from one revision", () => {
    const parsed = parseContent(
      "{{NPOV}}\nLead.<ref>https://example.org/a</ref> [[Linked]]\n\n== History ==\nOld.\n\n[[Category:Topics]]",
    );

    expect(parsed.sections.map((s) => s.title)).toEqual(["", "History"]);
    expect(parsed.citations.map((c) => c.raw)).toEqual(["<ref>https://example.org/a</ref>"]);
    expect(parsed.wikilinks).toEqual(["linked"]);
    expect(parsed.categories).toEqual(["topics"]);
    expect(parsed.templates.map((t) => t.name)).toEqual(["NPOV"]);
  });
});
