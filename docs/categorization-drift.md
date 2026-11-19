# Categorization Drift Detection in Public Deliberation Systems

**Status:** Draft spec — milestone M-CD-1 (idea #12)
**Scope:** Domain-neutral. Observes public MediaWiki and other revision histories.
**Pairs with:** `docs/constitutional-drift.md` (milestone M-CDME-1, ideas #14 + #5).
**Owner surface:** `refract` (observation engine) + downstream applications for interpretation.

---

## 1. Why this milestone

Institutions routinely absorb structural critiques by reclassifying them.
A complaint that a governing assumption is wrong becomes a ticket about a
missed notification; a challenge to a policy's premise becomes a discussion
about an editor's tone; a request to reconsider a rule becomes a "won't fix"
because the reporter used the wrong form. The critique does not disappear —
it is **downgraded in category**, which moves it out of the path that could
change the rule.

This is *categorization drift*: the systematic reclassification of
structural objections into operational, interpersonal, or procedural tickets.
It is invisible in aggregate metrics (the ticket was closed, the SLA was
met) and visible only by reading the original wording against the final
classification.

This milestone defines an observation layer that detects categorization
drift in **public** deliberation systems — Wikipedia administrative
noticeboards, deletion discussions, and (where available) public issue
trackers exposed via MediaWiki or open APIs. No NDAs, no IRBs, no private
data.

It is the most immediately legible demo of the Possibility / Authority /
Necessity frame: showing a structural critique being quietly reclassified
into a ticket is visceral to engineers and funders in a way that a pure
schema is not.

---

## 2. What Refract already provides

| Primitive | Relevance |
|-----------|-----------|
| Revision history replay | Full ordered stream of any noticeboard or discussion page |
| Sentence-level events | Tracks how the wording of an objection changes (or doesn't) as it is reclassified |
| Revert detection | Identifies when an objection's framing is rolled back |
| Talk-page references | Links between article edits and discussion |
| Template events | Captures classification templates (e.g., `{{closed}}`, `{{not done}}`, `{{wontfix}}`) applied to discussions |
| Category events | Captures page-level categorization changes |
| Semantic enrichment (v0.5.0+) | Direction signal, certainty profile, content change type |
| Claim-state timelines | Anchors an objection's trajectory to revisions |

Categorization drift detection is **classification rules on top of these
primitives**, not new ingestion.

---

## 3. The core observation: objection trajectories

An **objection** is a passage (or thread) on a deliberation page that
asserts a structural problem with a governing assumption, rule, or system.
Examples: "this policy contradicts itself", "the bot is enforcing a
non-existent rule", "this deletion rationale cites a guideline that was
superseded".

An objection has a **trajectory** — the sequence of states it passes through:

1. **Filed** — first appears as a structural critique.
2. **Acknowledged** — someone with standing responds to the substance.
3. **Reclassified** — the thread's category, template, or heading changes
   (e.g., from "policy discussion" to "user conduct", or from "bug" to
   "by design").
4. **Resolved / absorbed / closed** — terminal state.

**Categorization drift** is detected when an objection's terminal state is a
reclassification (step 3) rather than a substantive response (step 2), OR
when the reclassification occurs without a corresponding change in the
underlying system.

---

## 4. Observations to derive

### 4.1 Objection lifecycle signals

| Signal | Definition | Source primitive |
|--------|------------|------------------|
| `objection_first_seen` | First revision where a passage matching structural-critique patterns appears | sentence events |
| `objection_survival_revisions` | Number of revisions the objection persists before terminal state | sentence events |
| `reclassification_event` | A template, heading, or category change applied to the objection's thread that changes its class | template events + category events |
| `reclassification_lag` | Revisions between objection filing and reclassification | sentence + template events |
| `substantive_response` | Whether any reply addresses the substance (vs. procedure, tone, or form) | sentence events on replies |
| `terminal_state` | `resolved_substantive` / `reclassified` / `absorbed` / `abandoned` | composite |
| `drift_flag` | `true` when terminal state is `reclassified` or `absorbed` without a substantive response | composite |

### 4.2 Structural-critique detection (heuristic, v1)

v1 uses deterministic, auditable heuristics rather than model calls:

- **Structural markers**: phrases asserting a problem with a rule, policy,
  system, or assumption ("contradicts", "outdated", "should be changed",
  "the rule says", "this is wrong because").
- **Operational markers**: phrases redirecting to procedure, form, or
  individual conduct ("please file a bug", "wrong venue", "not a policy
  issue", "already decided").
- A passage is an **objection** if it contains structural markers and is
  filed on a deliberation page.
- A **reclassification** is detected when an operational marker appears in a
  template or heading change applied to the objection's thread.

These heuristics are deliberately conservative and documented. They will
miss objections and will false-positive on procedural redirects. The output
always includes the source revisions so a reader can verify.

### 4.3 Cross-cutting: drift concentration

| Signal | Definition |
|--------|------------|
| `drift_rate_by_venue` | Share of objections terminally reclassified, per noticeboard/page type |
| `drift_rate_by_rights_level` | Whether objections filed by lower-rights accounts are reclassified more often |
| `drift_rate_over_time` | Rolling reclassification rate, to detect concentration of rule-making power |

---

## 5. Data schema

### 5.1 `ObjectionTrace`

```json
{
  "type": "objection_trace",
  "objectionId": "string (claim identity)",
  "page": "string",
  "venue": "string (noticeboard type or page class)",
  "filedRevision": "number",
  "filedDate": "ISO-8601",
  "terminalRevision": "number | null",
  "terminalState": "resolved_substantive | reclassified | absorbed | abandoned | open",
  "reclassificationRevision": "number | null",
  "reclassificationKind": "string | null",
  "substantiveResponsePresent": "boolean",
  "driftFlag": "boolean",
  "structuralMarkers": ["string"],
  "operationalMarkers": ["string"],
  "sourceRevisions": ["number"]
}
```

### 5.2 `DriftWindow`

```json
{
  "type": "categorization_drift_window",
  "venue": "string",
  "windowStart": "ISO-8601",
  "windowEnd": "ISO-8601",
  "objectionsFiled": "number",
  "objectionsResolvedSubstantive": "number",
  "objectionsReclassified": "number",
  "driftRate": "number",
  "driftRateByRightsLevel": "object | null",
  "sourceRevisions": ["number"]
}
```

Both carry standard Refract provenance fields (hash, capture timestamp,
analyzer version).

---

## 6. Target corpus (proof of concept)

Three public corpora, chosen for contrasting governance regimes:

1. **Wikipedia administrative noticeboards**
   (`Wikipedia:Administrators' noticeboard`,
   `Wikipedia:Administrators' noticeboard/Incidents`).
   High volume, strong revert culture, clear template-based classification.
   Tests whether structural policy critiques get reclassified as conduct issues.
2. **Wikipedia deletion discussions** (AfD, RfD, MfD).
   Explicit classification (keep/delete/merge), strong precedent citation.
   Tests whether "this deletion rationale cites a superseded guideline" gets
   reclassified as a procedural objection.
3. **An open-source project's public issue tracker** exposed via a MediaWiki
   mirror or a documented public API that Refract can ingest as versioned
   text. Tests whether "this design decision is wrong" becomes "won't fix
   / by design".

For each corpus, the run produces an `ObjectionTrace` per objection and a
`DriftWindow` series, plus a short Markdown report with revision links.

**No private data, no model calls, no healthcare vocabulary.**

---

## 7. Relationship to #14 (constitutional drift)

- **#14** observes how rule-making power concentrates: protected edits,
  procedural depth, rule migration, bot share.
- **#12** observes how structural critiques are absorbed: objection
  trajectories, reclassification, drift rates.

They are **complementary halves of the same mechanism**. A rule migration
(#14) that precedes a rise in reclassification (#12) is a candidate
constitutional-drift event with visible human cost. Running both on the same
corpus lets a reader see not just that power concentrated, but that the
concentration had consequences for who could make objections land.

**Recommended execution:** run #12 and #14 together on corpus 1 (Wikipedia
policy/noticeboard pages) as a single milestone, so the report can show both
halves. Separate record types, shared corpus, shared report template.

---

## 8. What this milestone does NOT do

- It does not attribute intent to moderators. Observations are
  revision-anchored facts; "deliberate suppression" is an interpretation.
- It does not predict which objections will be reclassified.
- It does not replace human review. Outputs are inputs to review.
- It does not introduce model calls. v1 is heuristic and auditable.

---

## 9. Success criteria

1. A single documented pipeline runs the full objection + drift pass over
   one target corpus and emits `ObjectionTrace` and `DriftWindow` records
   as NDJSON.
2. Output is byte-reproducible on a second run over the same revision range.
3. A short report demonstrates at least one observable pattern of an
   objection being reclassified without a substantive response, with
   revision links a reader can verify.
4. The boundary check (`bun run check:boundaries`) passes.

---

## 10. Next steps

1. Confirm target corpora and revision ranges (start with corpus 1).
2. Add the two record types to `packages/evidence-graph` (types only).
3. Implement structural/operational marker detection and lifecycle
   classification in `packages/analyzers`.
4. Add a CLI surface emitting NDJSON.
5. Write the report template; run on corpus 1 alongside #14.
6. Publish; use as the empirical anchor for the ethotechnics #11 profile.

*This spec is a design document, not an implementation.*
EOF
echo "written"