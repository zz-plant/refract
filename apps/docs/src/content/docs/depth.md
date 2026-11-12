---
title: "Analysis depth levels"
description: "The --depth flag controls how much text each event carries and, for brief, how many revisions are read. All three levels run the same analyzers and emit the…"
---

The `--depth` flag controls how much text each event carries and, for `brief`, how many revisions are read. All three levels run the same analyzers and emit the same event types. It applies to `analyze`, `diff`, and `explore`.

| Level | Event content | Revisions read without `--from`, `--to` or `--since` |
|-------|---------------|------------------------------------------------------|
| `brief` | `before` and `after` are empty on almost every event | The latest 20 (`--brief-limit` changes the number) |
| `detailed` | `before` and `after` carry the changed text | The whole history |
| `forensic` | As `detailed`, plus both revisions' full wikitext on every event | The whole history |

`brief` answers whether anything changed, and of what kind. Event types, sections, revision IDs and timestamps are present; the changed text is not. `template_parameter_changed` events keep their text.

`detailed` is the default. An unrecognized `--depth` value also runs as `detailed`.

`forensic` adds two facts to every event, `full_wikitext_before` and `full_wikitext_after`, each holding a whole revision. Output grows with page size times event count: 19 revisions of "Pluto" produce about 1 MB at `detailed` and 63 MB at `forensic`. Give it a revision range.

`export`, `cron`, `visualize` and `eval` have no `--depth` flag and run at `detailed`.

Depth does not add or remove analyzers. Citation, template, revert, wikilink, category, sentence and talk-correlation events appear at every level.

Example:

```bash
refract analyze "Pluto" --from 71593043 --to 71597389 --depth forensic --json
```
