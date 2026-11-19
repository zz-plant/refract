# Misuse Policy

This tool is designed to help researchers, journalists, and analysts understand how claims move through Wikipedia's editorial system. It must not be used for:

## Prohibited Uses

1. **Editor targeting** — Do not use this tool to identify, track across unrelated sessions, dox, harass, or retaliate against individual Wikipedia editors. While the tool may emit run-scoped pseudonymous actor labels (e.g., `Actor_1`, `Actor_2` or salted session hashes) and aggregate cohort cardinality counts to measure revert loops or single-account edit bursts within an analysis window, it strips raw usernames and must never be used for personal surveillance or doxxing.

2. **Truth adjudication** — Do not present this tool's output as a determination that a Wikipedia claim is "true" or "false." The tool shows what changed, what held, what structural category a cited source belongs to (e.g., academic DOI, intergovernmental/UN, NGO, news), and what sources supported each state. It does not evaluate factual accuracy.

3. **Prediction** — Do not use this tool to predict future edits, editor behavior, institutional outcomes, or events. All observations are historical records, not forecasts.

4. **Automated editing** — Do not use this tool to automate Wikipedia edits, reverts, or templating. It is a read-only analysis instrument.

5. **Deceptive use** — Do not use this tool to generate synthetic evidence, fabricate edit histories, or create false citation trails.

6. **Causal attribution claims** — Do not use this tool to claim that a specific edit, editor, or editorial decision algorithmically "caused" a real-world outcome, or that an external event algorithmically "caused" an edit. Overlaying user-supplied external timeline markers (such as report publications, policy announcements, or arbitration dates) against revision timelines for temporal context is supported, provided correlation is distinguished from causation.

## Authorized Uses

- Academic research on Wikipedia editorial dynamics and cross-language knowledge propagation
- Data journalism and forensic audits on how controversial claims evolve in public knowledge systems
- Counter-disinformation research auditing claims of coordinated editing, citation stripping, or source replacement
- Media literacy and information provenance education
- Tool-assisted editorial review (identifying unsourced claims, BLP violations, citation gaps, and source-type shifts)
- Historical analysis of how scientific or political claims stabilized in public discourse, including temporal juxtaposition with external events

## Reporting Misuse

If you observe misuse of this tool, report it to the repository maintainers via GitHub Issues. Misuse reports are reviewed within 7 days.
