import type { Revision } from "@refract-org/evidence-graph";
import { describe, expect, it } from "vitest";
import { citationTracker, countCitations, countCitationsByKind } from "../citation-tracker.js";
import { buildPageMoveEvents, mergePageMoves, pageMovesFromEditSummaries } from "../page-move-detector.js";
import { redactEditorIdentity } from "../redact-editor-identity.js";
import { buildRevisionEvents } from "../revision-events.js";

describe("redactEditorIdentity", () => {
  it.each([
    [
      // Mutualism (economic theory), 2006: the summary that leaked a name into revert_detected.
      "Revert to revision 57480834 dated 2006-06-08 04:35:51 by Mattergy using [[:en:Wikipedia:Tools/Navigation_popups|popups]]",
      "Revert to revision 57480834 dated 2006-06-08 04:35:51 by [editor] using [[:en:Wikipedia:Tools/Navigation_popups|popups]]",
    ],
    [
      "Reverted edits by [[Special:Contributions/1.2.3.4|1.2.3.4]] ([[User talk:1.2.3.4|talk]]) to last version by ClueBot NG",
      "Reverted edits by [editor] to last version by [editor]",
    ],
    [
      "Undid revision 123456 by [[Special:Contributions/Some User|Some User]] ([[User talk:Some User|talk]]) unsourced",
      "Undid revision 123456 by [editor] unsourced",
    ],
    [
      "Reverted 1 edit by [[Special:Contributions/2001:db8::1|2001:db8::1]] ([[User talk:2001:db8::1|talk]]): Vandalism",
      "Reverted 1 edit by [editor]: Vandalism",
    ],
    ["Restored revision 999 by Jane Doe (talk): rv vandalism", "Restored revision 999 by [editor]: rv vandalism"],
    ["Reverted edits by Foo (talk) to last revision by Bar", "Reverted edits by [editor] to last revision by [editor]"],
    ["rv, see [[User:Someone]]'s note", "rv, see [editor]'s note"],
    ["rvv per {{u|Someone}}", "rvv per [editor]"],
    [
      "Someone moved page [[Mutualism]] to [[Mutualism (economic theory)]]: disambiguation",
      "[editor] moved page [[Mutualism]] to [[Mutualism (economic theory)]]: disambiguation",
    ],
  ])("redacts %s", (input, expected) => {
    expect(redactEditorIdentity(input)).toBe(expected);
  });

  it("keeps a summary that names no editor", () => {
    const summary = "rvv, the damage was caused by fire per [[WP:V]]; see revision 12345 at 04:35:51";
    expect(redactEditorIdentity(summary)).toBe(summary);
  });
});

describe("revert_detected carries no editor identity", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
  const rev = (revId: number, minute: number, content: string, comment: string): Revision => ({
    revId,
    pageId: 1,
    pageTitle: "Topic",
    timestamp: at(minute),
    user: "Mattergy",
    comment,
    content,
    size: content.length,
    minor: false,
  });

  it("redacts the summary in `after` and in the revert_detected fact", () => {
    const events = buildRevisionEvents([
      rev(1, 0, "Stable text about the topic here.", "start"),
      rev(2, 1, "Vandalised text about the topic here.", "change"),
      rev(
        3,
        2,
        "Stable text about the topic here.",
        "Revert to revision 1 dated 2026-01-01 00:00:00 by Mattergy using [[:en:Wikipedia:Tools/Navigation_popups|popups]]",
      ),
    ]);
    const revert = events.find((e) => e.eventType === "revert_detected");
    expect(revert).toBeDefined();
    expect(JSON.stringify(revert)).not.toContain("Mattergy");
    expect(revert?.after).toContain("by [editor] using");
    expect(revert?.deterministicFacts.find((f) => f.fact === "revert_detected")?.detail).toContain("by [editor]");
  });
});

