import { afterEach, describe, expect, it } from "vitest";
import { FAKE_API, installFakeMediaWiki } from "../../../../tests/support/fake-mediawiki.js";
import { MediaWikiClient } from "../mediawiki-client.js";
import { protectionLevel, protectionReasonCategory } from "../protection-log.js";

/**
 * Entries as English Wikipedia's API returned them on 2026-11-24
 * (`list=logevents&letype=protect&leprop=ids|title|type|timestamp|comment|details`),
 * with the reading each should get. Three eras of the log are here: entries
 * since about 2015 carry `details`, 2009–2014 entries a `description`, and
 * earlier ones the levels only at the end of the comment.
 */
const ENTRIES = {
  Pluto: [
    {
      logid: 57487150,
      timestamp: "2014-07-09T19:06:16Z",
      action: "modify",
      comment:
        "[[WP:PP#Content disputes|Edit warring / content dispute]]: Short-term full protection to allow discussion on talk page",
      params: { description: "‎[edit=sysop] (expires 19:06, 11 July 2014 (UTC))‎[move=sysop] (indefinite)" },
      expected: { level: "full", reasonCategory: "content_dispute" },
    },
    {
      logid: 57512369,
      timestamp: "2014-07-11T01:44:19Z",
      action: "modify",
      comment: "Talk page discussion is productive; returning to past level of protection",
      params: { description: "‎[edit=autoconfirmed] (indefinite)‎[move=sysop] (indefinite)" },
      expected: { level: "semi", reasonCategory: "other" },
    },
    {
      // Pending changes, with only a move restriction left.
      logid: 30033191,
      timestamp: "2010-06-22T01:43:25Z",
      action: "modify",
      comment: "[[Wikipedia:Pending changes|Pending changes]] trial",
      params: { description: "[move=sysop] (indefinite)" },
      expected: { level: undefined, reasonCategory: "other" },
    },
    {
      logid: 14224773,
      timestamp: "2008-03-12T18:47:37Z",
      action: "protect",
      comment: "FA; nearly all edits are vandalism and reversion of vandalism [edit=autoconfirmed:move=autoconfirmed]",
      params: {},
      expected: { level: "semi", reasonCategory: "vandalism" },
    },
    {
      logid: 13478976,
      timestamp: "2008-02-04T22:18:20Z",
      action: "protect",
      comment:
        "edit war from dynamic IP [edit=autoconfirmed:move=autoconfirmed] (expires 22:18, 11 February 2008 (UTC))",
      params: {},
      expected: { level: "semi", reasonCategory: "content_dispute" },
    },
    {
      logid: 11193573,
      timestamp: "2007-10-03T02:47:48Z",
      action: "protect",
      comment: "trying that again [move=sysop] (expires 00:00, 8 October 2007 (UTC))",
      params: {},
      expected: { level: undefined, reasonCategory: "other" },
    },
  ],
  Anarchism: [
    {
      logid: 116237384,
      timestamp: "2021-03-16T13:03:20Z",
      action: "modify",
      comment: "Persistent [[WP:Disruptive editing|disruptive editing]]",
      params: {
        details: [
          { type: "edit", level: "autoconfirmed", expiry: "infinite", cascade: false },
          { type: "move", level: "sysop", expiry: "2021-06-16T13:03:20Z", cascade: false },
        ],
      },
      expected: { level: "semi", reasonCategory: "disruption" },
    },
    {
      logid: 107442967,
      timestamp: "2020-04-20T19:45:52Z",
      action: "modify",
      comment: "Persistent addition of [[WP:INTREF|unsourced or poorly sourced content]]",
      params: {
        details: [
          { type: "edit", level: "autoconfirmed", expiry: "2020-05-20T19:45:52Z", cascade: false },
          { type: "move", level: "sysop", expiry: "infinite", cascade: false },
        ],
      },
      expected: { level: "semi", reasonCategory: "sourcing" },
    },
    {
      logid: 57225363,
      timestamp: "2014-06-24T15:21:46Z",
      action: "modify",
      comment: "Persistent [[WP:Sock puppetry|sock-puppetry]]",
      params: {
        description: "‎[edit=autoconfirmed] (expires 15:21, 24 December 2014 (UTC))‎[move=sysop] (indefinite)",
      },
      expected: { level: "semi", reasonCategory: "sockpuppetry" },
    },
    {
      // 2012–13 entries name the levels by their English labels.
      logid: 47270255,
      timestamp: "2013-02-06T18:45:12Z",
      action: "modify",
      comment: "Persistent [[WP:Sock puppetry|sock puppetry]]: per edit filter log",
      params: {
        description:
          "[Edit=Block new and unregistered users] (expires 18:45, 6 March 2013 (UTC)) [Move=Block all non-admin users] (indefinite)",
      },
      expected: { level: "semi", reasonCategory: "sockpuppetry" },
    },
    {
      logid: 25140468,
      timestamp: "2009-10-11T11:27:30Z",
      action: "modify",
      comment: "[[WP:PPOL#Content disputes|Edit warring / Content dispute]]",
      params: { description: "[edit=autoconfirmed] (expires 11:27, 12 October 2009 (UTC)) [move=sysop] (indefinite)" },
      expected: { level: "semi", reasonCategory: "content_dispute" },
    },
    {
      // The only link names a tool, so the wording decides.
      logid: 25020987,
      timestamp: "2009-10-04T19:38:10Z",
      action: "modify",
      comment: "Full protection: dispute, Edit war/content dispute. using [[WP:TW|TW]]",
      params: {
        description:
          "[edit=sysop] (expires 19:38, 5 October 2009 (UTC)) [move=sysop] (expires 19:38, 5 October 2009 (UTC))",
      },
      expected: { level: "full", reasonCategory: "content_dispute" },
    },
    {
      logid: 5482523,
      timestamp: "2006-11-16T12:39:09Z",
      action: "protect",
      comment: "Edit warring [edit=sysop:move=sysop]",
      params: {},
      expected: { level: "full", reasonCategory: "content_dispute" },
    },
    {
      // An edit war fought over vandalism accusations is an edit war.
      logid: 1327811,
      timestamp: "2006-01-05T17:10:27Z",
      action: "protect",
      comment: "the same childish revert war with vandalism accusations [edit=sysop:move=sysop]",
      params: {},
      expected: { level: "full", reasonCategory: "content_dispute" },
    },
    {
      logid: 3317643,
      timestamp: "2006-06-28T19:12:50Z",
      action: "protect",
      comment: "protection from banned user utilizing numerous open proxies [edit=autoconfirmed:move=sysop]",
      params: {},
      expected: { level: "semi", reasonCategory: "sockpuppetry" },
    },
    {
      logid: 11157107,
      timestamp: "2007-10-01T04:16:11Z",
      action: "protect",
      comment: "page move vandalism [move=sysop] (expires 04:16, November 5, 2007 (UTC))",
      params: {},
      expected: { level: undefined, reasonCategory: "vandalism" },
    },
    {
      // Logged before levels were: none to read.
      logid: 822076,
      timestamp: "2005-10-30T20:46:16Z",
      action: "protect",
      comment: "long edit wars over two versions of the article",
      params: {},
      expected: { level: undefined, reasonCategory: "content_dispute" },
    },
    {
      // An unprotection is read the same way: this is what the comment says,
      // not why protection began.
      logid: 1736270,
      timestamp: "2006-02-16T20:56:24Z",
      action: "unprotect",
      comment: "don't use [[WP:SEMI]] in edit wars, and don't protect in edit wars on articles you are editing",
      params: {},
      expected: { level: undefined, reasonCategory: "content_dispute" },
    },
  ],
  "Cultural Marxism conspiracy theory": [
    {
      logid: 179746350,
      timestamp: "2026-04-15T16:11:20Z",
      action: "modify",
      comment: "[[WP:PP#Content disputes|Edit warring / content dispute]]",
      params: {
        description: "‎[edit=sysop] (expires 16:11, 22 April 2026 (UTC))",
        details: [{ type: "edit", level: "sysop", expiry: "2026-04-22T16:11:18Z", cascade: false }],
      },
      expected: { level: "full", reasonCategory: "content_dispute" },
    },
    {
      logid: 155814268,
      timestamp: "2023-11-27T17:00:33Z",
      action: "protect",
      comment: "Persistent [[WP:Vandalism|vandalism]]",
      params: { details: [{ type: "edit", level: "autoconfirmed", expiry: "2025-05-27T17:00:32Z", cascade: false }] },
      expected: { level: "semi", reasonCategory: "vandalism" },
    },
    {
      logid: 146365997,
      timestamp: "2023-05-02T17:18:11Z",
      action: "protect",
      comment: "Persistent [[WP:Disruptive editing|disruptive editing]]: requested at [[WP:RFPP]]",
      params: {
        details: [
          { type: "edit", level: "extendedconfirmed", expiry: "2026-05-02T17:18:11Z", cascade: false },
          { type: "move", level: "extendedconfirmed", expiry: "2026-05-02T17:18:11Z", cascade: false },
        ],
      },
      expected: { level: "extended", reasonCategory: "disruption" },
    },
    {
      logid: 115579485,
      timestamp: "2021-02-21T05:44:20Z",
      action: "unprotect",
      comment: "Request",
      params: {},
      expected: { level: undefined, reasonCategory: "other" },
    },
  ],
};

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("fetchProtectionLogs", () => {
  it("reads each entry's level and reason category from real Pluto, Anarchism and CMCT log entries", async () => {
    restore = installFakeMediaWiki({
      protectionLog: Object.fromEntries(
        Object.entries(ENTRIES).map(([title, entries]) => [title, entries.map(({ expected: _, ...entry }) => entry)]),
      ),
    });
    const client = new MediaWikiClient({ apiUrl: FAKE_API, minDelayMs: 0 });

    for (const [title, entries] of Object.entries(ENTRIES)) {
      const logs = await client.fetchProtectionLogs(title);
      expect(logs.map((l) => ({ logId: l.logId, level: l.level, reasonCategory: l.reasonCategory }))).toEqual(
        entries.map((e) => ({ logId: e.logid, ...e.expected })),
      );
    }
  });

  it("leaves level off an entry without one rather than setting it undefined", async () => {
    const { expected: _, ...moveOnly } = ENTRIES.Pluto[5];
    restore = installFakeMediaWiki({ protectionLog: { Pluto: [moveOnly] } });
    const [entry] = await new MediaWikiClient({ apiUrl: FAKE_API, minDelayMs: 0 }).fetchProtectionLogs("Pluto");
    expect("level" in entry).toBe(false);
  });
});

