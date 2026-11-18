import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runAnalyze } from "../commands/analyze.js";
import { runClaimHistory } from "../commands/claim.js";
import { readRevisionsFromSource, revisionSourceFromOptions, waybackTarget } from "../commands/revision-source.js";

function revisionXml(id: number, parent: number | undefined, day: number, text: string, comment = ""): string {
  return `    <revision>
      <id>${id}</id>${parent ? `\n      <parentid>${parent}</parentid>` : ""}
      <timestamp>2026-01-${String(day).padStart(2, "0")}T00:00:00Z</timestamp>
      <contributor><username>Editor${id}</username></contributor>
      <comment>${comment}</comment>
      <text xml:space="preserve">${text}</text>
    </revision>`;
}

const SOURCED = "The bridge opened in 2031.&lt;ref&gt;https://news.example/bridge&lt;/ref&gt;";
const DUMP = `<mediawiki>
  <page>
    <title>Bridge</title>
    <id>7</id>
${revisionXml(100, undefined, 1, "The bridge was planned.")}
${revisionXml(200, 100, 2, SOURCED)}
${revisionXml(300, 200, 3, "The bridge opened in 2031.")}
${revisionXml(400, 300, 4, SOURCED, "copyedit")}
  </page>
</mediawiki>`;

let dir: string;
let dump: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "refract-source-"));
  dump = join(dir, "export.xml");
  writeFileSync(dump, DUMP, "utf-8");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("revisionSourceFromOptions", () => {
  it("names the dump or the archive, and refuses both", () => {
    expect(revisionSourceFromOptions({})).toBeUndefined();
    expect(revisionSourceFromOptions({ dump: "x.xml" })).toEqual({ kind: "dump", path: "x.xml" });
    expect(revisionSourceFromOptions({ wayback: true })).toEqual({ kind: "wayback" });
    expect(() => revisionSourceFromOptions({ dump: "x.xml", wayback: true })).toThrow(/not both/);
  });
});

describe("waybackTarget", () => {
  it("uses a URL as given and builds an article URL from a title", () => {
    expect(waybackTarget("https://example.org/page")).toBe("https://example.org/page");
    expect(waybackTarget("ANI v. Wikimedia Foundation")).toBe(
      "https://en.wikipedia.org/wiki/ANI_v._Wikimedia_Foundation",
    );
    expect(waybackTarget("Каллас, Кая", "https://ru.wikipedia.org/w/api.php")).toBe(
      `https://ru.wikipedia.org/wiki/${encodeURIComponent("Каллас,_Кая")}`,
    );
  });
});

describe("readRevisionsFromSource", () => {
  const ids = async (range: Parameters<typeof readRevisionsFromSource>[2]) =>
    (await readRevisionsFromSource({ kind: "dump", path: dump }, "Bridge", range)).map((r) => r.revId);

  it("bounds by revision ID and keeps the latest or earliest N as asked", async () => {
    expect(await ids({})).toEqual([100, 200, 300, 400]);
    expect(await ids({ fromRevId: 200, toRevId: 300 })).toEqual([200, 300]);
    expect(await ids({ limit: 2, newest: true })).toEqual([300, 400]);
    expect(await ids({ limit: 2 })).toEqual([100, 200]);
    expect(await ids({ since: "2026-01-03T00:00:00Z" })).toEqual([300, 400]);
  });
});

describe("analysis from a dump", () => {
  it("reads only the file: no request leaves the machine", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network used");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { events, revisions, coverage } = await runAnalyze(
      "Bridge",
      "detailed",
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { source: { kind: "dump", path: dump }, recordObservation: false },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(revisions.map((r) => r.revId)).toEqual([100, 200, 300, 400]);
    // Parent links from the export make continuity checkable.
    expect(coverage?.status).toBe("complete");
    const types = events.map((e) => e.eventType);
    expect(types).toContain("citation_removed");
    // Revision 400 restores revision 200's text under a summary that says nothing.
    expect(events.find((e) => e.eventType === "revert_detected" && e.toRevisionId === 400)).toBeTruthy();
  });

  it("tracks a passage from a dump", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network used");
      }),
    );
    const result = await runClaimHistory(
      "Bridge",
      "opened in 2031",
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        source: { kind: "dump", path: dump },
      },
    );
    expect(result.status).toBe("present");
    expect(result.revisions[0].revisionId).toBe(200);
  });
});
