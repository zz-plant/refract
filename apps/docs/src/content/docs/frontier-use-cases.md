---
title: "Frontier Use Cases for Claim-Provenance Infrastructure"
description: "It does not report what a document says now. It explains how a claim entered, changed, was sourced, challenged, moved, stabilized, weakened, or…"
---

## Core Primitive

Refract turns version history into:

**claim + source + wording + placement + stability + time**

It does not report what a document says now. It explains how a claim entered, changed, was sourced, challenged, moved, stabilized, weakened, or disappeared.

---

## Retrieval & Search

### AI Retrieval Provenance

AI systems retrieve text as if every sentence is equally stable. They lack signals about what has been contested, recently changed, or stabilized through editorial scrutiny.

Refract exposes per-claim metadata:

```json
{
  "claim": "Entity X knew about the defect before launch",
  "status": "included_with_attribution",
  "first_seen": "2021-04-03",
  "stability": "stable_after_regulatory_source_added",
  "contestation": "previously_reverted_twice",
  "placement": "body_not_lead",
  "source_support": "regulatory_report_and_secondary_news"
}
```

This helps retrieval systems decide whether to present a claim directly, hedge it, attribute it, surface uncertainty, or deprioritize it.

### Claim-Level Search

Search across claim histories, not documents.

Example queries Refract can support:

- Claims about an entity that stabilized after a given date
- Claims removed as unsourced
- Claims supported by a specific source type
- Claims that moved from lead to body
- Claims that softened after external events

This is a new search primitive over version-history data.

### AI Evaluation & Temporal Leakage Detection

Use claim histories to test AI systems for temporal leakage.

Questions answerable with Refract data:

- Was this claim public before the model's knowledge cutoff?
- Did the supporting source appear later?
- Did the wording exist at the time?
- Is the model using future knowledge?

Refract provides temporal ground truth for benchmarking retrieval truthfulness, training-data audits, and knowledge-cutoff testing.

---

## Claim History & Memory

### Public Claim Memory

Create a temporal knowledge graph for claims.

Not: What does the article say now?
But: What has this claim said over time?

Refract tracks across revisions:

- Origin (first appearance)
- Source support evolution
- Wording changes
- Removals and restorations
- Disputes and challenges
- Current status

### Knowable-at-the-Time Reconstruction

Reconstruct what was publicly knowable at a specific date.

Example: As of March 1, 2023, what sources supported a given claim?

Refract's revision-level timestamping and deterministic extraction make this auditable, with no hindsight leakage.

### Institutionalization of Knowledge

Detect when a claim moves from rumor into durable public reference.

Pattern Refract can surface:

rumor → local reporting → national reporting → institutional source → article body → article lead → stable public reference

Core question: When did this stop being chatter and become part of the durable public record?

### Claim Survivorship

Measure which claims survive scrutiny.

Refract can classify claims by survival pattern:

- Failed claim (removed and never restored)
- Temporary claim (appeared briefly)
- Stable claim (survives extended period unchanged)
- Stable only with attribution
- Stable only in body, not lead
- Repeatedly contested
- Removed under policy concern

---

## Source & Evidence Integrity

### Source Escalation & Degradation

Track how source support changes across revisions.

Escalation patterns Refract detects:

unsourced → local source → national source → regulatory source → court ruling → academic analysis

Degradation patterns:

secondary source removed → primary source remains → citation-needed tag → claim removed

### Article Voice & Attribution

Distinguish who is making a claim — not just what the claim says.

States Refract detects:

- Direct assertion in article voice
- Attributed to a named source
- Attributed to critics or regulators
- Reported allegation
- Disputed claim
- Removed claim

Example: "The company concealed the defect" versus "Regulators alleged that the company failed to disclose the defect" should not be treated as equivalent.

### Semantic Intensity Drift

Detect language getting stronger, weaker, broader, or narrower.

Example shifts Refract can surface:

- caused → contributed to
- concealed → failed to disclose
- proved → alleged
- will → may
- riot → protest → unrest

### Misinformation & Circular Sourcing

Track weak, false, or fringe claims as they move through public systems.

Patterns Refract detects:

- Claim introduced without source
- Reverted as unsourced
- Reintroduced with weak source
- Challenged and removed
- Returns in softened form

Citogenesis detection: a claim originates on Wikipedia, gets cited by an external source, and Wikipedia later cites that source to verify the original claim — creating a self-referential loop.

### Source Dependency Mapping

Map which claims depend on which sources.

If a source is corrected, discredited, or retracted, Refract can identify all affected claims across the knowledge base, enabling cascade analysis.

---

## Editorial Mechanics

