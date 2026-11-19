# Constitutional Drift and Minority Evidence in Open Knowledge Systems

**Status:** Draft spec — milestone M-CDME-1 (combined #14 + #5)
**Scope:** Domain-neutral. Observes public MediaWiki and other revision histories.
**Pairs with:** `docs/categorization-drift.md` (milestone M-CD-1, idea #12).
**Owner surface:** `refract` (observation engine) + downstream applications for interpretation.

---

## 1. Why this milestone

Open knowledge systems (Wikipedia, Fandom wikis, open-source governance logs)
are often treated as self-correcting: errors get reverted, consensus emerges,
and the current page is the best available summary. That reading conflates
*responsiveness* with *revisability*. An institution can absorb contradictory
evidence, revert dissenting edits, and accumulate procedural complexity while
never changing the rule that decides what counts as evidence — and the revision
history will show only a sequence of settled states.

This milestone defines an observation layer that makes two things measurable
from the public record:

1. **Constitutional drift** (#14): how rule-making power concentrates over
   time through automated moderation, procedural complexity, and the slow
   migration of decisions from talk pages into protected templates, bots, and
   policy pages.
2. **Minority evidence survival** (#5): whether localized domain knowledge,
   minority testimony, and edge-case citations persist, get reverted, or are
   smoothed into statistical consensus — and on what timescale.

Together they form the first empirical test of the Possibility / Authority /
Necessity frame on open systems: do high-performing knowledge projects leave
their contributors more or less able to recognize and pursue alternatives?

Refract supplies the observation layer only. Interpretation (scoring,
attribution, recommendations) belongs downstream, per `docs/repository-boundary.md`.

---

## 2. What Refract already provides

| Primitive | Where | Relevance |
|-----------|-------|-----------|
| Revision history replay | `packages/ingestion` | Full ordered revision stream per page |
| Sentence-level events | `packages/analyzers` (`revision-events.ts`) | First-seen, modified, removed, reintroduced |
| Revert detection | `packages/analyzers` | Identifies edit wars and rollbacks |
| Talk-page references | `packages/analyzers` | Links between article edits and discussion |
| Citation events | `packages/analyzers` | Citation added / removed / replaced |
| Template & category events | `packages/analyzers` | Structural changes to page scaffolding |
| Page moves | `packages/analyzers` | Renames and redirects (canon changes) |
| Semantic enrichment | v0.5.0+ | Magnitude, content change, direction signal, certainty profile |
| Claim-state timelines | `docs/concepts/claim-state-timelines.md` | Observed transitions anchored to revisions |
| `transitions` (PR #79) | `runClaimHistory`, `refract claim --json`, MCP `get_statement_history` | Bracketing revisions, revert evidence, held-revision counts |

This milestone adds **aggregation and classification rules** on top of those
primitives, not new ingestion.

---

## 3. Observations to derive

All observations are deterministic functions of the captured revision range.
Each carries the revision IDs it depends on and is reproducible byte-for-byte.

### 3.1 Constitutional drift signals

| Signal | Definition | Source primitive |
|--------|------------|------------------|
| `protected_edit_share` | Share of edits in the window that required elevated rights (admin/bot/template-protected) | revision metadata + revert/protect events |
| `procedural_depth` | Count of distinct policy/template/noticeboard pages referenced or invoked by edits in the window | talk-page references + template events |
| `rule_migration` | An edit that moves a decision from a talk page into a template, bot, or policy page | page moves + template events + talk references |
| `revert_asymmetry` | Revert rate for edits by accounts below a threshold rights level vs. above it | revert detection + revision metadata |
| `bot_share_trend` | Rolling share of edits attributed to bot accounts, by month | revision metadata |

These are **descriptive**. They describe how the system's own procedures
changed. They do not assert that the change was illegitimate.

### 3.2 Minority evidence survival signals

| Signal | Definition | Source primitive |
|--------|------------|------------------|
| `minority_claim_first_seen` | First revision in range where a passage (or its normalized form) appears, tagged with its section and citation set | sentence events |
| `minority_claim_survival_days` | Days between first-seen and first removal (or end of range) | sentence events |
| `revert_of_minority_edit` | Whether an edit introducing the passage was reverted, and by whom (rights level) | revert detection |
| `citation_diversity` | Distinct citation domains in the passage's citation set, and how it changes on edit | citation events |
| `consensus_smoothing` | A modification that reduces the number of distinct sources or viewpoints in a passage without a corresponding removal event | sentence events + citation events |
| `reintroduction` | Passage removed then re-added; count and lag | sentence events (`sentence_reintroduced`) |

### 3.3 Cross-cutting: rule-change events

A **rule-change event** is an observation that a governing artifact (policy
page, template, bot configuration, protection level) changed in a way that
alters what future edits are permitted or how they are evaluated. These are
the hinge between 3.1 and 3.2: a rule change that precedes a drop in
minority-claim survival is a candidate constitutional-drift event.

Rule-change events are derived from:
- Page moves into/out of the `Wikipedia:` / `Template:` / `MediaWiki:` namespaces
- Protection level changes (where available in revision metadata)
- Template edits that change rendered output (template events)
- Bot configuration edits

---

## 4. Data schema

The milestone defines three new observation record types. They are **additive**
to the existing event schema and do not change existing event IDs or hashes.

### 4.1 `ConstitutionalDriftWindow`

A rolling window summary over a page or set of pages.

```json
{
  "type": "constitutional_drift_window",
  "page": "string",
  "windowStart": "ISO-8601",
  "windowEnd": "ISO-8601",
  "revisionStart": "number",
  "revisionEnd": "number",
  "signals": {
    "protected_edit_share": "number",
    "procedural_depth": "number",
    "rule_migration_count": "number",
    "revert_asymmetry": "number | null",
    "bot_share_trend": "number"
  },
  "ruleChangeEvents": ["RuleChangeEvent.id"],
  "sourceRevisions": ["number"]
}
```

### 4.2 `MinorityEvidenceTrace`

A per-passage trace of survival.

```json
{
  "type": "minority_evidence_trace",
  "passageId": "string (claim identity)",
  "page": "string",
  "firstSeenRevision": "number",
  "firstSeenDate": "ISO-8601",
  "lastSeenRevision": "number | null",
  "removedRevision": "number | null",
  "survivalDays": "number | null",
  "reverted": "boolean",
  "revertRevision": "number | null",
  "reverterRightsLevel": "string | null",
  "citationDomains": ["string"],
  "citationDiversityDelta": "number",
  "consensusSmoothingDetected": "boolean",
  "reintroductionCount": "number",
  "sourceRevisions": ["number"]
}
```

### 4.3 `RuleChangeEvent`

```json
{
  "type": "rule_change_event",
  "id": "string",
  "page": "string",
  "revision": "number",
  "date": "ISO-8601",
  "kind": "namespace_migration | protection_change | template_change | bot_config_change",
  "from": "string | null",
  "to": "string | null",
  "precedingMinorityTraceIds": ["string"],
  "followingMinorityTraceIds": ["string"]
}
```

All three carry the standard Refract provenance fields (hash, capture
timestamp, analyzer version) so they are tamper-evident and reproducible.

---

## 5. Target corpus (proof of concept)

The proof of concept runs on **three public corpora**, chosen for contrasting
governance regimes:

1. **Wikipedia policy pages** (e.g., `Wikipedia:Verifiability`,
   `Wikipedia:Reliable sources`, `Wikipedia:No original research`).
   High procedural depth, slow rule change, strong revert culture. Tests
   whether minority evidence gets smoothed over years.
2. **A Fandom wiki with active canon disputes** (e.g., a Star Wars or
   Game of Thrones wiki). Multiple coexisting canons, fork events, contested
   sourcing. Tests whether drift is visible when "consensus" is itself
   disputed. (Refract's ROADMAP already names Fandom as the stress test.)
3. **An open-source governance log** (e.g., a project's `CONTRIBUTING.md`
   history, or a public RFC repository tracked via MediaWiki or git). Tests
   whether procedural complexity concentrates commit/merge rights over time.

For each corpus, the run produces:
- A `ConstitutionalDriftWindow` series (monthly windows)
- A `MinorityEvidenceTrace` per tracked passage
- A `RuleChangeEvent` list
- A short report (Markdown) summarizing observed patterns, with revision
  links, suitable for a grant or paper appendix

**No healthcare, no private data, no model calls.** The corpus is public and
the observations are deterministic.

---

## 6. What this milestone does NOT do

- It does not score institutions. Scoring (the 3-axis P/A/N profile) is a
  downstream application (see `ethotechnics` #11).
- It does not attribute intent to editors. Observations are revision-anchored
  facts; interpretation of motive is out of scope.
- It does not predict future edits. It describes past change only.
- It does not replace human review. Outputs are inputs to review, not verdicts.

---

## 7. Success criteria

The milestone ships when:

1. A single command (or documented pipeline) runs the full observation pass
   over one of the three target corpora and emits the three record types as
   NDJSON.
2. The output is byte-reproducible on a second run over the same revision
   range.
3. A short report demonstrates at least one observable pattern of (a) rule
   migration preceding minority-evidence loss, or (b) minority-claim
   reintroduction after a rule change — with revision links a reader can
   verify.
4. The boundary check (`bun run check:boundaries`) passes: no domain
   vocabulary in `packages/`, `examples/`, or `scripts/`.

---

## 8. Relationship to the research program

This milestone is the empirical anchor for the Possibility / Authority /
Necessity frame on open systems:

- **Possibility** — whether minority claims and edge-case testimony remain
  recognizable and pursuable, or get smoothed into consensus.
- **Authority** — whether rule changes concentrate decision rights, and
  whether contributors below the threshold can still make objections
  consequential.
- **Necessity** — the cost of doing otherwise: how much effort a minority
  view must expend to survive, and how that cost changes as procedures deepen.

It is the fastest path to a publishable empirical test of the frame because
it requires no IRB, no clinical partner, and no paid engagement — only public
revision history.

---

## 9. Next steps

1. Confirm the three target corpora and their revision ranges.
2. Add the three record types to `packages/evidence-graph` (types only, no
   domain logic).
3. Implement aggregation in `packages/analyzers` as deterministic functions
   over existing events.
4. Add a CLI surface (`refract drift` or a flag on `export`) emitting NDJSON.
5. Write the report template and run on corpus 1 (Wikipedia policy pages).
6. Publish the report; use it as the empirical anchor for grant pitches
   covering the clinical studies (#1, #3, #8, #13, #15).

*This spec is a design document, not an implementation. It defines the
milestone; implementation follows in separate PRs.*
