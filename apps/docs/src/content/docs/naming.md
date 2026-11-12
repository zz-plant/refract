---
title: "Naming conventions"
description: "The CLI is named after the action it performs, not the project it belongs to. When you type refract analyze \"Bitcoin\", the meaning is self-evident: analyze…"
---

## The split explained

| Name | What it is | Why |
|---|---|---|
| **Refract** | The project | Sequence of observed changes |
| **refract-org** | GitHub organization | npm scope matching; chosen for consistency with the project name |
| **`@refract-org/*`** | npm package scope | All lowercase by npm convention |
| **`refract`** / **`wikihistory`** | CLI commands | `refract` is the primary name; `wikihistory` works as an alias |

## Why `refract` and also `wikihistory`?

The CLI is named after the action it performs, not the project it belongs to. When you type `refract analyze "Bitcoin"`, the meaning is self-evident: analyze the revision history of Bitcoin. `wikihistory` works as an alias with the same self-evident logic.

## In code

- Use `Refract` (capital R) as the project name in prose
- Use `@refract-org/<name>` when referencing packages
- Use `refract` as the primary CLI command name; `wikihistory` is an alias
