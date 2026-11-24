import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_API, installFakeMediaWiki } from "../../../../tests/support/fake-mediawiki.js";
import { runAnalyze } from "../commands/analyze.js";

// The move log is keyed by the title moved from, so a query for "Pluto" lists
// the move away from it and not the move back. The move back is in the page's
// own history, as the null revision a move leaves.
describe("analyze reports moves into the page", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = installFakeMediaWiki({
      history: [
        { revid: 1, timestamp: "2006-08-24T00:00:00Z", content: "Pluto is a planet." },
        {
          revid: 2,
          timestamp: "2006-08-24T12:00:00Z",
          content: "Pluto is a planet.",
          comment: "Someone moved page [[Pluto]] to [[Pluto (dwarf planet)]]: per IAU",
        },
        {
          revid: 3,
          timestamp: "2006-09-07T00:00:00Z",
          content: "Pluto is a planet.",
          comment: "Someone moved page [[Pluto (dwarf planet)]] to [[Pluto]]: undo move",
        },
        { revid: 4, timestamp: "2006-09-08T00:00:00Z", content: "Pluto is a dwarf planet." },
      ],
      moveLog: {
        Pluto: [
          {
            logid: 900,
            title: "Pluto",
            timestamp: "2006-08-24T12:00:00Z",
            target: "Pluto (dwarf planet)",
            comment: "per IAU",
          },
        ],
      },
    });
  });
  afterAll(() => restore());

  it("emits the logged move once and the move back from its edit summary, with no mover named", async () => {
    const { events } = await runAnalyze(
      "Pluto",
      "detailed",
      undefined,
      undefined,
      undefined,
      false,
      FAKE_API,
      undefined,
      undefined,
      undefined,
      undefined,
      { recordObservation: false },
    );
    const moves = events.filter((e) => e.eventType === "page_moved");
    expect(moves.map((e) => [e.before, e.after, e.toRevisionId])).toEqual([
      ["Pluto", "Pluto (dwarf planet)", 900],
      ["Pluto (dwarf planet)", "Pluto", 3],
    ]);
    expect(JSON.stringify(moves)).not.toContain("Someone");
  });
});
