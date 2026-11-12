---
title: "Concepts"
description: "Refract is a deterministic observation engine for revision histories. It ingests them from MediaWiki instances and produces an event stream showing how…"
---

Refract is a deterministic observation engine for revision histories. It ingests them
from MediaWiki instances and produces an event stream showing how claims
enter, change, stabilize, and exit the public record — where they came from, what supported
them, what challenged them, and when context altered their meaning.

Every run against the same revision range produces identical output: byte-for-byte reproducible.

## How determinism works

Refract never calls an LLM, never samples randomly, and never depends on external state. Given revision text from a MediaWiki API, each analyzer applies a pure function: `(wikitext) → events`. The same wikitext always produces the same events. This holds across machines, OS versions, and time.

Deterministic identity (`eventId`) extends this guarantee: events with identical content produce identical hashes, so deduplication and cross-reference are reliable even when the same observation is run independently.

## Architecture

![Concept overview](concept-overview.svg)

The diagram shows how Refract ingests revision histories from MediaWiki APIs, runs deterministic analyzers, and produces a structured event stream with provenance tags.

## Pipeline stages

```
Wikipedia API → Fetch → Analyze → Report → (optional) Validate
```

| Stage | What it does | Reproducible? |
|-------|-------------|---------------|
| **Fetch** | Retrieves revisions from the MediaWiki API, handles rate limits, pagination | Yes — same API + same page → same revisions |
| **Analyze** | Runs deterministic analyzers — section diffs, citation tracking, revert detection, template classification, category/wikilink extraction | Yes — pure functions, no external state |
| **Report** | Assembles structured events with revision, section, and timestamp provenance | Yes — deterministic ID via SHA-256 content hash |
| **Validate** | Optional: compares pipeline output against ground truth labels (eval package) | Yes — deterministic comparison |

![ObservationReport structure](observation-report.svg)

![Architecture data flow](architecture-flow.svg)

![BYO-inference boundaries](byo-inference-bounds.svg)

## Depth levels

The `--depth` flag controls how much text each event carries. Every level runs the same analyzers and emits the same event types:

- **`brief`** — `before` and `after` are left empty, and without a range only the latest 20 revisions are read.
- **`detailed`** (default) — events carry the changed text.
- **`forensic`** — as `detailed`, plus both revisions' full wikitext on every event. Output is large; give it a revision range.

See [depth reference](depth.md).

## Output model

The pipeline produces timed `EvidenceEvent` objects with 26 event types, all mechanical:

- **Sentence events**: `sentence_first_seen`, `sentence_removed`, `sentence_modified`, `sentence_reintroduced`
- **Citation events**: `citation_added`, `citation_removed`, `citation_replaced`
- **Section events**: `section_reorganized`
- **Template events**: `template_added`, `template_removed`, `template_parameter_changed`
- **Revert events**: `revert_detected`
- **Cluster/activity events**: `edit_cluster_detected`, `talk_activity_spike`
- **Page events**: `lead_promotion`, `lead_demotion`, `page_moved`
- **Link/category events**: `wikilink_added`, `wikilink_removed`, `category_added`, `category_removed`
- **Protection events**: `protection_changed`
- **Talk page events**: `talk_page_correlated`, `talk_thread_opened`, `talk_thread_archived`, `talk_reply_added`

`refract analyze` and `refract export` take the talk events from the ten talk-page edits that precede the last analyzed revision, so a long range sees only the most recent discussion.

The event schema includes a `modelInterpretation` field and `model_interpretation` evidence layer — these are never set by Refract's deterministic engine. They exist for downstream consumers to attach semantic analysis without modifying the event stream.

Analyzers accept configurable parameters (similarity thresholds, time windows, revert patterns) via `AnalyzerConfig`, passed from the CLI or SDK. This allows users to tune detection sensitivity without modifying analyzer code.

The pipeline can also produce an `ObservationReport` — a structured aggregate that groups events by claim with a `ClaimLedger` tracking each claim's lifecycle across revisions.

See [schema.md](schema.md) for the full reference.

![Evidence labels diagram](evidence-labels.svg)

## Configurable heuristics / BYO-inference boundaries

Every analyzer threshold encodes an interpretive judgment — what counts as a revert, how close edits must be to form a cluster, what sentence similarity means "modified" vs "removed and added." These thresholds accept optional overrides via `AnalyzerConfig`. The `FactProvenance` type has a `parameters` field for recording them; facts on events from `refract analyze` and `refract export` carry `fact` and `detail` only.

Each threshold is a **BYO-inference boundary** — a typed function signature where a model can replace the default heuristic:

| Boundary | Default (mechanical) | Pluggable (model) |
|----------|----------------------|--------------------|
| Sentence similarity | Word-overlap ratio (0.8) | "Are these two sentences the same claim?" |
| Revert detection | 6 regex patterns | "Is this edit comment a revert?" |
| Template classification | Name-to-type lookup | "What policy signal does this template represent?" |
| Edit cluster detection | Time window + min size | "Are these edits semantically related?" |
| Heuristic classification | Size thresholds + comment patterns | "What kind of edit is this?" |

The defaults work offline with no configuration required. Consumers supply a model at any boundary through the library, and can record the path taken — `similaritySource: "model"` or `"default"` — in `FactProvenance.parameters`.

