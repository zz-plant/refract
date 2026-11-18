import { createHash, createPrivateKey, createPublicKey, type KeyObject, sign, verify } from "node:crypto";
import { createEventIdentity } from "./hash-identity.js";
import type { EvidenceEvent } from "./schemas/evidence.js";
import type { Revision } from "./schemas/revision.js";

export interface MerkleProof {
  leafHash: string;
  leafIndex: number;
  siblings: string[];
  rootHash: string;
}

export interface ReplayManifest {
  format: "refract-replay-manifest/v1";
  generatedAt: string;
  pageTitle: string;
  analyzerVersions: Record<string, string>;
  inputRevisionHashes: string[];
  outputEventHashes: string[];
  merkleRoot: string;
  manifestHash: string;
}

export function hashLeaf(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function hashPair(a: string, b: string): string {
  return createHash("sha256")
    .update(a < b ? a + b : b + a)
    .digest("hex");
}

export function buildMerkleTree(hashes: string[]): string[][] {
  if (hashes.length === 0) return [[""]];
  const levels: string[][] = [hashes];
  let current = hashes;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPair(current[i], current[i + 1]));
      } else {
        next.push(current[i]);
      }
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

export function getMerkleProof(levels: string[][], leafIndex: number): MerkleProof {
  const leafHash = levels[0][leafIndex];
  if (!leafHash) throw new Error(`Leaf index ${leafIndex} out of range`);
  const siblings: string[] = [];
  let idx = leafIndex;
  for (let level = 0; level < levels.length - 1; level++) {
    const isLeft = idx % 2 === 0;
    const siblingIdx = isLeft ? idx + 1 : idx - 1;
    if (siblingIdx < levels[level].length) {
      siblings.push(levels[level][siblingIdx]);
    }
    idx = Math.floor(idx / 2);
  }
  const root = levels[levels.length - 1];
  return {
    leafHash,
    leafIndex,
    siblings,
    rootHash: root[0] ?? "",
  };
}

export function verifyMerkleProof(proof: MerkleProof): boolean {
  let hash = proof.leafHash;
  for (const sibling of proof.siblings) {
    hash = hashPair(hash, sibling);
  }
  return hash === proof.rootHash;
}

// The hash a manifest lists for an event, and the one verifyVerificationBundle
// recomputes from it. modelInterpretation is not part of it.
function eventHash(event: EvidenceEvent): string {
  return event.eventId ?? createEventIdentity(event);
}

export function createReplayManifest(params: {
  pageTitle: string;
  analyzerVersions: Record<string, string>;
  revisions: Revision[];
  events: EvidenceEvent[];
  generatedAt?: string;
}): ReplayManifest {
  const inputHashes = params.revisions.map((r) => createHash("sha256").update(r.content).digest("hex"));

  const outputHashes = params.events.map(eventHash);

  const merkleRoot = buildMerkleTree(outputHashes).at(-1)?.[0] ?? "";

  const partial = {
    format: "refract-replay-manifest/v1" as const,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    pageTitle: params.pageTitle,
    analyzerVersions: params.analyzerVersions,
    inputRevisionHashes: inputHashes,
    outputEventHashes: outputHashes,
    merkleRoot,
  };

  const manifestHash = createHash("sha256").update(JSON.stringify(partial)).digest("hex");

  return { ...partial, manifestHash };
}

export function singleEventProof(manifest: ReplayManifest, eventIndex: number): MerkleProof {
  const levels = buildMerkleTree(manifest.outputEventHashes);
  return getMerkleProof(levels, eventIndex);
}

/**
 * An Ed25519 signature over the bundle's `manifestHash`. The manifest hash
 * covers the event hashes, their Merkle root, the input revision hashes and
 * the analyzer versions, so a valid signature on a bundle that also verifies
 * says the key's holder vouched for exactly these events. The embedded public
 * key says which key signed, not whose it is: trust comes from checking it
 * against a key obtained some other way.
 */
export interface BundleSignature {
  algorithm: "ed25519";
  signs: "manifestHash";
  /** First 16 hex characters of SHA-256 over the public key's SPKI DER encoding. */
  keyId: string;
  /** The signing key's public half, SPKI DER in base64. */
  publicKey: string;
  /** The signature over the UTF-8 bytes of `manifest.manifestHash`, base64. */
  value: string;
}