describe("protectionReasonCategory", () => {
  it("takes the first link that names a policy, whatever comes before it", () => {
    expect(
      protectionReasonCategory(
        "Restoring protection by [[User:Example|Example]]: Persistent [[WP:Disruptive editing|disruptive editing]]",
      ),
    ).toBe("disruption");
    expect(protectionReasonCategory("[[Wikipedia:Verifiability|Unsourced additions]]")).toBe("sourcing");
    expect(protectionReasonCategory("[[WP:MOVEVANDAL|Page-move vandalism]]")).toBe("vandalism");
  });

  it("reads a policy link over the comment's wording", () => {
    // "edit war" would make this a content dispute by wording alone.
    expect(protectionReasonCategory("Persistent [[WP:Vandalism|vandalism]] after an edit war")).toBe("vandalism");
  });

  it("does not read an editor's name as a reason", () => {
    expect(protectionReasonCategory("Requested by [[User:Vandalwatch|Vandalwatch]]")).toBe("other");
    expect(protectionReasonCategory("Requested by [[User talk:Sockfinder|talk]]")).toBe("other");
  });

  it("is other for an empty comment", () => {
    expect(protectionReasonCategory("")).toBe("other");
  });
});

describe("protectionLevel", () => {
  it("prefers the edit restriction in details, then the create restriction", () => {
    expect(
      protectionLevel({
        comment: "",
        details: [
          { type: "move", level: "sysop" },
          { type: "edit", level: "templateeditor" },
        ],
      }),
    ).toBe("template");
    expect(
      protectionLevel({ comment: "[[WP:SALT|Repeatedly recreated]]", details: [{ type: "create", level: "sysop" }] }),
    ).toBe("full");
    expect(protectionLevel({ comment: "", details: [{ type: "move", level: "sysop" }] })).toBeUndefined();
  });

  it("reads a description before the comment", () => {
    expect(protectionLevel({ comment: "[edit=sysop]", description: "[edit=autoconfirmed] (indefinite)" })).toBe("semi");
  });

  it("leaves a level it does not know unread", () => {
    expect(protectionLevel({ comment: "", details: [{ type: "edit", level: "autoreview" }] })).toBeUndefined();
  });
});
