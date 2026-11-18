import { describe, expect, it, vi } from "vitest";

vi.mock("../commands/claim.js", () => ({
  runClaim: vi.fn(),
  runClaimHistory: vi.fn(),
}));

import { CLIENT_OPENING, driveStdioServer } from "../../../../tests/support/mcp-stdio.js";
import { runClaimHistory } from "../commands/claim.js";
import { handleToolCall, runMcpServer, TOOLS } from "../commands/mcp.js";

describe("mcp server", () => {
  it("exposes latest presence and matching uncertainty to agent consumers", async () => {
    vi.mocked(runClaimHistory).mockResolvedValue({
      statement: "A passage",
      page: "Page",
      status: "present",
      historySummary: "Matched candidate.",
      latestRevisionId: 7,
      latestMatch: "partial",
      caveats: ["Sentence word overlap only"],
      revisions: [
        { revisionId: 7, timestamp: "2025-01-01T00:00:00Z", text: "Candidate text", section: "Lead", match: "partial" },
      ],
    });
    const result = await handleToolCall("get_statement_history", {
      statement: "A passage",
      page: "Page",
      depth: "detailed",
    });
    const response = JSON.parse(result.content[0].text);
    expect(response.latest_match).toBe("partial");
    expect(response.latest_revision_id).toBe(7);
    expect(response.caveats).toEqual(["Sentence word overlap only"]);
    expect(response.revisions[0]).toMatchObject({ text: "Candidate text", match: "partial" });
  });

  it("registers get_statement_history in tools list", () => {
    const tool = TOOLS.find((t) => t.name === "get_statement_history");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(["statement", "page"]);
    expect(tool?.inputSchema.properties).toHaveProperty("statement");
    expect(tool?.inputSchema.properties).toHaveProperty("page");
    expect(tool?.inputSchema.properties).toHaveProperty("context");
    expect(tool?.inputSchema.properties).toHaveProperty("depth");
    expect(tool?.inputSchema.properties).toHaveProperty("api");
  });

  it("get_statement_history returns a valid response shape", async () => {
    vi.mocked(runClaimHistory).mockResolvedValue({
      statement: "Earth is the third planet from the Sun",
      page: "Earth",
      revisions: [
        {
          revisionId: 100,
          timestamp: "2024-01-01T00:00:00Z",
          text: "Earth is the third planet from the Sun.",
          section: "(lead)",
        },
        {
          revisionId: 101,
          timestamp: "2024-01-02T00:00:00Z",
          text: "Earth is the third planet from the Sun and the only astronomical object known to harbor life.",
          section: "(lead)",
        },
      ],
      status: "modified",
      historySummary: "Statement appeared, then wording expanded.",
    });

    const result = await handleToolCall("get_statement_history", {
      statement: "Earth is the third planet from the Sun",
      page: "Earth",
      depth: "detailed",
    });

    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    const json = JSON.parse(text);

    expect(json.statement).toBe("Earth is the third planet from the Sun");
    expect(json.page).toBe("Earth");
    expect(json.revisions).toHaveLength(2);
    expect(json.revisions[0]).toHaveProperty("revisionId");
    expect(json.revisions[0]).toHaveProperty("timestamp");
    expect(json.status).toBe("modified");
    expect(json.history_summary).toBeTruthy();
    expect(["present", "absent", "modified", "contested"]).toContain(json.status);
  });

  it("get_statement_history defaults depth to detailed", async () => {
    vi.mocked(runClaimHistory).mockResolvedValue({
      statement: "Mars is a planet",
      page: "Mars",
      revisions: [{ revisionId: 1, timestamp: "2024-01-01T00:00:00Z", text: "Mars is a planet.", section: "(lead)" }],
      status: "present",
      historySummary: "Present continuously.",
    });

    await handleToolCall("get_statement_history", {
      statement: "Mars is a planet",
      page: "Mars",
    });

    expect(runClaimHistory).toHaveBeenCalledWith(
      "Mars",
      "Mars is a planet",
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      { from: undefined, to: undefined },
    );
  });

  it("get_statement_history passes api url to claim history", async () => {
    vi.mocked(runClaimHistory).mockResolvedValue({
      statement: "Venus is a planet",
      page: "Venus",
      revisions: [],
      status: "absent",
      historySummary: "Not found.",
    });

    await handleToolCall("get_statement_history", {
      statement: "Venus is a planet",
      page: "Venus",
      api: "https://wiki.example.com/api.php",
    });

    expect(runClaimHistory).toHaveBeenCalledWith(
      "Venus",
      "Venus is a planet",
      false,
      "https://wiki.example.com/api.php",
      undefined,
      undefined,
      undefined,
      { from: undefined, to: undefined },
    );
  });

  it("get_statement_history passes the revision limit and range to claim history", async () => {
    vi.mocked(runClaimHistory).mockResolvedValue({
      statement: "Venus is a planet",
      page: "Venus",
      revisions: [],
      transitions: [],
      status: "absent",
      historySummary: "Not found.",
    });

    await handleToolCall("get_statement_history", {
      statement: "Venus is a planet",
      page: "Venus",
      limit: 500,
      from: 10,
      to: 90,
    });

    expect(runClaimHistory).toHaveBeenLastCalledWith(
      "Venus",
      "Venus is a planet",
      false,
      undefined,
      undefined,
      undefined,
      500,
      { from: 10, to: 90 },
    );
    await expect(
      handleToolCall("get_statement_history", { statement: "Venus is a planet", page: "Venus", limit: 0 }),
    ).rejects.toThrow("limit must be a positive integer");
  });

  it("get_statement_history returns transitions, cut to IDs and holding at brief depth", async () => {
    const transition = {
      kind: "removed",
      revisionId: 9,
      timestamp: "2025-02-01T00:00:00Z",
      previousRevisionId: 8,
      previousTimestamp: "2025-01-01T00:00:00Z",
      adjacent: true,
      before: "A passage.",
      after: "",
      editSummary: "trim",
      revertSummary: false,
      heldRevisions: 3,
      nearest: { text: "A rewritten passage.", wordOverlap: 0.5 },
    };
    vi.mocked(runClaimHistory).mockResolvedValue({
      statement: "A passage",
      page: "Page",
      revisions: [],
      transitions: [transition as never],
      status: "absent",
      historySummary: "Removed.",
    });

    const detailed = JSON.parse(
      (await handleToolCall("get_statement_history", { statement: "A passage", page: "Page" })).content[0].text,
    );
    expect(detailed.transitions).toEqual([transition]);

    const brief = JSON.parse(
      (await handleToolCall("get_statement_history", { statement: "A passage", page: "Page", depth: "brief" }))
        .content[0].text,
    );
    expect(brief.transitions).toEqual([
      {
        kind: "removed",
        revisionId: 9,
        timestamp: "2025-02-01T00:00:00Z",
        previousRevisionId: 8,
        adjacent: true,
        heldRevisions: 3,
      },
    ]);
  });
});

describe("mcp stdio transport", () => {
  it("answers requests and stays silent on notifications/initialized", async () => {
    const replies = await driveStdioServer(runMcpServer, CLIENT_OPENING);

    expect(replies.map((r) => r.id)).toEqual([1, 2]);
    expect(replies.every((r) => r.error === undefined)).toBe(true);
  });

  it("never answers a notification, known or not, but still rejects an unknown request", async () => {
    const replies = await driveStdioServer(runMcpServer, [
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
