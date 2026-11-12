import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FAKE_API, installFakeMediaWiki } from "../../../../tests/support/fake-mediawiki.js";
import { CLIENT_OPENING, driveStdioServer } from "../../../../tests/support/mcp-stdio.js";
import { handleToolCall, runMcpServer } from "../commands/mcp.js";
import { acknowledgeReview } from "../commands/review.js";

let restoreFetch: () => void;
beforeAll(() => {
  restoreFetch = installFakeMediaWiki();
});
afterAll(() => restoreFetch());

const call = async (name: string, args: Record<string, unknown>) =>
  JSON.parse((await handleToolCall(name, args)).content[0].text);

describe("snapshot tool", () => {
  it("returns the newest revision at or before the date, with its ID", async () => {
    const result = await call("snapshot", { page: "Earth", at: "2024-01-01T12:00:00Z", api: FAKE_API });
    expect(result).toMatchObject({ pageTitle: "Earth", revisionId: 1000, timestamp: "2024-01-01T00:00:00Z" });
    expect(result.daysBeforeTarget).toBe(0.5);
    expect(result.sections.map((s: { name: string }) => s.name)).toEqual(["Overview", "Atmosphere"]);
    expect(result.text).toContain("mostly nitrogen.");
    expect(result.text).not.toContain("<ref>");
    expect(result).not.toHaveProperty("wikitext");
  });

  it("picks the later revision for a later date and returns wikitext or no text on request", async () => {
    const wikitext = await call("snapshot", { page: "Earth", at: "2024-02-01", api: FAKE_API, content: "wikitext" });
    expect(wikitext.revisionId).toBe(1001);
    expect(wikitext.wikitext).toContain("<ref>{{cite journal");
    const bare = await call("snapshot", { page: "Earth", at: "2024-02-01", api: FAKE_API, content: "none" });
    expect(bare).not.toHaveProperty("text");
    expect(bare).not.toHaveProperty("wikitext");
  });

  it("rejects an invalid date instead of exiting the server", async () => {
    await expect(handleToolCall("snapshot", { page: "Earth", at: "not a date", api: FAKE_API })).rejects.toThrow(
      /Invalid date/,
    );
  });
});

describe("review tool", () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "refract-mcp-review-"));
  });
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

  const stateOf = () => JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8"));

  it("requires an absolute state directory", async () => {
    await expect(handleToolCall("review", { pages: ["Earth"], api: FAKE_API })).rejects.toThrow(/stateDir/);
    await expect(
      handleToolCall("review", { pages: ["Earth"], api: FAKE_API, stateDir: "relative/state" }),
    ).rejects.toThrow(/absolute/);
  });

  it("returns the saved report and writes only inside the state directory", async () => {
    const result = await call("review", { pages: ["Earth"], api: FAKE_API, stateDir, from: 1000 });

    expect(result.format).toBe("refract-review/v1");
    expect(result.pages[0]).toMatchObject({ status: "pending", baselineRevisionId: 1000, fetchedRevisionId: 1001 });
    expect(result.pages[0].inputRevisionIds).toEqual([1000, 1001]);
    expect(result.pages[0]).not.toHaveProperty("inputRevisions");
    expect(result.pages[0].entries.length).toBeGreaterThan(0);
    expect(result.reportPath).toBe(join(stateDir, "reports", `${result.reportId}.json`));

    const saved = JSON.parse(readFileSync(result.reportPath, "utf8"));
    expect(saved.reportId).toBe(result.reportId);
    expect(saved.pages[0].inputRevisions).toHaveLength(2);
    expect(readdirSync(stateDir).sort()).toEqual(["reports", "state.json"]);
  });

  it("never acknowledges; it hands a person the command instead", async () => {
    const result = await call("review", { pages: ["Earth"], api: FAKE_API, stateDir, from: 1000 });

    expect(result.acknowledgment).toMatchObject({ available: true, by: "person" });
    expect(result.acknowledgment.command).toBe(`refract review --state-dir '${stateDir}' --ack ${result.reportId}`);
    expect(Object.values(stateOf().sources)[0]).toMatchObject({ reviewedRevisionId: null });

    // A repeat call keeps the changes pending rather than moving the baseline.
    const again = await call("review", { pages: ["Earth"], api: FAKE_API, stateDir });
    expect(again.pages[0]).toMatchObject({ status: "pending", reviewedRevisionId: null });

    // After the person acknowledges, the next observation starts at that endpoint.
    await acknowledgeReview(again.reportId, stateDir);
    const after = await call("review", { pages: ["Earth"], api: FAKE_API, stateDir });
    expect(after.pages[0]).toMatchObject({ status: "no_changes", reviewedRevisionId: 1001 });
  });

  it("offers no acknowledgment for a page that failed", async () => {
    const fake = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("source unreachable");
    }) as typeof fetch;
    let result: Record<string, any>;
    try {
      result = await call("review", { pages: ["Earth"], api: FAKE_API, stateDir });
    } finally {
      globalThis.fetch = fake;
    }
    expect(result.pages[0].status).toBe("error");
    expect(result.acknowledgment).toMatchObject({ available: false });
    expect(result.acknowledgment).not.toHaveProperty("command");
  });

  it("filters only the view; the report keeps every entry", async () => {
    const result = await call("review", {
      pages: ["Earth"],
      api: FAKE_API,
      stateDir,
      from: 1000,
      eventTypes: ["no_such_event_type"],
    });
    expect(result.view.pages[0].entries).toEqual([]);
    expect(result.pages[0].entries.length).toBeGreaterThan(0);
  });

  it("reviews the bundled sample offline", async () => {
    const result = await call("review", { sample: true, from: 1, stateDir });
    expect(result.pages[0].source.kind).toBe("fictional_sample");
    expect(result.pages[0].status).toBe("pending");
  });
});

describe("tools/list over stdio", () => {
  it("advertises snapshot and review, and no acknowledgment tool", async () => {
    const replies = await driveStdioServer(runMcpServer, CLIENT_OPENING);
    const listed = replies.find((r) => (r.result as { tools?: unknown })?.tools) as {
      result: { tools: { name: string }[] };
    };
    const names = listed.result.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["snapshot", "review"]));
    expect(names.filter((name) => name.includes("ack"))).toEqual([]);
  });
});
