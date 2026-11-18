import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// examples/06-pluto-in-the-loop.ts, run as a reader would, against a stand-in
// for a model: a chat-completions endpoint that answers by a fixed rule. Its
// answers exist only for this test; none are committed.

const execute = promisify(execFile);
const EXAMPLE = resolve("examples/06-pluto-in-the-loop.ts");

let server: Server;
let endpoint: string;
let dir: string;

async function demo(args: string[], env: Record<string, string> = {}) {
  const environment = { ...process.env, NO_COLOR: "1", ...env };
  if (!env.REFRACT_INFERENCE_API_KEY) delete environment.REFRACT_INFERENCE_API_KEY;
  try {
    const { stdout } = await execute("bun", ["run", EXAMPLE, ...args], { encoding: "utf8", env: environment });
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { code: number; stdout: string };
    return { code: failed.code, stdout: failed.stdout };
  }
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const prompt = (JSON.parse(body) as { messages: { content: string }[] }).messages[0].content;
      const reply = prompt.includes("However, the IAU") ? "No." : "Yes";
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ model: "stand-in", choices: [{ message: { role: "assistant", content: reply } }] }));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`;
  dir = mkdtempSync(join(tmpdir(), "refract-pluto-loop-"));
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

describe("examples/06-pluto-in-the-loop.ts", () => {
  it("shows where the matcher splits the history, with no model asked", async () => {
    const { code, stdout } = await demo([]);

    expect(code).toBe(0);
    expect(stdout).toContain("The matcher split this history in 3 of 7 saved revision pairs: 4 possible links.");
    expect(stdout).toContain("word overlap 0.79, under 0.8");
    expect(stdout).toContain("No model was asked.");
  });

  it("asks a model at each split through refract classify, checks and saves the answers", async () => {
    const saved = join(dir, "answers.json");
    const asked = await demo(["--ask", "--save", saved], {
      REFRACT_INFERENCE_API_KEY: "test-key",
      REFRACT_INFERENCE_ENDPOINT: endpoint,
    });

    expect(asked.code).toBe(0);
    expect(asked.stdout).toContain("Model answers shown: 3 same claim, 1 a different claim.");
    const answers = JSON.parse(readFileSync(saved, "utf8")).answers as { result: { source: string; model: string } }[];
    expect(answers).toHaveLength(4);
    expect(answers.every((a) => a.result.source === "model" && a.result.model === "stand-in")).toBe(true);

    // The saved answers replay with no model configured.
    const replayed = await demo(["--answers", saved]);
    expect(replayed.code).toBe(0);
    expect(replayed.stdout).toContain("Every answer passed the check against Refract's events.");

    // An answer quoting a sentence the event does not hold is refused.
    const tampered = await demo(["--answers", saved, "--tamper"]);
    expect(tampered.code).toBe(1);
    expect(tampered.stdout).toContain("quotes a first-seen sentence that event");
    expect(tampered.stdout).toContain("1 saved answer was refused by the check and not shown.");

    // So is one whose recorded verdict is not what the reply says.
    const edited = JSON.parse(readFileSync(saved, "utf8"));
    edited.answers[0].result.output.isSameClaim = false;
    const editedPath = join(dir, "edited.json");
    writeFileSync(editedPath, JSON.stringify(edited));
    const relabelled = await demo(["--answers", editedPath]);
    expect(relabelled.code).toBe(1);
    expect(relabelled.stdout).toContain('records a verdict its reply ("Yes") does not give');
  });

  it("does not take the default rule's answer for a model's", async () => {
    const { code } = await demo(["--ask"]);

    expect(code).toBe(2);
  });
});