### Editorial Consensus Mapping

Show how a page or claim reaches a stable form.

Signals Refract surfaces:

- Talk-page discussion activity
- Revert cycles
- Policy references (BLP, NPOV, RS, UNDUE)
- Source replacement patterns
- Compromise wording emergence
- Page protection events
- Post-discussion stabilization

### Prominence & Placement

Track not just whether a claim exists, but where it appears.

States Refract detects: lead, infobox, body, controversy section, footnote, caption, table, category, talk page only, removed.

Meaningful transitions: body → lead (increased prominence), lead → body (reduced prominence), removed → restored (narrative resurrection).

### Cross-Language Narrative Divergence

Compare the same claim across language editions.

Refract can surface differences in: wording, sources cited, prominence, stability timelines, and terminology across language versions of the same topic.

---

## Change Monitoring

### Public Reference Monitoring

Monitor how an entity or topic changes in public reference sources.

What Refract surfaces:

- New claims added
- Claims moving into prominent positions
- Regulatory or institutional sources added or removed
- Policy templates applied (BLP, NPOV)
- Revert chains triggered
- Page protections activated
- Cross-language spread detected

### Knowledge Volatility Metrics

Create quantitative metrics from claim-history data:

- Claim volatility over time
- Source churn rate
- Lead section instability
- Controversy intensity
- Cross-language divergence rate
- Edit-burst frequency

### Change Summaries

Generate structured summaries from claim-history analysis.

Refract can produce outputs like:

Three public claims changed materially this period.
1.  One stabilized after regulatory sourcing.
2.  One moved from body to lead.
3.  One remains disputed after repeated reverts.

Each statement links to the supporting evidence.

---

## Domain Extensions

### Policy, Regulation & Standards Tracking

Apply the same engine to public rules and guidance documents.

Changes Refract can detect: requirements added or weakened, mandatory → optional transitions, deadline extensions, scope narrowing, enforcement language removed.

### Enterprise Knowledge Governance

Apply claim provenance to internal knowledge bases.

Detect across internal documentation: unsupported claims, stale procedures, contradictions between docs, obsolete product claims, policy drift, claims without sources.

### Corporate Disclosure Tracking

Track changes in publicly filed corporate documents.

Refract can surface when commitments, risk factors, deadlines, or claims change in investor presentations, earnings materials, ESG reports, terms of service, or privacy policies.

### Legal-Document History

Apply the same engine to contracts, policies, and versioned legal documents.

Detect: obligations added or narrowed, warranties softened, termination rights expanded, indemnity strengthened, compliance requirements removed.

Example shifts: shall → may, all damages → direct damages, must notify within 24 hours → must notify without undue delay.

### Policy and Legislative Text Reuse

Track copied boilerplate and model legislation across jurisdictions.

`detectTextPropagation(source, target)` compares two texts you supply: the Jaccard similarity of their 5-token shingles, the verbatim spans of 8 or more tokens they share, and a flag when similarity reaches 0.15 or the shared spans total 16 tokens. It does not find candidate sources or say which text came first.
- Find clauses copied verbatim from one jurisdiction's text into another's.
- Measure how much of a bill's text it shares with a model bill.

### Citation Concentration

`analyzeCitationNetwork(citations)` counts a page's citations per domain and per source and computes a Herfindahl-Hirschman index over the domain shares, flagging concentration above 0.4 when there are at least three citations.
- Flag pages where most citations come from one domain.
- Run it on each revision's citations to see when a page's sourcing narrowed.

### Verification Bundles

`refract export --proof` writes a replay manifest, its events and a Merkle inclusion proof per event hash to one JSON file. `refract verify` rehashes each event against the manifest and checks the manifest hash, the Merkle root and each proof, and `--html` writes the result as an HTML file.
- Publish a Merkle root; anyone who runs the same Refract version over the same revision range gets the same root.
- Nothing in a bundle is signed: a pass shows the events match the manifest, not who made the bundle, and fields outside the event hash are not covered. See [what it checks](bundle-manifest.md#checking-a-bundle).

---

## Universal Document-History

### General Document-History Operating System

The broadest application. For any versioned document system, Refract answers:

- What changed?
- What claim or obligation did it affect?
- What source or evidence supported it?
- Was it challenged?
- Did it stabilize?
- What is its current status?

This applies across: public wikis, policy drafts, standards documents, open-source documentation, collaborative prose, and any versioned text corpus.

---

## Synthesis

The reusable primitive is:

**claim + source + wording + placement + stability + time**

That primitive can power use cases across retrieval, research, monitoring, governance, and knowledge management — without deciding what is true.