This is the architectural spine: Refract stays purely mechanical, but the boundaries where judgment enters are explicit, typed, and versioned. Foundation model improvements automatically benefit consumers without Refract changing.

## Two-knowledge split

Refract separates mechanical observation from ground truth verification:

1. **Deterministic layer** — what changed, byte-for-byte reproducible. All analyzers, all events. No model involved.
2. **Ground truth layer** — independently verified outcome labels (talk page consensus, RFC closures, ArbCom decisions) stored in `@refract-org/eval`. Used for validation, never redefined by pipeline output.

Model-assisted interpretation happens downstream — in NextConsensus, in consumer applications, or anywhere else that builds on Refract's event stream. The diagram above shows this boundary: everything inside the dashed box is Refract. Everything labeled "Downstream" is external.

## What Refract does not do

- No model calls in the deterministic pipeline — all analyzers are byte-reproducible without LLMs
- No truth claims — Refract reports what changed, not whether the change is accurate
- No prediction, sentiment analysis, or editor scoring
- No claims about compliance, policy violations, or decision relevance

Model-assisted classification is available at explicit BYO-inference boundaries (via `refract classify` or boundary config). When a model is used, the event records it — the deterministic pipeline itself never calls one.

## Independent ground truth

The eval package stores outcome labels independently from pipeline output. These labels are collected from talk page discussions, RFC closures, and arbitration decisions — human consensus about what happened. The evaluation harness compares pipeline events against these labels to measure analyzer accuracy without feedback loops.

## References

Refract builds on research in peer production, computational social science, and knowledge evolution. The following work informs its architecture and assumptions:

### Wikipedia and peer production

- **Viégas, Wattenberg, & McKeon (2007)** — *The Hidden Order of Wikipedia*. Visualizing the edit history of Wikipedia articles reveals patterns of cooperation and conflict.
- **Halfaker, Geiger, Morgan, & Riedl (2013)** — *The Rise and Decline of an Open Collaboration System: How Wikipedia's reaction to popularity is causing its decline*. American Behavioral Scientist. Documents the systemic pressures that shape Wikipedia's editorial dynamics.
- **Kittur & Kraut (2008)** — *Harnessing the Wisdom of Crowds in Wikipedia: Quality through Coordination*. Proceedings of CSCW. Shows that coordination structures, not just contributor count, determine article quality.
- **Keegan, Gergle, & Contractor (2013)** — *Hot Off the Wiki: Structures and Dynamics of Wikipedia's Coverage of Breaking News Events*. American Behavioral Scientist. Analyzes how Wikipedia responds to real-world events — the pattern Refract's edit cluster detector captures.
- **Müller-Birn, Dobusch, & Herbsleb (2013)** — *Work-to-rule: The emergence of algorithmic regulation in Wikipedia*. Proceedings of OpenSym. How policy templates and automated tools enforce editorial norms.

### Content dynamics and claim evolution

- **Adler, de Alfaro, Pye, & Raman (2008)** — *Measuring Author Contributions to the Wikipedia*. WikiWho system for sentence-level authorship attribution. Refract differs by tracking sentence *lifecycle* rather than who wrote it.
- **Ferschke, Gurevych, & Rittberger (2013)** — *The Impact of Topic Bias on Quality Flaw Prediction in Wikipedia*. Proceedings of ACL. Analyzes how cleanup templates correlate with content quality and how topic bias affects quality assessment.

### Provenance and evidence infrastructure

- **Buneman, Khanna, & Tan (2001)** — *Why and Where: A Characterization of Data Provenance*. ICDT. Foundational work on data provenance that motivates Refract's `FactProvenance` and `inputHashes` design.
- **Carroll, Bizer, Hayes, & Stickler (2005)** — *Named Graphs, Provenance and Trust*. WWW. Semantic web provenance patterns that influenced Refract's `EvidenceLayer` taxonomy (`observed`, `policy_coded`, `model_interpretation`).
- **Merkle (1980)** — *Protocols for Public Key Cryptosystems*. IEEE S&P. Merkle tree construction used in Refract's replay manifests for observation integrity verification.
- **Moreau et al. (2011)** — *The Open Provenance Model core specification (v1.1)*. Future Generation Computer Systems. Provenance modeling patterns that informed `FactProvenance` design (analyzer, version, inputHashes).

### Decision intelligence (relevant to downstream consumers)

- **Kahneman & Tversky (1979)** — *Prospect Theory: An Analysis of Decision under Risk*. Econometrica. Foundational work on how humans make judgments under uncertainty — the cognitive context Refract's deterministic event stream is designed to anchor.
- **Tetlock & Gardner (2015)** — *Superforecasting: The Art and Science of Prediction*. Calibration and debiasing techniques that downstream consumers can apply to model interpretation built on top of Refract's event stream.
- **Sackett et al. (1996)** — *Evidence Based Medicine: What it is and what it isn't*. BMJ. Defines the evidence hierarchy that healthcare downstream consumers (e.g., NextConsensus) use to weight source types.
- **Guyatt et al. (2008)** — *GRADE: an emerging consensus on rating quality of evidence and strength of recommendations*. BMJ. The GRADE framework for evidence quality assessment — a model for how downstream consumers might score source reliability.