export interface VerificationBundle {
  format: "refract-verification-bundle/v1";
  exportedAt: string;
  manifest: ReplayManifest;
  events: EvidenceEvent[];
  proofs: MerkleProof[];
  /** Present when the bundle was signed; older readers ignore it. */
  signature?: BundleSignature;
}

export function createVerificationBundle(params: {
  pageTitle: string;
  analyzerVersions: Record<string, string>;
  revisions: Revision[];
  events: EvidenceEvent[];
}): VerificationBundle {
  const manifest = createReplayManifest(params);
  const proofs = manifest.outputEventHashes.map((_, idx) => singleEventProof(manifest, idx));

  return {
    format: "refract-verification-bundle/v1",
    exportedAt: new Date().toISOString(),
    manifest,
    events: params.events,
    proofs,
  };
}

export interface VerificationBundleResult {
  valid: boolean;
  errors: string[];
  /** One entry per event, in bundle order. */
  events: Array<{
    /** The event hashes to the hash the manifest lists at its index. */
    hashMatches: boolean;
    /** The proof at the event's index, checked against the manifest. */
    proof: "pass" | "fail" | "missing";
  }>;
}

export function verifyVerificationBundle(bundle: VerificationBundle): VerificationBundleResult {
  const errors: string[] = [];

  if (bundle.format !== "refract-verification-bundle/v1") {
    errors.push(`Invalid bundle format: ${bundle.format}`);
  }

  // A bundle read from a file can lack any part; report it rather than throw.
  if (
    !Array.isArray(bundle.manifest?.outputEventHashes) ||
    !Array.isArray(bundle.events) ||
    !Array.isArray(bundle.proofs)
  ) {
    errors.push("Bundle is missing its manifest event hashes, its events or its proofs");
    return { valid: false, errors, events: [] };
  }

  const hashes = bundle.manifest.outputEventHashes;

  // 1. Check manifest hash integrity
  const { manifestHash, ...manifestBody } = bundle.manifest;
  const expectedManifestHash = createHash("sha256").update(JSON.stringify(manifestBody)).digest("hex");
  if (manifestHash !== expectedManifestHash) {
    errors.push("Manifest hash mismatch");
  }

  // 2. Check event count matches output hashes
  if (bundle.events.length !== hashes.length) {
    errors.push(`Event count (${bundle.events.length}) does not match manifest hashes count (${hashes.length})`);
  }

  // 3. Verify Merkle root matches computed root
  const tree = buildMerkleTree(hashes);
  const computedRoot = tree.at(-1)?.[0] ?? "";
  if (computedRoot !== bundle.manifest.merkleRoot) {
    errors.push("Manifest Merkle root does not match computed root from hashes");
  }

  // 4. Rehash each event as createReplayManifest did and compare it with the
  // hash listed at its index. An eventId stands in for the content hash there,
  // so an event carrying one must also hash to it.
  const hashMatches = bundle.events.map((event, i) => {
    const hash = eventHash(event);
    if (hash !== hashes[i]) {
      errors.push(`Event index ${i} hashes to ${hash}; the manifest lists ${hashes[i] ?? "no hash"} at that index`);
      return false;
    }
    const contentHash = createEventIdentity(event);
    if (event.eventId !== undefined && event.eventId !== contentHash) {
      errors.push(`Event index ${i} carries eventId ${event.eventId}, but its content hashes to ${contentHash}`);
      return false;
    }
    return true;
  });

  // 5. One proof per listed hash, each for the hash at its index and ending at
  // the manifest's root, not just at the root the proof itself records.
  if (bundle.proofs.length !== hashes.length) {
    errors.push(`Proof count (${bundle.proofs.length}) does not match manifest hashes count (${hashes.length})`);
  }
  const proofPasses = bundle.proofs.map((proof, i) => {
    const before = errors.length;
    if (proof.leafHash !== hashes[i]) {
      errors.push(`Proof leaf hash for event index ${i} does not match the manifest's hash at that index`);
    }
    if (proof.leafIndex !== i) {
      errors.push(`Proof for event index ${i} records leaf index ${proof.leafIndex}`);
    }
    if (proof.rootHash !== bundle.manifest.merkleRoot) {
      errors.push(`Proof root for event index ${i} does not match the manifest Merkle root`);
    }
    if (!verifyMerkleProof(proof)) {
      errors.push(`Merkle proof verification failed for event index ${i}`);
    }
    return errors.length === before;
  });

  return {
    valid: errors.length === 0,
    errors,
    events: hashMatches.map((matches, i) => ({
      hashMatches: matches,
      proof: i >= proofPasses.length ? "missing" : proofPasses[i] ? "pass" : "fail",
    })),
  };
}

