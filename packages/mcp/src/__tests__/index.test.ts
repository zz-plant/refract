import { describe, expect, it, vi } from "vitest";
import { CLIENT_OPENING, driveStdioServer } from "../../../../tests/support/mcp-stdio.js";
import { handleToolCall, type McpServerOptions, runMcpServer } from "../index.js";

// The stdio tests send no tool call, so these handlers are never called.
const options: McpServerOptions = { analyze: vi.fn(), claim: vi.fn(), exportData: vi.fn(), cron: vi.fn() };
const run = () => runMcpServer(options);

describe("mcp stdio transport", () => {
  it("answers requests and stays silent on notifications/initialized", async () => {
    const replies = await driveStdioServer(run, CLIENT_OPENING);

    expect(replies.map((r) => r.id)).toEqual([1, 2]);
    expect(replies.every((r) => r.error === undefined)).toBe(true);
  });

  it("never answers a notification, known or not, but still rejects an unknown request", async () => {
    const replies = await driveStdioServer(run, [
      { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1, reason: "client gave up" } },
      { jsonrpc: "2.0", method: "notifications/not-a-method" },
      { jsonrpc: "2.0", id: 3, method: "not/a-method" },
      { jsonrpc: "2.0", id: 4, method: "initialized" },
    ]);

    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 3, error: { code: -32601, message: "Method not found: not/a-method" } },
      { jsonrpc: "2.0", id: 4, error: { code: -32601, message: "Method not found: initialized" } },
    ]);
  });
});

describe("get_statement_history", () => {
  it("passes the page and API URL to the consumer's callback", async () => {
    const getStatementHistory = vi.fn(async () => ({
      revisions: [{ revisionId: 12, timestamp: "2024-01-02T00:00:00Z", section: "History" }],
      status: "present",
      historySummary: "Tracked.",
    }));
    const result = await handleToolCall(
      "get_statement_history",
      { statement: "Pluto is a dwarf planet.", page: "Pluto", api: "https://de.wikipedia.org/w/api.php" },
      { ...options, getStatementHistory },
    );

    expect(getStatementHistory).toHaveBeenCalledExactlyOnceWith("Pluto is a dwarf planet.", "Pluto", {
      api: "https://de.wikipedia.org/w/api.php",
    });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ page: "Pluto", status: "present" });
  });

  it("reports a missing callback instead of throwing", async () => {
    const result = await handleToolCall("get_statement_history", { statement: "x", page: "Pluto" }, options);

    expect(result.content[0].text).toBe("Error: no get_statement_history handler configured");
  });
});
