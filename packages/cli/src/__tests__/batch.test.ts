import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventIdentity } from "@refract-org/evidence-graph";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FAKE_API, installFakeMediaWiki } from "../../../../tests/support/fake-mediawiki.js";
import { runAnalyze } from "../commands/analyze.js";
import { forEachPage, readPagesFile } from "../commands/batch.js";
import { runClaimBatch } from "../commands/claim.js";
import { runBatchExport } from "../commands/export.js";
import { runFieldBatch } from "../commands/field.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("readPagesFile", () => {
  it("skips blank lines and comments and trims titles", () => {
    const dir = mkdtempSync(join(tmpdir(), "pages-"));
    try {
      const path = join(dir, "pages.txt");
      writeFileSync(path, "# conflict articles\nEarth\n\n  Mars  \n#Venus\n");
      expect(readPagesFile(path)).toEqual(["Earth", "Mars"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("forEachPage", () => {
  it("emits in the order given, however the work finishes", async () => {
    const order: string[] = [];
    const finishTimes: Record<string, number> = { a: 30, b: 0, c: 10, d: 0 };
    await forEachPage(
      Object.keys(finishTimes),
      4,
      async (title) => {
        await delay(finishTimes[title]);
        return title.toUpperCase();
      },
      ({ result }) => order.push(result as string),
    );
    expect(order).toEqual(["A", "B", "C", "D"]);
  });

  it("reports a failed page in its place and carries on", async () => {
    const seen: string[] = [];
    const { failed } = await forEachPage(
      ["a", "bad", "c"],
      2,
      async (title) => {
        if (title === "bad") throw new Error("no such page");
        return title;
      },
      ({ title, result, error }) => seen.push(result ?? `${title}: ${error}`),
    );
    expect(failed).toBe(1);
    expect(seen).toEqual(["a", "bad: no such page", "c"]);
  });

  it("runs no more than the concurrency at once", async () => {
    let running = 0;
    let peak = 0;
    await forEachPage(
      ["a", "b", "c", "d", "e"],
      2,
      async () => {
        running++;
        peak = Math.max(peak, running);
        await delay(5);
        running--;
      },
      () => {},
    );
    expect(peak).toBe(2);
  });
});

describe("batch commands against a fake wiki", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = installFakeMediaWiki();
  });
  afterAll(() => restore());
  afterEach(() => vi.restoreAllMocks());

  /** Wraps the fake so that one title fails, as a page missing from the wiki would. */
  function failFor(title: string) {
    const fake = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(href).searchParams.get("titles") === title) throw new Error("fetch failed");
      return fake(input, init);
    });
  }

  it("exports each page's events with its title, and the ids a single-page export gives", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lines: string[] = [];
    const { failed, events } = await runBatchExport(["Earth", "Mars"], {
      apiUrl: FAKE_API,
      write: (line) => lines.push(line),
    });
    const records = lines.map((line) => JSON.parse(line));
    expect(failed).toBe(0);
    expect(records).toHaveLength(events);
    expect(records.length).toBeGreaterThan(0);
    expect(new Set(records.map((r) => r.pageTitle))).toEqual(new Set(["Earth", "Mars"]));
    // Earth's lines all come before Mars's.
    const firstMars = records.findIndex((r) => r.pageTitle === "Mars");
    expect(records.slice(firstMars).every((r) => r.pageTitle === "Mars")).toBe(true);

    const single = await runAnalyze("Earth", "detailed", undefined, undefined, undefined, false, FAKE_API);
    const singleIds = single.events.map((e) => e.eventId ?? createEventIdentity(e));
    expect(records.filter((r) => r.pageTitle === "Earth").map((r) => r.eventId)).toEqual(singleIds);
  });

  it("skips a page that fails and counts it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failFor("Broken");
    const lines: string[] = [];
    const { failed } = await runBatchExport(["Earth", "Broken"], { apiUrl: FAKE_API, write: (l) => lines.push(l) });
    expect(failed).toBe(1);
    expect(lines.every((line) => JSON.parse(line).pageTitle === "Earth")).toBe(true);
  });

  it("tracks a passage across pages as one JSON line per page", async () => {
    failFor("Broken");
    const lines: string[] = [];
    const { failed } = await runClaimBatch(
      ["Earth", "Broken", "Mars"],
      "third planet from the Sun",
      FAKE_API,
      undefined,
      undefined,
      2,
      { json: true, write: (l) => lines.push(l) },
    );
    const records = lines.map((line) => JSON.parse(line));
    expect(failed).toBe(1);
    expect(records.map((r) => [r.page, r.status])).toEqual([
      ["Earth", "present"],
      ["Broken", "error"],
      ["Mars", "present"],
    ]);
    expect(records[0].claimId).toEqual(expect.any(String));
  });

  it("tracks a field across pages", async () => {
    const lines: string[] = [];
    const { failed } = await runFieldBatch(["Earth"], { param: "title" }, FAKE_API, undefined, undefined, 1, {
      json: true,
      write: (l) => lines.push(l),
    });
    expect(failed).toBe(0);
    expect(JSON.parse(lines[0])).toMatchObject({ page: "Earth", param: "title" });
  });
});
