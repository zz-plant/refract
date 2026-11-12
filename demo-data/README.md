# Refract Demo Data

Hand-written demo datasets for [Refract](https://github.com/refract-org/refract), the deterministic observation engine.

## What's here

| Directory | Source | Shows |
|---|---|---|
| `fandom/` | Topics from Fandom wikis (Star Wars, Marvel, Minecraft) | Canon disputes, retcons, version-driven changes |
| `historical-wikipedia/` | Topics from Wikipedia technology and policy pages | Citation churn, neutrality disputes, event-driven editing |
| `synthetic-healthcare-like/` | Entirely fictional medical-style pages | Claim lifecycle, citation replacement, dispute resolution — with no real patient or drug data |

## Rules

- **No real healthcare data.** The synthetic-healthcare-like directory uses made-up drug names (Xanoleptin), exaggerated language, and fictional trials so no one mistakes it for real medical information.
- **No living-person pages** as primary demos. All Fandom/Wikipedia content is from fictional universes or historical/technology topics.
- **All content** is written for this directory about public wiki topics or fictional ones. Nothing proprietary.

## What the files are

Each `.jsonl` file holds `EvidenceEvent` objects, one per line, with the fields `refract export --format ndjson` writes. Most also carry a `claimId`, which CLI exports do not. The events illustrate the signals named above. They are not captured engine output: revision IDs are placeholders and do not identify revisions on the named wikis.

Most files open with one or two `#` comment lines that name the page.

## Using them

- **Viewer**: drop a file onto the upload zone in [apps/ui](../apps/ui/README.md). Every event loads. Each `#` line is reported as `Invalid JSON` under the upload zone and skipped.
- **`refract_eval`** (in `clients/python`): `build_leakage_benchmark`, `check_provenance` and `score_retrieval_quality` take a file path and skip `#` lines.
- **Other JSON Lines readers**, such as `pandas.read_json(..., lines=True)`: remove the `#` lines first, for example with `grep -v '^#' file.jsonl`.

`refract eval` does not read these files. Its `--ground-truth` option takes a JSON array of labels and fetches the labeled pages itself.

---

Built and maintained by [NextConsensus](https://nextconsensus.com).