function publicKeyDer(key: KeyObject): Buffer {
  return key.export({ type: "spki", format: "der" }) as Buffer;
}

/** The key ID BundleSignature uses: SHA-256 over the public key's SPKI DER, first 16 hex characters. */
export function bundleKeyId(publicKeyPem: string): string {
  const der = publicKeyDer(createPublicKey(publicKeyPem));
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/**
 * The bundle with an Ed25519 signature over its manifest hash added. Takes a
 * PEM private key, such as one from `openssl genpkey -algorithm ed25519`.
 * Signing changes nothing the other checks read, so a signed bundle verifies
 * as it did unsigned.
 */
export function signVerificationBundle(bundle: VerificationBundle, privateKeyPem: string): VerificationBundle {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error(
      `The signing key is ${privateKey.asymmetricKeyType ?? "not an asymmetric key"}; use an Ed25519 key.`,
    );
  }
  const der = publicKeyDer(createPublicKey(privateKey));
  const value = sign(null, Buffer.from(bundle.manifest.manifestHash, "utf8"), privateKey).toString("base64");
  return {
    ...bundle,
    signature: {
      algorithm: "ed25519",
      signs: "manifestHash",
      keyId: createHash("sha256").update(der).digest("hex").slice(0, 16),
      publicKey: der.toString("base64"),
      value,
    },
  };
}

export interface BundleSignatureResult {
  /** `unsigned`: no signature. `valid`: it verifies with its key. `invalid`: it does not, or is malformed. */
  status: "unsigned" | "valid" | "invalid";
  keyId?: string;
  /** A trusted key was given and the signature verifies with it. */
  trusted: boolean;
  error?: string;
}

/**
 * Check the bundle's signature over its manifest hash. With
 * `trustedPublicKeyPem`, the signature must have been made with that key: a
 * bundle signed by any other key, or not signed, is not trusted. Without
 * one, the signature is checked against the key it carries, which shows the
 * manifest was not changed after signing but not who signed it. Does not
 * check the rest of the bundle; use verifyVerificationBundle for that.
 */
export function verifyBundleSignature(bundle: VerificationBundle, trustedPublicKeyPem?: string): BundleSignatureResult {
  const sig = bundle.signature;
  if (!sig) {
    return trustedPublicKeyPem
      ? { status: "unsigned", trusted: false, error: "The bundle is not signed" }
      : { status: "unsigned", trusted: false };
  }
  try {
    if (sig.algorithm !== "ed25519" || sig.signs !== "manifestHash") {
      return {
        status: "invalid",
        keyId: sig.keyId,
        trusted: false,
        error: `Unsupported signature: ${sig.algorithm} over ${sig.signs}`,
      };
    }
    const embedded = createPublicKey({ key: Buffer.from(sig.publicKey, "base64"), format: "der", type: "spki" });
    const embeddedDer = publicKeyDer(embedded);
    const keyId = createHash("sha256").update(embeddedDer).digest("hex").slice(0, 16);
    if (keyId !== sig.keyId) {
      return {
        status: "invalid",
        keyId: sig.keyId,
        trusted: false,
        error: `The key ID ${sig.keyId} is not the embedded key's (${keyId})`,
      };
    }
    const message = Buffer.from(bundle.manifest?.manifestHash ?? "", "utf8");
    const valid = verify(null, message, embedded, Buffer.from(sig.value, "base64"));
    if (!valid) {
      return { status: "invalid", keyId, trusted: false, error: "The signature does not match the manifest hash" };
    }
    if (!trustedPublicKeyPem) return { status: "valid", keyId, trusted: false };
    const trustedDer = publicKeyDer(createPublicKey(trustedPublicKeyPem));
    if (!trustedDer.equals(embeddedDer)) {
      return {
        status: "valid",
        keyId,
        trusted: false,
        error: `Signed by key ${keyId}, not the trusted key ${createHash("sha256").update(trustedDer).digest("hex").slice(0, 16)}`,
      };
    }
    return { status: "valid", keyId, trusted: true };
  } catch (error) {
    return {
      status: "invalid",
      keyId: sig.keyId,
      trusted: false,
      error: `The signature could not be checked: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
