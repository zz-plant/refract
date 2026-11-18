import { afterEach, describe, expect, it, vi } from "vitest";
import { nearestPassage, runClaim, runClaimHistory } from "../commands/claim.js";

const API = "https://wiki.example/w/api.php";
const CLAIM = "The bridge opened to traffic in 2031.";

function revision(revid: number, content: string) {
  return {
    revid,
    parentid: revid - 1,
    timestamp: `2030-0${revid}-01T00:00:00Z`,
    comment: "",
    size: content.length,
    slots: { main: { content } },
  };
}

/**
 * A page whose first revisions predate the claim and whose latest carries it.
 * Answers rvdir=newer with the first two and rvdir=older with the latest two,
 * the way MediaWiki does when a limit is set and no start is.
 */
function pageHistory(url: URL): Response {
  const newestFirst = url.searchParams.get("rvdir") === "older";
  const revisions = newestFirst
    ? [revision(4, `Intro. ${CLAIM}`), revision(3, "Intro.")]
    : [revision(1, "Stub."), revision(2, "Intro.")];
  return new Response(JSON.stringify({ query: { pages: [{ pageid: 1, title: "Bridge", revisions }] } }), {
    headers: { "content-type": "application/json" },
  });
}

describe("claim history reads the latest revisions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports absent when the latest revision removes the passage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              query: {
                pages: [
                  {
                    pageid: 1,
                    title: "Bridge",
                    revisions: [
                      revision(4, "A completely unrelated description of the landscape."),
                      revision(3, CLAIM),
                    ],
                  },
                ],
              },
            }),
          ),
      ),
    );
    const result = await runClaimHistory("Bridge", CLAIM, false, API);
    expect(result.status).toBe("absent");
    expect(result.latestRevisionId).toBe(4);
    expect(result.latestMatch).toBe("none");
    expect(result.historySummary).toContain("Last present");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runClaim("Bridge", CLAIM, false, API);
    expect(log.mock.calls.flat().join("\n")).toContain("Status:      absent");
  });

  describe("--json", () => {
    // A passage added in the History section, reworded once, under markup the
    // matcher has to see through.
    const page = (sentence: string) =>
      `{{Infobox bridge |name=Harbour Bridge}}\n'''Harbour Bridge''' crosses the bay.\n\n== History ==\n${sentence}<ref>{{cite news |title=Opening day}}</ref>\n\n== Design ==\nIt is a [[cable-stayed bridge]].`;
    const history = () =>
      new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                pageid: 7,
                title: "Bridge",
                revisions: [
                  revision(1, "'''Harbour Bridge''' crosses the bay."),
                  revision(2, page(CLAIM)),
                  revision(3, page("The bridge opened to road traffic in 2031.")),
                ],
              },
            ],
          },
        }),
      );
    const run = async (json: boolean) => {
      vi.stubGlobal("fetch", vi.fn(history));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const range = { from: 1, to: 3 };
      await runClaim("Bridge", CLAIM, false, API, undefined, undefined, undefined, range, { json });
      return log.mock.calls.map((call) => call.join(" ")).join("\n");
    };

    it("prints the history as one JSON document and nothing else", async () => {
      const output = await run(true);
      const result = await runClaimHistory("Bridge", CLAIM, false, API, undefined, undefined, undefined, {
        from: 1,
        to: 3,
      });

      expect(JSON.parse(output)).toEqual({ ...result, claimId: expect.stringMatching(/^[0-9a-f]{16}$/) });
      expect(output).toBe(JSON.stringify(JSON.parse(output), null, 2));
      expect(JSON.parse(output)).toMatchObject({
        statement: CLAIM,
        page: "Bridge",
        pageId: 7,
        status: "unknown",
        latestRevisionId: 3,
        latestMatch: "partial",
        revisions: [
          { revisionId: 2, timestamp: "2030-02-01T00:00:00Z", text: CLAIM, section: "History", match: "exact" },
          {
            revisionId: 3,
            timestamp: "2030-03-01T00:00:00Z",
            text: "The bridge opened to road traffic in 2031.",
            section: "History",
            match: "partial",
          },
        ],
      });
    });

    it("carries the claim ID the text output prints", async () => {
      const { claimId } = JSON.parse(await run(true));
      expect(await run(false)).toContain(`Claim ID:    ${claimId}`);
    });

    it("leaves the text output as it was without the flag", async () => {
      const output = await run(false);
      expect(output.split("\n").slice(0, 9)).toEqual([
        'Tracking passage in "Bridge"...',
        `Claim text: "${CLAIM}"`,
        "",
        "[2030-02-01T00:00:00Z] EXACT MATCH (rev 2)",
        `  Matched text: "${CLAIM}"`,
        "[2030-03-01T00:00:00Z] PARTIAL MATCH (rev 3)",
        '  Matched text: "The bridge opened to road traffic in 2031."',
        "",
        "=== Passage History Summary ===",
      ]);
      expect(output).toContain("Status:      unknown");
      expect(() => JSON.parse(output)).toThrow();
    });
  });

  it.each([
    [{ from: 3, to: 4 }, undefined, { rvdir: "newer", rvstartid: "3", rvendid: "4" }],
    [{ from: 3 }, undefined, { rvdir: "newer", rvstartid: "3", rvendid: null }],
    [{ to: 4 }, undefined, { rvdir: "older", rvstartid: "4", rvendid: null }],
  ])("reads the requested revision range %j", async (range, limit, expected) => {
    const fetchMock = vi.fn(async (input: string | URL) => pageHistory(new URL(input)));
    vi.stubGlobal("fetch", fetchMock);
    await runClaimHistory("Bridge", CLAIM, false, API, undefined, undefined, limit, range);
    const url = new URL(fetchMock.mock.calls[0][0]);
    for (const [name, value] of Object.entries(expected)) expect(url.searchParams.get(name)).toBe(value);
  });

  it("rejects a range that runs backward", async () => {
    await expect(
      runClaimHistory("Bridge", CLAIM, false, API, undefined, undefined, undefined, { from: 4, to: 3 }),
    ).rejects.toThrow("start revision must be before");
  });

  it("marks word overlap as uncertain and retains inspectable candidate text", async () => {
    const candidate = "The bridge opened to traffic in 2032.";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              query: { pages: [{ pageid: 1, title: "Bridge", revisions: [revision(4, candidate)] }] },
            }),
          ),
      ),
    );
    const result = await runClaimHistory("Bridge", CLAIM, false, API);
    expect(result.latestMatch).toBe("partial");
    expect(result.revisions[0].match).toBe("partial");
    expect(result.revisions[0].text).toBe(candidate);
    expect(result.caveats.join(" ")).toContain("word overlap");
    expect(result.historySummary).not.toContain("Present continuously");
  });

  it("does not infer absence from withheld text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              query: {
                pages: [
                  {
                    pageid: 1,
                    title: "Bridge",
                    revisions: [{ ...revision(4, ""), texthidden: true }, revision(3, CLAIM)],
                  },
                ],
              },
            }),
          ),
      ),
    );
    const result = await runClaimHistory("Bridge", CLAIM, false, API);
    expect(result.status).toBe("unknown");
    expect(result.latestMatch).toBe("unavailable");
    expect(result.historySummary).not.toContain("then removed");
  });

  it("finds a claim present in the current text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => pageHistory(new URL(String(input)))),
    );

    const result = await runClaimHistory("Bridge", CLAIM, false, API, undefined, undefined, 2);

    // Reading the page's first two revisions, the claim was reported absent.
    expect(result.status).not.toBe("absent");
    expect(result.revisions.map((r) => r.revisionId)).toContain(4);
  });
});

