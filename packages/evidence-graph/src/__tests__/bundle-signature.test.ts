import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EvidenceEvent, Revision } from "../index.js";
import {
  bundleKeyId,
  createVerificationBundle,
  signVerificationBundle,
  verifyBundleSignature,
  verifyVerificationBundle,
} from "../replay-manifest.js";

function keyPair(type: "ed25519" | "ec" = "ed25519") {
  const { privateKey, publicKey } =
    type === "ed25519" ? generateKeyPairSync("ed25519") : generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const revisions: Revision[] = [
  {
    revId: 1,
    pageId: 1,
    pageTitle: "Topic",
    timestamp: "2026-01-01T00:00:00Z",
    comment: "",
    content: "Text.",
    size: 5,
    minor: false,
  },
];
const events: EvidenceEvent[] = [
  {
    eventType: "sentence_first_seen",
    fromRevisionId: 0,
    toRevisionId: 1,
    section: "(lead)",
    before: "",
    after: "Text.",
    deterministicFacts: [],
    layer: "observed",
    timestamp: "2026-01-01T00:00:00Z",
  },
];

const bundle = () =>
  createVerificationBundle({ pageTitle: "Topic", analyzerVersions: { refract: "test" }, revisions, events });

describe("bundle signatures", () => {
  const signer = keyPair();

  it("signs the manifest hash and verifies against the trusted key", () => {
    const signed = signVerificationBundle(bundle(), signer.privatePem);
    expect(signed.signature).toMatchObject({
      algorithm: "ed25519",
      signs: "manifestHash",
      keyId: bundleKeyId(signer.publicPem),
    });
    expect(verifyBundleSignature(signed, signer.publicPem)).toEqual({
      status: "valid",
      keyId: bundleKeyId(signer.publicPem),
      trusted: true,
    });
    // The other checks read nothing the signature adds.
    expect(verifyVerificationBundle(signed).valid).toBe(true);
  });

  it("verifies against the embedded key without trusting it", () => {
    const result = verifyBundleSignature(signVerificationBundle(bundle(), signer.privatePem));
    expect(result.status).toBe("valid");
    expect(result.trusted).toBe(false);
  });

  it("fails a manifest changed after signing", () => {
    const signed = signVerificationBundle(bundle(), signer.privatePem);
    const tampered = { ...signed, manifest: { ...signed.manifest, manifestHash: "0".repeat(64) } };
    expect(verifyBundleSignature(tampered, signer.publicPem)).toMatchObject({ status: "invalid", trusted: false });
  });

  it("does not trust a bundle signed with another key, even one that verifies", () => {
    const other = keyPair();
    const result = verifyBundleSignature(signVerificationBundle(bundle(), other.privatePem), signer.publicPem);
    expect(result).toMatchObject({ status: "valid", trusted: false });
    expect(result.error).toMatch(/not the trusted key/);
  });

  it("reports a swapped embedded key whose ID no longer matches", () => {
    const signed = signVerificationBundle(bundle(), signer.privatePem);
    const other = signVerificationBundle(bundle(), keyPair().privatePem);
    const swapped = {
      ...signed,
      signature: {
        ...(signed.signature as NonNullable<typeof signed.signature>),
        publicKey: other.signature?.publicKey ?? "",
      },
    };
    expect(verifyBundleSignature(swapped).status).toBe("invalid");
  });

  it("says an unsigned bundle is unsigned, and fails it when a key is required", () => {
    expect(verifyBundleSignature(bundle())).toEqual({ status: "unsigned", trusted: false });
    expect(verifyBundleSignature(bundle(), signer.publicPem)).toMatchObject({ status: "unsigned", trusted: false });
  });

  it("refuses to sign with a key that is not Ed25519", () => {
    expect(() => signVerificationBundle(bundle(), keyPair("ec").privatePem)).toThrow(/Ed25519/);
  });
});
