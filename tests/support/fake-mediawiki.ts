import { createHash } from "node:crypto";

/**
 * A stand-in for the MediaWiki action API, installed over `globalThis.fetch`.
 *
 * Twelve tests used to reach en.wikipedia.org to decide whether they passed.
 * Six of them never needed to: a self-diff compares a wiki against itself, and
 * the throughput test times local section/citation diffing while the fetch that
 * feeds it sits outside the measured window. Those tests were reporting on the
 * sandbox's egress policy, not on this code, and they failed here for a 403
 * that has nothing to do with Refract.
 *
 * The other six check that the client still parses what Wikipedia actually
 * returns. A fixture cannot stand in for those: the assertions would only
 * confirm the shape this file was written to produce. They stay live and are
 * skipped, visibly, when the network is unreachable — see `describeLive`.
 *
 * So this file is deliberately not a recording. It serves the smallest
 * well-formed response each endpoint needs, and no test built on it asserts
 * anything about MediaWiki's contract.
 */

export const FAKE_API = "https://fake.invalid/w/api.php";

const PAGE_ID = 9228;
const PAGE_TITLE = "Earth";

/** Two revisions that differ in one section and one citation, so a differ run
 *  over them produces events rather than an empty list. */
const REVISION_CONTENT = [
  `== Overview ==
Earth is the third planet from the Sun.<ref>{{cite book |title=Planetary Science |year=2001}}</ref>

== Atmosphere ==
The atmosphere is mostly nitrogen.
`,
  `== Overview ==
Earth is the third planet from the Sun.<ref>{{cite book |title=Planetary Science |year=2001}}</ref>

== Atmosphere ==
The atmosphere is mostly nitrogen and oxygen.<ref>{{cite journal |title=Atmospheric Composition |year=2019}}</ref>

== Orbit ==
Earth orbits the Sun once every 365.25 days.
`,
];

function revisionEntries(count: number, direction: "newer" | "older") {
  const entries = REVISION_CONTENT.slice(0, Math.max(2, Math.min(count, REVISION_CONTENT.length))).map(
    (content, index) => ({
      revid: 1000 + index,
      parentid: index === 0 ? 0 : 999 + index,
      user: `Editor${index}`,
      timestamp: `2024-01-0${index + 1}T00:00:00Z`,
      comment: index === 0 ? "Initial version" : "Expand atmosphere section",
      size: content.length,
      minor: false,
      slots: { main: { content } },
    }),
  );
  return direction === "newer" ? entries : [...entries].reverse();
}

/**
 * A page history a test supplies, for tests of what the client does with a
 * long history: paging metadata, picking revisions, hydrating them by ID.
 * Without one, the two Earth revisions above are served.
 */
export interface FakeHistoryRevision {
  revid: number;
  timestamp: string;
  content: string;
  comment?: string;
  user?: string;
}

export interface FakeMediaWikiOptions {
  history?: FakeHistoryRevision[];
  /** Entries for `list=logevents&letype=move`, keyed by the title queried. */
  moveLog?: Record<string, Array<{ logid: number; title: string; timestamp: string; target: string; comment?: string }>>;
}

/** What the fake saw since it was installed. */
export const fakeMediaWikiStats = { requests: [] as URL[], maxInFlight: 0 };

