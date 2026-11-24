import { isAbsolute, join } from "node:path";
import type { AnalyzerConfig, EvidenceEvent, InferenceBoundary } from "@refract-org/evidence-graph";
import { buildInferencePrompt, DEFAULT_ANALYZER_CONFIG, parseInferenceResponse } from "@refract-org/evidence-graph";
import { type StatementHistoryOptions, statementHistoryOptions, statementHistoryResponse } from "@refract-org/mcp";
import { OpenAICompatibleProvider } from "../inference-provider.js";
import { REFRACT_VERSION } from "../version.js";
import { runAnalyze } from "./analyze.js";
import { runClaim, runClaimHistory } from "./claim.js";
import { acknowledgeCommand, filterReviewEntries, isAcknowledgeable, observeReview } from "./review.js";
import { takeSnapshot } from "./snapshot.js";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function send(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function sendError(id: number | string, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function sendRequest(request: {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: Record<string, unknown>;
}): void {
  process.stdout.write(`${JSON.stringify(request)}\n`);
}

const CLIENT_NAME = "refract-mcp";
const CLIENT_VERSION = REFRACT_VERSION;
const PROTOCOL_VERSION = "2025-06-18";

let _clientCapabilities: Record<string, unknown> | null = null;
const pendingSampling = new Map<string, { resolve: (value: JsonRpcResponse) => void; reject: (err: Error) => void }>();
// Set once stdin ends: no reply to a sampling request can arrive after that.
let _clientInputClosed = false;

/**
 * Ask the connected client's model, through MCP sampling, and return its reply
 * and the model the client says answered. The reply arrives as a line on
 * stdin, which the server's read loop hands to `pendingSampling`.
 */
async function requestSampling(prompt: string): Promise<{ text: string; model?: string }> {
  if (_clientInputClosed) throw new Error("MCP client closed its input before the sampling request was sent");
  const samplingId = `classify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingSampling.delete(samplingId);
      reject(new Error("MCP sampling timeout"));
    }, 30000);
    pendingSampling.set(samplingId, {
      resolve: (value) => {
        clearTimeout(timeout);
        const result = value.result as { content?: unknown; model?: unknown } | undefined;
        // A CreateMessageResult holds one content block; clients on later
        // protocol versions may send a list. This read only a list, so a reply
        // in the shape the 2025-06-18 protocol defines was taken for empty.
        const blocks = Array.isArray(result?.content) ? result.content : [result?.content];
        const text = (blocks as Array<{ type?: string; text?: unknown } | undefined>).find(
          (block) => typeof block?.text === "string" && block.text !== "",
        )?.text as string | undefined;
        if (text === undefined) reject(new Error("Empty sampling response"));
        else resolve({ text, ...(typeof result?.model === "string" ? { model: result.model } : {}) });
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });
    sendRequest({
      jsonrpc: "2.0",
      id: samplingId,
      method: "sampling/createMessage",
      params: {
        messages: [{ role: "user", content: { type: "text", text: prompt } }],
        maxTokens: 64,
      },
    });
  });
}

/** TOOLS array re-exported from @refract-org/mcp */
export const TOOLS = (await import("@refract-org/mcp")).TOOLS;

/**
 * Dispatch an MCP tool call to the appropriate handler and return text content.
 * Preserves the original signature (name, args) for backward compatibility.
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<{ content: { type: string; text: string }[] }> {
  const params = args ?? {};
  const apiUrl = params.api as string | undefined;

  switch (name) {
    case "analyze": {
      const page = params.page as string;
      const depth = (params.depth as string) ?? "detailed";
      const from = params.from ? parseInt(params.from as string, 10) : undefined;
      const to = params.to ? parseInt(params.to as string, 10) : undefined;
      const since = params.since as string | undefined;

      const mcpConfig = params.config as Record<string, unknown> | undefined;
      let config: AnalyzerConfig | undefined;
      if (mcpConfig) {
        config = structuredClone(DEFAULT_ANALYZER_CONFIG);
        if (mcpConfig.similarityThreshold !== undefined) {
          config.section ??= {};
          config.section.similarityThreshold = mcpConfig.similarityThreshold as number;
        }
        if (mcpConfig.spikeFactor !== undefined) {
          config.talkSpike ??= {};
          config.talkSpike.spikeFactor = mcpConfig.spikeFactor as number;
        }
        if (mcpConfig.clusterWindowMinutes !== undefined) {
          config.editCluster ??= {};
          config.editCluster.windowMs = (mcpConfig.clusterWindowMinutes as number) * 60 * 1000;
        }
        if (mcpConfig.talkWindowBeforeDays !== undefined) {
          config.talkCorrelation ??= {};
          config.talkCorrelation.windowBeforeMs = (mcpConfig.talkWindowBeforeDays as number) * 24 * 60 * 60 * 1000;
        }
        if (mcpConfig.talkWindowAfterDays !== undefined) {
          config.talkCorrelation ??= {};
          config.talkCorrelation.windowAfterMs = (mcpConfig.talkWindowAfterDays as number) * 24 * 60 * 60 * 1000;
        }
        if (mcpConfig.renameDetection !== undefined) {
          const mode = mcpConfig.renameDetection as string;
          if (mode === "exact" || mode === "similarity" || mode === "none") {
            config.section ??= {};
            config.section.renameDetection = mode;
          }
        }
      }

      const { events, revisions } = await runAnalyze(
        page,
        depth,
        from,
        to,
        since,
        false,
        apiUrl,
        undefined,
        undefined,
        undefined,
        config,
      );
      const summary = summarizeEvents(events);
      const lines = [
        `Analysis of "${page}" (depth=${depth}):`,
        `  Revisions fetched: ${revisions.length}`,
        `  Total events: ${events.length}`,
        `  Sections with activity: ${summary.sections}`,
        "",
        "Event type breakdown:",
      ];
      for (const [type, count] of Object.entries(summary.byType).sort(([, a], [, b]) => b - a)) {
        lines.push(`  ${type}: ${count}`);
      }
      if (events.length > 0) {
        const sample = events.slice(0, 30);
        lines.push("", "Sample events:");
        for (const e of sample) lines.push(`  ${formatEventLine(e)}`);
        if (events.length > 30) lines.push(`  ... and ${events.length - 30} more events`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "claim": {
      const page = params.page as string;
      const text = params.text as string;
      let captured = "";
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        captured += `${args.map(String).join(" ")}\n`;
      };
      try {
        await runClaim(page, text, false, apiUrl, undefined, undefined);
      } finally {
        console.log = origLog;
      }
      if (!captured.trim()) captured = `Sentence "${text}" not found in "${page}" revision history.`;
      return { content: [{ type: "text", text: captured.trim() }] };
    }

    case "export": {
      const page = params.page as string;
      const depth = (params.depth as string) ?? "detailed";
      const since = params.since as string | undefined;
      const { events, revisions } = await runAnalyze(
        page,
        depth,
        undefined,
        undefined,
        since,
        false,
        apiUrl,
        undefined,
        undefined,
        undefined,
      );
      const report = {
        format: "refract-export/v1",
        generatedAt: new Date().toISOString(),
        pageTitle: page,
        revisionCount: revisions.length,
        eventCount: events.length,
        summary: summarizeEvents(events),
        events,
      };
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }

    case "cron": {
      const pagesFile = params.pagesFile as string;
      const fs = await import("node:fs");
      if (!fs.existsSync(pagesFile)) {
        return { content: [{ type: "text", text: `Error: pages file not found: ${pagesFile}` }] };
      }
      const pages = fs
        .readFileSync(pagesFile, "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const results: Array<{ page: string; newEvents: number; ok: boolean; error?: string }> = [];
      for (const page of pages) {
        try {
          const { events } = await runAnalyze(
            page,
            "brief",
            undefined,
            undefined,
            undefined,
            false,
            undefined,
            undefined,
            undefined,
            undefined,
          );
          results.push({ page, newEvents: events.length, ok: true });
        } catch (err) {
          results.push({ page, newEvents: 0, ok: false, error: String(err) });
        }
      }
      const totalNew = results.reduce((s, r) => s + r.newEvents, 0);
      const errors = results.filter((r) => !r.ok).length;
      const lines = [
        "Cron re-observation:",
        `  Pages checked: ${results.length}`,
        `  New events total: ${totalNew}`,
        `  Errors: ${errors}`,
      ];
      const changed = results.filter((r) => r.newEvents > 0);
      if (changed.length > 0) {
        lines.push("", "Changed pages:");
        for (const r of changed) lines.push(`  ${r.page}: ${r.newEvents} new events`);
      }
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        lines.push("", "Errors:");
        for (const f of failed) lines.push(`  ${f.page}: ${f.error ?? "unknown error"}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "classify": {
      const apiKey = (params.apiKey as string) || process.env.REFRACT_INFERENCE_API_KEY || "";
      const endpoint = (params.endpoint as string) || process.env.REFRACT_INFERENCE_ENDPOINT || "";
      const model = (params.model as string) || process.env.REFRACT_INFERENCE_MODEL || "";

      try {
        let result: unknown;

        if (apiKey) {
          const provider = new OpenAICompatibleProvider({ endpoint, apiKey, model });
          result = await provider.infer(boundaryFromParams(params), inputFromParams(params));
        } else if (_clientCapabilities?.sampling) {
          const boundary = boundaryFromParams(params);
          const input = inputFromParams(params);
          const reply = await requestSampling(buildInferencePrompt(boundary, input));
          result = parseInferenceResponse(boundary, reply.text, input, reply.model);
        } else {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    boundary: boundaryFromParams(params),
                    output: {},
                    source: "default",
                    note: "No inference provider configured. Set REFRACT_INFERENCE_API_KEY or connect via MCP client with sampling support.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${String(error)}` }] };
      }
    }

    case "get_statement_history": {
      const history = await statementHistory(
        params.statement as string,
        params.page as string,
        statementHistoryOptions(params),
      );
      return { content: [{ type: "text", text: JSON.stringify(statementHistoryResponse(params, history), null, 2) }] };
    }

    case "snapshot":
      return { content: [{ type: "text", text: JSON.stringify(await snapshotTool(params), null, 2) }] };

    case "review":
      return { content: [{ type: "text", text: JSON.stringify(await reviewTool(params), null, 2) }] };

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  }
}

/** A passage's claim history on `page`, read from the wiki `options.api` names over the revisions the options select. */
function statementHistory(statement: string, page: string, options: StatementHistoryOptions = {}) {
  if (typeof statement !== "string" || !statement.trim()) throw new Error("get_statement_history needs a statement.");
  if (typeof page !== "string" || !page.trim()) throw new Error("get_statement_history needs a page title.");
  return runClaimHistory(page, statement, false, options.api, undefined, undefined, options.limit, {
    from: options.from,
    to: options.to,
  });
}

/** The `snapshot` tool: the revision live at a date, as data rather than console output. */
export async function snapshotTool(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const page = params.page;
  if (typeof page !== "string" || !page.trim()) throw new Error("snapshot needs a page title.");
  const content = params.content ?? "plain";
  if (content !== "plain" && content !== "wikitext" && content !== "none") {
    throw new Error("content must be plain, wikitext, or none.");
  }
  const at = typeof params.at === "string" && params.at ? params.at : new Date().toISOString();
  const { snapshot } = await takeSnapshot(page, at, {
    apiUrl: params.api as string | undefined,
    revisionLimit: params.revisionLimit === undefined ? undefined : Number(params.revisionLimit),
  });
  const { wikitext, text, ...metadata } = snapshot;
  if (content === "plain") return { ...metadata, text };
  if (content === "wikitext") return { ...metadata, wikitext };
  return metadata;
}

function stringList(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings.`);
  }
  return value;
}

/**
 * The `review` tool. It observes and saves a report under `stateDir` and never
 * acknowledges one: acknowledgment marks revisions as inspected by a person,
 * so the result hands that person the CLI command instead of doing it here.
 */
export async function reviewTool(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const stateDir = params.stateDir;
  if (typeof stateDir !== "string" || !isAbsolute(stateDir)) {
    throw new Error("review needs stateDir, an absolute path for review state and saved reports.");
  }
  const filters = {
    eventTypes: stringList(params.eventTypes, "eventTypes"),
    section: params.section as string | undefined,
    text: params.text as string | undefined,
  };
  const report = await observeReview(stringList(params.pages, "pages") ?? [], {
    stateDir,
    sample: params.sample === true,
    apiUrl: params.api as string | undefined,
    from: params.from === undefined ? undefined : Number(params.from),
    limit: params.limit === undefined ? undefined : Number(params.limit),
  });
  const acknowledgeable = isAcknowledgeable(report);
  return {
    ...report,
    // Input revisions carry full wikitext for every fetched revision; the saved
    // report at reportPath keeps them, and the reply names them by ID.
    pages: report.pages.map(({ inputRevisions, ...page }) => ({
      ...page,
      inputRevisionIds: inputRevisions.map((r) => r.revId),
    })),
    reportPath: join(stateDir, "reports", `${report.reportId}.json`),
    view: {
      filters,
      pages: report.pages.map((p) => ({ sourceKey: p.source.key, entries: filterReviewEntries(p.entries, filters) })),
    },
    acknowledgment: acknowledgeable
      ? {
          available: true,
          by: "person",
          note: "A person inspects the unfiltered saved report, then runs this command. Acknowledgment covers every entry, including those hidden by filters.",
          command: acknowledgeCommand(report.reportId, stateDir),
        }
      : {
          available: false,
          note: "This report is incomplete or a page failed. Call review again to resume; an incomplete report cannot be acknowledged.",
        },
  };
}

function boundaryFromParams(params: Record<string, unknown>): InferenceBoundary {
  return (params.boundary as InferenceBoundary) || "revert";
}

function inputFromParams(params: Record<string, unknown>): Record<string, unknown> {
  return params.input as Record<string, unknown>;
}

function summarizeEvents(events: EvidenceEvent[]): { byType: Record<string, number>; sections: number } {
  const byType: Record<string, number> = {};
  const secSet = new Set<string>();
  for (const e of events) {
    byType[e.eventType] = (byType[e.eventType] ?? 0) + 1;
    if (e.section) secSet.add(e.section);
  }
  return { byType, sections: secSet.size };
}

function formatEventLine(e: EvidenceEvent): string {
  const section = e.section ? ` [${e.section}]` : "";
  const facts = e.deterministicFacts.map((f) => f.fact).join("; ");
  const detail = facts ? ` — ${facts}` : "";
  return `[${e.timestamp}] ${e.eventType} (rev ${e.fromRevisionId}→${e.toRevisionId})${section}${detail}`;
}

/** Start the MCP JSON-RPC server over stdio for AI agent integration. */
export async function runMcpServer(): Promise<void> {
  process.stderr.write("Refract MCP server starting...\n");

  let buffer = "";

  process.stdin.setEncoding("utf-8");

  // Requests are handled one at a time, in the order they arrive, but the loop
  // keeps reading while one is handled. It used to await each request before
  // reading the next line, so a `classify` waiting on a sampling reply never
  // saw it: the reply was the next line. Every sampling request timed out.
  let handling = Promise.resolve();
  _clientInputClosed = false;

  for await (const chunk of process.stdin) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      const id = String(msg.id ?? "");
      if (pendingSampling.has(id)) {
        const handler = pendingSampling.get(id);
        if (!handler) continue;
        pendingSampling.delete(id);
        if (msg.error) {
          handler.reject(new Error(String((msg.error as Record<string, unknown>).message ?? "Sampling error")));
        } else {
          handler.resolve({ jsonrpc: "2.0", id, result: msg.result });
        }
        continue;
      }

      const request = msg as unknown as {
        jsonrpc: string;
        id: number | string;
        method: string;
        params?: Record<string, unknown>;
      };
      if (request.jsonrpc !== "2.0") continue;

      // No id makes this a notification, and JSON-RPC 2.0 forbids replying to
      // one, even to say the method is unknown. MCP clients send
      // notifications/initialized after the handshake and
      // notifications/cancelled when they abandon a request; neither needs
      // action here, and any other notification is dropped the same way.
      if (!("id" in msg)) continue;

      handling = handling.then(() =>
        handleRequest(request).catch((err) => {
          process.stderr.write(`Unhandled error: ${err.message}\n`);
        }),
      );
    }
  }

  // No reply can arrive once input ends, so a request waiting on one fails now
  // rather than at its timeout; then the remaining requests finish.
  _clientInputClosed = true;
  for (const [id, pending] of pendingSampling) {
    pendingSampling.delete(id);
    pending.reject(new Error("MCP client closed its input before answering the sampling request"));
  }
  await handling;
}

async function handleRequest(request: {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}): Promise<void> {
  switch (request.method) {
    case "initialize": {
      _clientCapabilities = (request.params?.capabilities as Record<string, unknown>) ?? null;
      process.stderr.write("Refract MCP server initialized.\n");
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {}, sampling: {} },
          serverInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
        },
      });
      break;
    }

    case "tools/list":
      send({ jsonrpc: "2.0", id: request.id, result: { tools: TOOLS } });
      break;

    case "tools/call": {
      const toolParams = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!toolParams?.name) {
        sendError(request.id, -32602, "Missing tool name");
        break;
      }
      try {
        const result = await handleToolCall(toolParams.name, toolParams.arguments);
        send({ jsonrpc: "2.0", id: request.id, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Tool error: ${message}\n`);
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [{ type: "text", text: `Error: ${message}` }], isError: true },
        });
      }
      break;
    }

    default:
      sendError(request.id, -32601, `Method not found: ${request.method}`);
  }
}