describe("claim history transitions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Added in 2, kept in 3, rewritten past the matcher in 4, put back by an
  // undo in 5, and removed in 7, whose parent 6 was not read.
  const REWRITE = "The bridge carried its first cars in 2031.";
  const revisions = [
    revision(1, "Stub."),
    revision(2, CLAIM),
    revision(3, CLAIM),
    { ...revision(4, REWRITE), comment: "copyedit" },
    { ...revision(5, CLAIM), comment: "Undid revision 4 by Example" },
    revision(7, "Stub, expanded."),
  ];
  const read = async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ query: { pages: [{ pageid: 1, title: "Bridge", revisions }] } })),
      ),
    );
    return runClaimHistory("Bridge", CLAIM, false, API, undefined, undefined, undefined, { from: 1, to: 7 });
  };

  it("places each change between the revisions it lies between and says how long it held", async () => {
    const { transitions } = await read();
    expect(transitions.map((t) => [t.kind, t.previousRevisionId, t.revisionId, t.adjacent, t.heldRevisions])).toEqual([
      ["first_seen", 1, 2, true, 2],
      ["removed", 3, 4, true, 1],
      ["reintroduced", 4, 5, true, 1],
      ["removed", 5, 7, false, 1],
    ]);
    expect(transitions.map((t) => t.endedByRevisionId)).toEqual([4, 5, 7, undefined]);
    expect(transitions[0]).toMatchObject({ before: "", after: CLAIM, endedAt: "2030-04-01T00:00:00Z" });
    expect(transitions[3].endedAt).toBeUndefined();
  });

  it("records revert evidence: the summary and the revision whose text was restored", async () => {
    const { transitions } = await read();
    expect(transitions[2]).toMatchObject({
      kind: "reintroduced",
      editSummary: "Undid revision 4 by Example",
      revertSummary: true,
      restoresRevisionId: 3,
    });
    expect(transitions[1]).toMatchObject({ revertSummary: false, editSummary: "copyedit" });
    expect(transitions[1].restoresRevisionId).toBeUndefined();
  });

  it("shows the nearest remaining sentence on a removal that may be a rewrite, and none when nothing is close", async () => {
    const { transitions } = await read();
    expect(transitions[1].nearest).toEqual({ text: REWRITE, wordOverlap: 0.5 });
    expect(transitions[3].nearest).toBeUndefined();
  });

  it("prints one line per transition", async () => {
    await read();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runClaim("Bridge", CLAIM, false, API, undefined, undefined, undefined, { from: 1, to: 7 });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain(
      "[2030-02-01T00:00:00Z] first seen, rev 1 → 2; held 2 revision(s) until 2030-04-01T00:00:00Z",
    );
    expect(output).toContain("rev 5 → 7 (not adjacent); held 1 revision(s) through the latest read");
    expect(output).toContain("revert summary, restores rev 3");
    expect(output).toContain(`nearest remaining sentence (50% of words): "${REWRITE}"`);
  });
});

describe("nearestPassage", () => {
  it("keeps the sentence with the largest share of the passage's words, from half up", () => {
    expect(nearestPassage("Alpha bravo charlie delta", "Alpha only. Alpha bravo here. Nothing.")).toEqual({
      text: "Alpha bravo here.",
      wordOverlap: 0.5,
    });
    expect(nearestPassage("Alpha bravo charlie delta", "Alpha only. Nothing.")).toBeUndefined();
    expect(nearestPassage("a an the", "a an the")).toBeUndefined();
  });
});
