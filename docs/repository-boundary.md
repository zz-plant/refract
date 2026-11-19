# Repository Boundary

Refract provides temporal observability for
MediaWiki and other available revision histories. It derives observations of
changes across time, anchored to source revisions. Domain-specific interpretation
belongs in downstream applications.

## In Scope

- Fetching and replaying MediaWiki revision histories across any language edition.
- Deterministic extraction of what changed between revisions, including multilingual text and certainty/hedging markers (e.g., English and Arabic).
- Provenance records for claims, sources (including structural source categories such as academic DOIs, intergovernmental/UN, NGO/civil-society reports, and news media), page structure, links, categories, templates, talk-page references, and page moves.
- Privacy-preserving actor cohort and session pseudonym observations (run-scoped pseudonymous actor labels and unique actor counts on revert loops and edit clusters, without exposing raw editor identities).
- Cross-wiki and cross-language citation and identifier comparison (comparing shared URLs, DOIs, ISBNs, and domains across language editions).
- Claim-state timelines under deterministic identity and text-matching rules, with support for user-supplied external timeline context markers in downstream viewers.
- Replay manifests and verification bundles for checking hash and proof consistency.
- Generic benchmarks that check whether Refract detected publicly observable
  revision-history events.
- Connectors for public or user-controlled MediaWiki instances.

## Out of Scope

- Healthcare-specific logic: claim supportability thresholds, jurisdiction
  routing, authority-weighting, clinical source ranking, bitemporal gap
  detection, claim-context mapping, and review workflow triggers.
- Claims that Refract determines truth, predicts external events, or doxxes/tracks individual editors across wikis.
- Model-assisted interpretation, recommendations, and domain-specific judgments.
- Guarantees of complete history, source authenticity, or semantic identity through
  arbitrary rewrites based only on revision diffs and bundle hashes.

## Test

A valid Refract contribution should be useful for observing public-knowledge change
on Wikipedia, Fandom, or another MediaWiki instance — across time, not just at the
current revision — without relying on healthcare context or private decision criteria.

## Enforcement

This boundary is not a convention. `scripts/check-boundaries.ts` runs as
`bun run check:boundaries`, in the `gate` job of `.github/workflows/ci.yml`, on every
pull request and every push to `main`. A violation exits non-zero and fails the build.

It enforces two separate rules:

1. **No domain vocabulary in the open-source tree.** A word list — `payer`, `clinical`,
   `guideline`, `formulary`, `FDA`, `PubMed`, `pharma`, `ticker`, `materiality` and
   others — is rejected anywhere under `packages/`, `examples/` or `scripts/`, in code,
   JSON, shell and Markdown alike. `docs/` is outside the scan, which is the only reason
   this file can name the terms it forbids. The list lives at the top of the script;
   extend it there when a new domain term starts leaking rather than arguing the case in
   review.

2. **No upward imports from ingestion.** `packages/ingestion` may not import
   `@refract-org/analyzers` at all, nor `@refract-org/evidence-graph` at runtime — types
   are fine. Raw data access must not depend on the interpreted layers above it.

The first rule is why this document can be believed by someone who has not read the
code: the terms it forbids are the terms a healthcare fork would have to introduce, and
introducing one turns the build red rather than starting a discussion.
