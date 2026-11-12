# Schema Versioning Policy

Refract's event schema carries `EVENT_SCHEMA_VERSION` on every `EvidenceEvent`. This document defines what constitutes a breaking vs. non-breaking change so consumers can pin their compatibility checks to a contract, not guesswork.

## Version format

`MAJOR.MINOR.PATCH` (semantic versioning). Current: `0.5.0` (`EVENT_SCHEMA_VERSION` in `@refract-org/evidence-graph` 0.5.1).

The published `@refract-org/evidence-graph@0.5.0` stamps `"0.4.0"`: its build predates the bump, which reached the source under the same package version. A consumer on 0.5.0 therefore sees `"0.4.0"` on events with the same `EventType` members (0.5.0 added optional fields only); 0.5.1 is the first package version that stamps `"0.5.0"`.

## Breaking changes (MAJOR bump)

A breaking change requires consumers to update their code. These require a MAJOR version bump:

- **Removing an event type from `EventType`**. Any consumer filtering on that type will break.
- **Renaming an event type**. Same effect as removal + addition, but the old name vanishes.
- **Removing a field from `EvidenceEvent`**. Any consumer reading that field will break at runtime or compile time.
- **Changing the type of an existing field**. e.g., `fromRevisionId: number` → `fromRevisionId: string`.
- **Removing a member from a union type** used in event fields (e.g., removing `"rfc_closure"` from `OutcomeLabel.source`).
- **Changing the event ID hashing algorithm**. Any consumer relying on deterministic `eventId` for deduplication or verification will see different hashes for the same events.

## Non-breaking changes (MINOR bump)

A non-breaking change adds capabilities without breaking existing consumers. These require a MINOR version bump:

- **Adding a new event type to `EventType`**. Consumers that iterate all types or use `switch` statements may need updating to handle the new case, but existing event type handling continues to work.
- **Adding a new optional field to `EvidenceEvent`**. Existing consumers ignore unknown fields. New consumers can read the field.
- **Adding a new member to a union type** used in event fields.
- **Adding a new analyzer** that produces existing event types. Output volume changes, but event structure is unchanged.

## Patch changes (PATCH bump)

- Bug fixes that don't change the schema.
- Performance improvements.
- Dependency updates.
- Documentation changes.

## What consumers SHOULD do

- **Pin to a minor version**: `@refract-org/evidence-graph@~0.5`. You'll get patches and non-breaking additions.
- **Handle unknown event types gracefully**: if you encounter an event type you don't recognize, log it and preserve it. Don't silently drop.
- **Check `schemaVersion` at runtime**: every event carries it. If you see a schema version you don't support, degrade gracefully rather than crashing.

## What consumers MAY do

- **Accept events across minor versions** if you handle unknown `EventType` members. The schema is designed so minor bumps are additive.

## What consumers MUST NOT do

- **Silently drop events with unrecognized types**. Log them. Preserve the raw data. A consumer that silently drops a new event type will miss data with no indication anything went wrong.

## Negotiation table

| refract CLI | `@refract-org/evidence-graph` | `EVENT_SCHEMA_VERSION` | Key changes |
|---|---|---|---|
| 0.6.1 | 0.5.4 | `"0.5.0"` | Current. Same `EventType` members; the CLI emits the cluster, spike and thread events, and citation events name their section |
| 0.6.0 | 0.5.3 | `"0.5.0"` | Tagged; the CLI did not reach npm |
| 0.5.15–0.5.17 | 0.5.1–0.5.2 | `"0.5.0"` | Optional fields added to `EvidenceEvent`; same `EventType` members |
| 0.5.0–0.5.7 | 0.4.x–0.5.0 | `"0.4.0"` | `sentence_modified`, `FactProvenance.parameters`, `AnalyzerConfig`, `EVENT_SCHEMA_VERSION`, `CLAIM_IDENTITY_VERSION` |
| 0.4.x | 0.3.x | `"0.3.0"` | `ClaimLedger`, `ObservationReport`, `--report` flag, cron merging |
| 0.3.x | 0.2.x | `"0.2.0"` | 25 event types, initial public release |

## Future breaking changes (planned, not yet shipped)

When a MAJOR bump becomes necessary, the release notes will include a migration guide with before/after examples. Breaking changes will be announced in the CHANGELOG and tagged with `breaking` in the release.

## Hash stability

`createEventIdentity()` uses SHA-256 over a fixed set of fields. Changing this algorithm is a MAJOR bump. Consumers that store event IDs for deduplication or verification must be able to regenerate the same IDs from the same event data. A hash algorithm change would break this guarantee.

## Related

- [Event schema reference](https://zz-plant.github.io/refract/schema/) — full `EvidenceEvent` structure
- [COMPATIBILITY.md](COMPATIBILITY.md) — cross-repo version matrix
- [Downstream integration](https://zz-plant.github.io/refract/downstream/) — production patterns for consuming events
