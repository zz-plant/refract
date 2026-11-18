import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createVerificationBundle,
  signVerificationBundle,
  verifyVerificationBundle,
} from "@refract-org/evidence-graph";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runVerify } from "../commands/verify.js";
import { renderVerificationHtmlReceipt } from "../html-renderer.js";

describe("runVerify", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refract-verify-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("verifies a valid verification bundle and generates HTML receipt", async () => {
    const bundle = createVerificationBundle({
      pageTitle: "Test Article",
      analyzerVersions: { refract: "0.5.15" },
      revisions: [
        {
          revId: 1,
          pageId: 1,
          pageTitle: "Test Article",
          timestamp: "2026-01-01T00:00:00Z",
          comment: "Initial revision",
          content: "Initial content here.",
          size: 21,
          minor: false,
        },
      ],
      events: [
        {
          eventType: "sentence_first_seen",
          fromRevisionId: 0,
          toRevisionId: 1,
          after: "Initial content here.",
          layer: "observed",
          timestamp: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const bundlePath = join(tmpDir, "bundle.json");
    const htmlPath = join(tmpDir, "receipt.html");
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");

    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    await runVerify(bundlePath, htmlPath);

    expect(stdout).toHaveBeenCalled();
    const htmlContent = readFileSync(htmlPath, "utf-8");
    expect(htmlContent).toContain("Refract verification receipt");
    expect(htmlContent).toContain("Test Article");
    expect(htmlContent).toContain("All checks passed.");
    expect(htmlContent).toContain('<span class="pass">pass</span>');
  });

  function oneEventBundle() {
    return createVerificationBundle({
      pageTitle: "Test Article",
      analyzerVersions: { refract: "0.5.15" },
      revisions: [],
      events: [
        {
          eventType: "sentence_first_seen",
          fromRevisionId: 0,
          toRevisionId: 1,
          after: "Initial content here.",
          layer: "observed",
          timestamp: "2026-01-01T00:00:00Z",
        },
      ],
    });
  }

  // The last two cells of the receipt's one event row: its event hash and its proof.
  function hashAndProofCells(html: string): string[] {
    return [...html.matchAll(/<td>(.*?)<\/td>/g)].map((m) => m[1]).slice(-2);
  }

  const pass = '<span class="pass">pass</span>';
  const fail = '<span class="fail">fail</span>';

  it("marks a proof that does not hash to its root as failed in the receipt", () => {
    const bundle = oneEventBundle();
    bundle.proofs[0].rootHash = "0".repeat(64);

    const html = renderVerificationHtmlReceipt(bundle, verifyVerificationBundle(bundle));

    expect(html).toContain("Checks failed:");
    expect(html).toContain("Merkle proof verification failed for event index 0");
    expect(hashAndProofCells(html)).toEqual([pass, fail]);
  });

  it("marks a self-consistent proof whose root is not the manifest's as failed", () => {
    const bundle = oneEventBundle();
    const fakeLeaf = "f".repeat(16);
    bundle.proofs[0] = { leafHash: fakeLeaf, leafIndex: 0, siblings: [], rootHash: fakeLeaf };

    const html = renderVerificationHtmlReceipt(bundle, verifyVerificationBundle(bundle));

    expect(html).toContain("Proof root for event index 0 does not match the manifest Merkle root");
    expect(hashAndProofCells(html)).toEqual([pass, fail]);
  });

  it("marks an edited event's hash as failed in the receipt", () => {
    const bundle = oneEventBundle();
    bundle.events[0].after = "Edited content.";

    const html = renderVerificationHtmlReceipt(bundle, verifyVerificationBundle(bundle));

    expect(html).toContain("Checks failed:");
    expect(html).toContain("Event index 0 hashes to");
    expect(hashAndProofCells(html)).toEqual([fail, pass]);
  });
});

describe("runVerify with a trusted key", () => {
  let dir: string;
  const signed = () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const bundle = signVerificationBundle(
      createVerificationBundle({
        pageTitle: "Signed",
        analyzerVersions: { refract: "test" },
        revisions: [],
        events: [],
      }),
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    return { bundle, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "refract-verify-sig-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("passes a bundle signed with the trusted key", async () => {
    const { bundle, publicPem } = signed();
    writeFileSync(join(dir, "b.json"), JSON.stringify(bundle));
    writeFileSync(join(dir, "k.pem"), publicPem);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await runVerify(join(dir, "b.json"), undefined, join(dir, "k.pem"));
    expect(exit).not.toHaveBeenCalled();
  });

  it("fails a bundle signed with another key", async () => {
    const { bundle } = signed();
    const { publicPem: otherKey } = signed();
    writeFileSync(join(dir, "b.json"), JSON.stringify(bundle));
    writeFileSync(join(dir, "k.pem"), otherKey);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await runVerify(join(dir, "b.json"), undefined, join(dir, "k.pem"));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