describe("page moves into the page", () => {
  it("reads both move summary formats", () => {
    const moves = pageMovesFromEditSummaries([
      {
        revId: 10,
        timestamp: "2006-09-07T00:00:00Z",
        comment: "Someone moved page [[(134340) Pluto]] to [[Pluto]]: per talk",
      },
      {
        revId: 11,
        timestamp: "2009-01-01T00:00:00Z",
        comment: "Someone moved [[Mutualism]] to [[Mutualism (economic theory)]] over redirect",
      },
      { revId: 12, timestamp: "2010-01-01T00:00:00Z", comment: "copyedit" },
    ]);
    expect(moves).toEqual([
      {
        oldTitle: "(134340) Pluto",
        newTitle: "Pluto",
        timestamp: "2006-09-07T00:00:00Z",
        revId: 10,
        comment: "per talk",
        source: "edit_summary",
      },
      {
        oldTitle: "Mutualism",
        newTitle: "Mutualism (economic theory)",
        timestamp: "2009-01-01T00:00:00Z",
        revId: 11,
        comment: "",
        source: "edit_summary",
      },
    ]);
  });

  it("keeps a move found in both the log and a summary once, as the log has it", () => {
    const log = [
      {
        oldTitle: "Pluto",
        newTitle: "Pluto (dwarf planet)",
        timestamp: "2006-08-24T10:00:00Z",
        revId: 900,
        comment: "x",
      },
    ];
    const fromSummaries = pageMovesFromEditSummaries([
      {
        revId: 50,
        timestamp: "2006-08-24T10:00:30Z",
        comment: "A moved page [[Pluto]] to [[Pluto (dwarf planet)]]: x",
      },
      {
        revId: 51,
        timestamp: "2006-08-25T10:00:00Z",
        comment: "A moved page [[Pluto (dwarf planet)]] to [[Pluto]]: back",
      },
    ]);
    const merged = mergePageMoves(log, fromSummaries);
    expect(merged.map((m) => [m.oldTitle, m.newTitle, m.revId])).toEqual([
      ["Pluto", "Pluto (dwarf planet)", 900],
      ["Pluto (dwarf planet)", "Pluto", 51],
    ]);
    const events = buildPageMoveEvents(merged);
    expect(events[0].deterministicFacts.map((f) => f.fact)).toEqual(["page_moved"]);
    expect(events[1].deterministicFacts).toContainEqual({ fact: "page_move_source", detail: "edit_summary" });
  });
});

describe("shortened-footnote citations", () => {
  const SFN_ARTICLE = [
    "Anarchism is a political philosophy.{{sfn|McLaughlin|2007|p=59}} It rejects hierarchy.{{Sfnp|Kahn|2000}}",
    "Proudhon wrote first.<ref>{{harvnb|Marshall|1993|p=4}}</ref> Others followed {{harvtxt|Woodcock|1962}}.",
    "Again.{{sfn|McLaughlin|2007|p=59}}",
    "== Bibliography ==",
    "* {{cite book |last=McLaughlin |year=2007 |title=Anarchism and Authority}}",
  ].join("\n");

  it("counts sfn- and harv-family templates outside <ref> tags, and each <ref> once", () => {
    expect(countCitationsByKind(SFN_ARTICLE)).toEqual({ refTags: 1, shortFootnotes: 4, total: 5 });
    expect(countCitations(SFN_ARTICLE)).toBe(5);
    expect(countCitations("Plain {{citation needed}} text {{sfnote}}")).toBe(0);
  });

  it("reads nested templates inside a short footnote", () => {
    expect(countCitations("X.{{sfn|Smith|2001|p={{page|4}}}} Y.")).toBe(1);
  });

  it("extractCitations includes short footnotes, the same footnote once, so citation events see them", () => {
    const raws = citationTracker.extractCitations(SFN_ARTICLE).map((c) => c.raw);
    expect(raws).toEqual([
      "<ref>{{harvnb|Marshall|1993|p=4}}</ref>",
      "{{sfn|McLaughlin|2007|p=59}}",
      "{{Sfnp|Kahn|2000}}",
      "{{harvtxt|Woodcock|1962}}",
    ]);
  });

  it("emits citation_removed when a short footnote is removed", () => {
    const base = { pageId: 1, pageTitle: "T", user: "E", size: 0, minor: false, comment: "" };
    const events = buildRevisionEvents([
      {
        ...base,
        revId: 1,
        timestamp: "2026-01-01T00:00:00Z",
        content: "A claim.{{sfn|Smith|2001}} Another.{{sfn|Jones|2002}}",
      },
      { ...base, revId: 2, timestamp: "2026-01-02T00:00:00Z", content: "A claim.{{sfn|Smith|2001}} Another." },
    ]);
    const removed = events.filter((e) => e.eventType === "citation_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].before).toBe("{{sfn|Jones|2002}}");
  });
});
