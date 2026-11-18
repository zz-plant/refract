import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { wordOverlapRatio } from "@refract-org/analyzers";
import { describe, expect, it } from "vitest";
import { INFERENCE_BOUNDARIES, OpenAICompatibleProvider } from "../inference-provider.js";

const execute = promisify(execFile);
const refract = (...args: string[]) =>
  execute(process.execPath, [resolve("packages/cli/dist/src/cli.js"), ...args], { encoding: "utf8" });

describe("refract classify", () => {
  it("lists the boundaries in its help", async () => {
    const { stdout } = await refract("classify", "--help");

    for (const boundary of INFERENCE_BOUNDARIES) expect(stdout).toContain(boundary);
  });

  it("rejects an unknown boundary instead of printing undefined", async () => {
    await expect(refract("classify", "nonsense", "--input", "{}")).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("Allowed choices are revert"),
    });
  });
});

describe("OpenAICompatibleProvider default inference", () => {
  it("uses deterministic revert classification without an API key", async () => {
    const provider = new OpenAICompatibleProvider({});

    const result = await provider.infer("revert", { comment: "reverted vandalism" });

    expect(result).toEqual({
      boundary: "revert",
      output: { isRevert: true },
      confidence: 0.85,
      source: "default",
    });
  });

  it("judges a revert by the rule analysis uses for revert_detected", async () => {
    const provider = new OpenAICompatibleProvider({});
    const isRevert = async (comment: string) => (await provider.infer("revert", { comment })).output.isRevert;

    expect(await isRevert("Undid revision 123 by Example")).toBe(true);
    // The edit-type heuristic's wider pattern called this a revert; analysis does not.
    expect(await isRevert("rv unexplained removal")).toBe(false);
  });

  it("applies the default rule to input that omits optional fields", async () => {
    const provider = new OpenAICompatibleProvider({});

    await expect(provider.infer("activity_spike", {})).resolves.toEqual({
      boundary: "activity_spike",
      output: { isSpike: false },
      confidence: 0.5,
      source: "default",
    });
  });

  it("uses deterministic edit heuristics without an API key", async () => {
    const provider = new OpenAICompatibleProvider({});

    const result = await provider.infer("heuristic", { comment: "added citation", sizeDelta: 120 });

    expect(result.output).toEqual({ kind: "sourcing" });
    expect(result.source).toBe("default");
  });
});

describe("OpenAICompatibleProvider sentence similarity default", () => {
  const similarity = async (before: string, after: string) =>
    (await new OpenAICompatibleProvider({}).infer("sentence_similarity", { before, after })).output;

  it("measures overlap as sentence events do", async () => {
    const before = "Pluto is the ninth planet, discovered in 1930.";
    const after = "Pluto is the ninth planet discovered in 1930";

    // "planet," and "1930." are words of their own to the sentence matcher.
    expect((await similarity(before, after)).matchRatio).toBe(wordOverlapRatio(before, after));
    expect((await similarity(before, after)).isSameClaim).toBe(false);
  });

  it("does not call two different sentences in another script the same", async () => {
    // The old tokenizer kept only a-z and 0-9, found no words in either, and
    // scored them 1.
    expect(await similarity("冥王星は準惑星である", "地球は第三惑星である")).toEqual({
      isSameClaim: false,
      matchRatio: 0,
    });
  });
});

describe("OpenAICompatibleProvider model path", () => {
  it("records the reply and the model that gave it, with no confidence or ratio", async () => {
    const requests: Record<string, unknown>[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        requests.push(JSON.parse(body) as Record<string, unknown>);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({ model: "served-model-v2", choices: [{ message: { role: "assistant", content: "Yes" } }] }),
        );
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const { port } = server.address() as AddressInfo;
      const provider = new OpenAICompatibleProvider({
        endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
        apiKey: "test-key",
        model: "requested-model",
      });

      const result = await provider.infer("sentence_similarity", { before: "A sentence.", after: "Another one." });

      expect(requests[0]).toMatchObject({ model: "requested-model", temperature: 0 });
      expect(result).toEqual({
        boundary: "sentence_similarity",
        output: { isSameClaim: true },
        source: "model",
        answer: "Yes",
        model: "served-model-v2",
      });
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});
