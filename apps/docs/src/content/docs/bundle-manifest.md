---
title: "Export formats: bundles and manifests"
description: "An evidence bundle contains the input revisions and output events for a page observation, with a SHA-256 hash (bundleHash) of the rest of the bundle. The…"
---

## Evidence bundle (`--bundle`)

An evidence bundle contains the input revisions and output events for a page observation, with a SHA-256 hash (`bundleHash`) of the rest of the bundle. The hash is not a signature: it catches a copy that was damaged or edited without recomputing it, but anyone who edits the bundle can recompute it. To detect deliberate edits, send or publish the hash separately from the file.

```bash
refract export "Earth" --bundle > earth-bundle.json
```

```json
{
  "format": "refract-evidence-bundle/v1",
  "generatedAt": "2025-05-15T10:00:00.000Z",
  "pageTitle": "Earth",
  "revisionRange": { "from": 1289400000, "to": 1290100000 },
  "inputRevisions": [ ... ],
  "outputEvents": [ ... ],
  "bundleHash": "a1b2c3d4e5f6..."
}
```

Use bundles to pass events together with the revisions they were derived from.

## Replay manifest (`--manifest`)

A replay manifest is a Merkle tree of event hashes that lets you verify the exact set of events without sending the full payload. Each event's hash is a leaf in the tree; the root hash represents the complete observation.

![Merkle tree verification](merkle-tree.svg)

```bash
refract export "Earth" --manifest > earth-manifest.json
```

```json
{
  "format": "refract-replay-manifest/v1",
  "generatedAt": "2025-05-15T10:00:00.000Z",
  "pageTitle": "Earth",
  "analyzerVersions": { "refract": "0.5.17" },
  "inputRevisionHashes": [ ... ],
  "outputEventHashes": [ "0737234eb11ab883", ... ],
  "merkleRoot": "abc...",
  "manifestHash": "def..."
}
```

Each event hash is the event's `createEventIdentity` (or its `eventId`, if it carries one): the first 16 hex characters of a SHA-256 over its type, revision IDs, section, before and after text, timestamp and facts. The same Refract version over the same revision range (`--from`, `--to`) gives the same event hashes and the same `merkleRoot`; `manifestHash` also covers `generatedAt`, so it differs between runs.

Use manifests when you need lightweight integrity verification — for example, checking whether an observation has changed without re-downloading all events. The `@refract-org/evidence-graph` package exports `createReplayManifest`, `buildMerkleTree`, `getMerkleProof`, and `verifyMerkleProof` for programmatic use.

## Verification bundle with Merkle proofs (`--proof`)

A verification bundle puts three things in one JSON file:

1. The replay manifest (input revision hashes, analyzer versions, event hashes, their Merkle root, and the manifest hash).
2. The events.
3. A Merkle inclusion proof for each event hash: the leaf hash, the sibling hashes up the tree, and the root they produce.

```bash
refract export "Earth" --proof > earth-proof.json
```

```json
{
  "format": "refract-verification-bundle/v1",
  "exportedAt": "2026-09-26T00:00:00Z",
  "manifest": {
    "pageTitle": "Earth",
    "merkleRoot": "a3b4c5...",
    "manifestHash": "d6e7f8...",
    "inputRevisionHashes": [ ... ],
    "outputEventHashes": [ ... ]
  },
  "events": [ ... ],
  "proofs": [
    {
      "leafHash": "e1...",
      "leafIndex": 0,
      "siblings": [ ... ],
      "rootHash": "a3b4c5..."
    }
  ]
}
```

### Checking a bundle

`refract verify` checks a bundle offline:

```bash
refract verify earth-proof.json

# Also write the result as an HTML file
refract verify earth-proof.json --html receipt.html
```

It recomputes the manifest hash and recomputes the Merkle root from the manifest's event hashes. It rehashes each event the way the export did and compares the result with the hash listed at the event's index; if an event carries an `eventId`, its content must hash to that ID. It checks that each listed hash has one proof, for that hash and index, that hashes up to the manifest's Merkle root. It reports each failure with its index and exits 1 if any check fails. `receipt.html` is a single HTML file with the result, the manifest's hashes, and a row per event showing its hash check and its proof check.

Up to 0.5.17, `verify` did not rehash the events or compare a proof's root with the manifest's, so a bundle with an edited event, a missing proof, or a proof ending at another root passed.

What it does not check:

- Event fields outside the event hash: `layer`, `claimId`, `schemaVersion`, the semantic enrichment fields (`editMagnitude`, `contentChange`, `keyTerms`, `certaintyProfile`, `directionSignal`, `quantitativeFindings`), each fact's `provenance` and `sourceSpan`, and `modelInterpretation`. Edits to them pass.
- That the events are what Refract derives from the page's revisions. The bundle holds only the revisions' hashes.
- Who made the bundle. Nothing in it is signed, and anyone who edits it can recompute every hash. A pass shows the bundle is internally consistent. To detect edits, compare its Merkle root with one you received separately, or re-run the same Refract version over the same revision range and compare roots.
