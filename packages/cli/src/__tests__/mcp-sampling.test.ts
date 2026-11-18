import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMcpServer } from "../commands/mcp.js";

type Message = Record<string, unknown>;

/**
 * Run the server against a client that answers its sampling requests with
 * `answer`, which returns the `result` to send or `{ error }`. Input ends once
 * the reply to request 3 is written. Returns everything the server wrote.
 */
async function driveSamplingClient(arguments_: Message, answer: (request: Message) => Message): Promise<Message[]> {
  const stdin = new PassThrough();
  const written: Message[] = [];
  let pending = "";
  vi.spyOn(process, "stdin", "get").mockReturnValue(stdin as unknown as typeof process.stdin);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    pending += String(chunk);
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines.filter((l) => l.trim())) {
      const message = JSON.parse(line) as Message;
      written.push(message);
      if (message.method === "sampling/createMessage") {
        const reply = answer(message);
        stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, ...reply })}\n`);
      }
      if (message.id === 3) stdin.end();
    }
    return true;
  });

  for (const message of [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: { sampling: {} },
        clientInfo: { name: "t", version: "0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "classify", arguments: arguments_ } },
  ]) {
    stdin.write(`${JSON.stringify(message)}\n`);
  }
  await runMcpServer();
  return written;
}

function toolResult(written: Message[]): Record<string, unknown> {
  const reply = written.find((m) => m.id === 3) as { result: { content: { text: string }[] } };
  return JSON.parse(reply.result.content[0].text) as Record<string, unknown>;
}

describe("mcp classify through sampling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("asks the client's model and reports its reply and name", async () => {
    vi.stubEnv("REFRACT_INFERENCE_API_KEY", "");
    const written = await driveSamplingClient(
      { boundary: "sentence_similarity", input: { before: "Pluto is a planet.", after: "Pluto was a planet." } },
      // One content block, as the 2025-06-18 protocol defines the result.
      () => ({ result: { role: "assistant", content: { type: "text", text: "Yes" }, model: "client-model" } }),
    );

    const request = written.find((m) => m.method === "sampling/createMessage") as {
      params: { messages: { content: { text: string } }[] };
    };
    expect(request.params.messages[0].content.text).toContain("Before: Pluto is a planet.");
    expect(toolResult(written)).toEqual({
      boundary: "sentence_similarity",
      output: { isSameClaim: true },
      source: "model",
      answer: "Yes",
      model: "client-model",
    });
  });

  it("reads a reply whose content is a list of blocks", async () => {
    vi.stubEnv("REFRACT_INFERENCE_API_KEY", "");
    const written = await driveSamplingClient({ boundary: "revert", input: { comment: "rv" } }, () => ({
      result: { role: "assistant", content: [{ type: "text", text: "no" }], model: "client-model" },
    }));

    expect(toolResult(written)).toMatchObject({ output: { isRevert: false }, answer: "no" });
  });

  it("reports a client's refusal to sample", async () => {
    vi.stubEnv("REFRACT_INFERENCE_API_KEY", "");
    const written = await driveSamplingClient({ boundary: "revert", input: { comment: "rv" } }, () => ({
      error: { code: -1, message: "User rejected sampling request" },
    }));

    const reply = written.find((m) => m.id === 3) as { result: { content: { text: string }[] } };
    expect(reply.result.content[0].text).toBe("Error: Error: User rejected sampling request");
  });
});
