# @refract-org/evidence-graph

Core types and schemas. Zero runtime dependencies.

```bash
bun add @refract-org/evidence-graph
```

## Exports

### Types

- `ClaimIdentity`, `ClaimLineage`, `ClaimState`, `ClaimObject` — claim tracing
- `EvidenceEvent`, `DeterministicFact`, `EvidenceLayer` — event model
- `SourceRecord`, `SourceLineage`, `SourceReplacement`, `SourceType`, `SourceAuthority` — citation tracking
- `Report`, `ReportLayer`, `ReportLayerLabel`, `ExportFormat`, `Depth`, `PageTimeline`, `TimelineEvent`, `PolicySignal` — report assembly
- `Revision`, `DiffResult`, `DiffLine`, `Section`, `SectionChange` — revision model

### Functions

- `createClaimIdentity({ text, section, pageTitle, pageId, version? })` — returns a `ClaimIdentity` (`claimId`, `identityKey`, `pageTitle`, `pageId`); `claimId` is a deterministic hash for claim dedup
- `createEventIdentity(event)` — deterministic 16-hex-character fingerprint of an `EvidenceEvent`

### Verification bundles (0.5.1+)

A replay manifest (input revision hashes, output event hashes and their Merkle root), the events, and a Merkle inclusion proof per event hash, in one object. Nothing in a bundle is signed.

- `createVerificationBundle(...)` — package a replay manifest, its events, and Merkle proofs
- `verifyVerificationBundle(bundle)` — recompute the manifest hash and the Merkle root from the manifest's event hashes, rehash each event and compare it with the hash listed at its index, and check that each listed hash has one proof, for that hash and index, ending at the manifest's root. The result lists each failure with its index, and `events` gives the hash and proof outcome per event. Before 0.5.3 it did not rehash the events or compare a proof's root with the manifest's.
- `hashLeaf`, `getMerkleProof`, `verifyMerkleProof` — the proof primitives
- Types: `ReplayManifest`, `MerkleProof`, `VerificationBundle`, `VerificationBundleResult`

An event's hash is its `eventId`, or `createEventIdentity` when it has none, and an `eventId` has to equal `createEventIdentity`. That covers the event's type, revision IDs, section, before and after text, timestamp, and each fact's text and detail. Its other fields (`layer`, `claimId`, `schemaVersion`, the semantic enrichment fields, each fact's `provenance` and `sourceSpan`, `modelInterpretation`) are outside the hash, so edits to them still verify.

```ts
import type { EvidenceEvent, Revision } from "@refract-org/evidence-graph";
import { createClaimIdentity, createVerificationBundle } from "@refract-org/evidence-graph";
```

[Refract](https://github.com/refract-org/refract) · [Docs](https://zz-plant.github.io/refract/) · [npm](https://www.npmjs.com/package/@refract-org/evidence-graph)