function sha1Of(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function historyEntry(rev: FakeHistoryRevision, index: number, history: FakeHistoryRevision[], withContent: boolean) {
  return {
    revid: rev.revid,
    parentid: index === 0 ? 0 : history[index - 1].revid,
    user: rev.user ?? `Editor${index}`,
    timestamp: rev.timestamp,
    comment: rev.comment ?? "",
    size: rev.content.length,
    minor: false,
    ...(withContent ? { slots: { main: { content: rev.content } } } : { sha1: sha1Of(rev.content) }),
  };
}

/** Serves `history` the way the action API does: newest first by default, `rvlimit` rows a page, `rvcontinue` to go on. */
function respondFromHistory(params: URLSearchParams, history: FakeHistoryRevision[]): Response {
  const page = (revisions: unknown[], cont?: string) =>
    json({
      query: { pages: [{ pageid: PAGE_ID, title: params.get("titles") ?? PAGE_TITLE, revisions }] },
      ...(cont ? { continue: { rvcontinue: cont, continue: "||" } } : {}),
    });

  const revids = params.get("revids");
  if (revids) {
    const wanted = new Set(revids.split("|").map(Number));
    return page(
      history.flatMap((rev, index) => (wanted.has(rev.revid) ? [historyEntry(rev, index, history, true)] : [])),
    );
  }

  const ordered = history.map((rev, index) => ({ rev, index }));
  if (params.get("rvdir") !== "newer") ordered.reverse();
  const offset = Number(params.get("rvcontinue") ?? "0");
  const limit = Number(params.get("rvlimit") ?? "1");
  const withContent = (params.get("rvprop") ?? "").includes("content");
  const slice = ordered.slice(offset, offset + limit);
  const next = offset + limit < ordered.length ? String(offset + limit) : undefined;
  return page(
    slice.map(({ rev, index }) => historyEntry(rev, index, history, withContent)),
    next,
  );
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Dispatches on the same parameters mediawiki-client.ts sets. Anything this
 *  does not recognise throws rather than returning a plausible empty result —
 *  a silent `{}` would let a test pass while exercising nothing. */
function respond(url: URL, options: FakeMediaWikiOptions): Response {
  const params = url.searchParams;
  const action = params.get("action");

  if (action === "compare") {
    const fromrev = Number(params.get("fromrev"));
    const torev = Number(params.get("torev"));
    return json({
      compare: {
        fromrevid: fromrev,
        torevid: torev,
        fromsize: REVISION_CONTENT[0].length,
        tosize: REVISION_CONTENT[1].length,
        "*":
          '<tr><td class="diff-deletedline"><div>The atmosphere is mostly nitrogen.</div></td>' +
          '<td class="diff-addedline"><div>The atmosphere is mostly nitrogen and oxygen.</div></td></tr>',
      },
    });
  }

  if (action !== "query") {
    throw new Error(`fake-mediawiki: unhandled action "${action}" (${url.href})`);
  }

  const list = params.get("list");

  if (list === "logevents" && params.get("letype") === "move" && options.moveLog) {
    const entries = options.moveLog[params.get("letitle") ?? ""] ?? [];
    return json({
      query: {
        logevents: entries.map((e) => ({
          logid: e.logid,
          title: e.title,
          timestamp: e.timestamp,
          comment: e.comment ?? "",
          params: { target_title: e.target },
        })),
      },
    });
  }

  if (list === "logevents") {
    // Both the move log and the protection log are empty here. The tests built
    // on this file assert on shape and on diff arithmetic, never that a page
    // has been moved or protected.
    return json({ query: { logevents: [] } });
  }

  if (list === "search") {
    return json({ query: { search: [{ title: PAGE_TITLE, pageid: PAGE_ID }] } });
  }

  if (params.get("prop") === "revisions" && options.history) {
    return respondFromHistory(params, options.history);
  }

  if (params.get("prop") === "revisions") {
    const title = params.get("titles") ?? PAGE_TITLE;
    const direction = params.get("rvdir") === "newer" ? "newer" : "older";
    const limit = Number(params.get("rvlimit") ?? "2");
    return json({
      query: {
        pages: [
          {
            pageid: PAGE_ID,
            title,
            revisions: revisionEntries(limit, direction),
          },
        ],
      },
    });
  }

  throw new Error(`fake-mediawiki: unhandled query (${url.href})`);
}

/**
 * Replaces `globalThis.fetch` for the duration of a test file. Returns the
 * restore function; call it in `afterAll`.
 */
export function installFakeMediaWiki(options: FakeMediaWikiOptions = {}): () => void {
  const original = globalThis.fetch;
  fakeMediaWikiStats.requests = [];
  fakeMediaWikiStats.maxInFlight = 0;
  let inFlight = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    fakeMediaWikiStats.requests.push(url);
    inFlight++;
    fakeMediaWikiStats.maxInFlight = Math.max(fakeMediaWikiStats.maxInFlight, inFlight);
    try {
      // Yield once so requests a client sends together are in flight together.
      await new Promise((resolve) => setTimeout(resolve, 1));
      return respond(url, options);
    } finally {
      inFlight--;
    }
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
