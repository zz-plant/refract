import type { EvidenceEvent } from "@refract-org/evidence-graph";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const event = {
  eventType: "citation_removed",
  fromRevisionId: 1,
  toRevisionId: 2,
  section: "body",
  before: "",
  after: "",
  deterministicFacts: [],
  layer: "observed",
  timestamp: "2025-01-01T00:00:00Z",
} as unknown as EvidenceEvent;

vi.mock("../commands/analyze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../commands/analyze.js")>()),
  runAnalyze: vi.fn(async () => ({ events: [event], revisions: [], coverage: undefined })),
}));
vi.mock("../commands/explore.js", () => ({ runExplore: vi.fn(async () => undefined) }));

describe("analyze next steps", () => {
  const isTTY = process.stdout.isTTY;
  let output: () => string;

  beforeEach(() => {
    // Each run needs a fresh program: commander keeps option values between parses.
    vi.resetModules();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    output = () => log.mock.calls.map((args) => args.join(" ")).join("\n");
  });

  afterEach(() => {
    process.stdout.isTTY = isTTY;
    vi.restoreAllMocks();
  });

  async function analyze(tty: boolean, ...flags: string[]): Promise<void> {
    process.stdout.isTTY = tty;
    const { cli } = await import("../index.js");
    await cli(["analyze", "Bitcoin", ...flags]);
  }

  it("reach a person at a terminal, after the explorer starts", async () => {
    await analyze(true);

    const { runExplore } = await import("../commands/explore.js");
    expect(runExplore).toHaveBeenCalled();
    expect(output()).toContain("Next steps:");
    expect(output()).toContain('refract review "Bitcoin"');
    expect(output()).toContain('refract claim "Bitcoin"');
    expect(output()).toContain("https://zz-plant.github.io/refract/");
    expect(output()).not.toContain("refract explore");
  });

  it("offer the explorer when the output is piped", async () => {
    await analyze(false);

    expect(output()).toContain('refract explore "Bitcoin"');
    expect(output()).toContain('refract review "Bitcoin"');
  });

  it("stay out of NDJSON output", async () => {
    await analyze(false, "--json");

    expect(output()).not.toContain("Next steps:");
  });
});
