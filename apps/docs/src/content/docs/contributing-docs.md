---
title: "Contributing to Refract documentation"
description: "Documentation changes are contributions. This page covers conventions, structure, and process for improving Refract docs."
---

Documentation changes are contributions. This page covers conventions, structure,
and process for improving Refract docs.

## What to contribute

| Contribution | Example |
|-------------|---------|
| Fix a typo or stale reference | Package names, env vars, URLs |
| Improve a tutorial | Add a real walkthrough with actual output |
| Add a diagram | SVG diagrams in `public/` |
| Add a new page | New use case, integration guide, or reference |
| Improve the site | Starlight configuration, theme CSS, link handling |

## Canonical guides

The review and history-range pages are the repository root's `docs/review.md`
and `docs/usage.md`, rendered by `src/pages/[guide].astro`; `CORE_GUIDES` in
`site.mjs` lists them. Edit those files to change command behavior or coverage
requirements. The demo illustration is served from `docs/examples/onboarding.svg`;
regenerate it with the core capture script.

## Repository structure

```
apps/docs/                  # in the refract repository
├── src/content/docs/       # Markdown source (one .md per page)
│   ├── tutorials/          # Tutorial pages
│   └── ...
├── src/pages/              # Core guide route, social card, sitemap.xml
├── src/styles/custom.css   # Theme colors and home page cards
├── src/route-data.ts       # JSON-LD and other head tags
├── public/                 # Diagrams, screenshots, icons (served as-is)
├── astro.config.mjs        # Starlight configuration and sidebar
├── links.mjs               # Rewrites .md links to page URLs at build time
├── site.mjs                # Site URL, name, description, core guides
├── dist/                   # Built output (gitignored)
└── package.json
```

## Page conventions

### File naming
- Lowercase, hyphenated: `frontier-use-cases.md`, `bundle-manifest.md`
- Tutorials go in `src/content/docs/tutorials/`

### Front matter
Each page starts with a `title`, which Starlight prints as the page heading, and
a `description` for search results and link previews. Take the description from
the page's first paragraph; `tests/seo.test.ts` fails when it does not appear in
the page. The page slug is the filename minus `.md`.

```markdown
---
title: "Analytics with DuckDB"
description: "Refract's event output is newline-delimited JSON (NDJSON)…"
---
```

### Tone
- Technical, neutral, precise. No marketing language.
- One idea per paragraph. One sentence per idea when possible.
- Use `Refract` (capital R) as the project name.
- Reference packages as `@refract-org/<name>`.
- Reference the CLI as `refract` (`wikihistory` is mentioned once as an alias).

### Code blocks
Use fenced code blocks with language tags:

```markdown
\`\`\`bash
refract analyze "Earth" --depth detailed
\`\`\`

\`\`\`python
import pandas as pd
\`\`\`
```

### Links
Use relative links to other docs pages:

```markdown
[Concepts](../concepts.md)
[CLI reference](../cli.md)
```

Link to a core guide through its file in the repository's `docs/`, such as
`../../../../../docs/review.md`; the build turns it into the guide's page URL.
External links use full URLs.

### Diagrams
SVG diagrams go in `public/`. Reference them by file name, from any page depth:

```markdown
![Architecture data flow](architecture-flow.svg)
```

The build resolves the name to the file's address under `public/`.

## Adding a new page

1. Create `src/content/docs/<slug>.md` with a `title` and `description`
2. Add the page to a group's `items` in the `sidebar` of `astro.config.mjs`:
   ```js
   page("Your New Page", "your-new-page"),
   ```
3. Run `bun run test` to build the site and check links, titles and descriptions
4. Open a PR

## Diagram style

All diagrams use consistent styling:
- **Font**: System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- **Colors**: Tailwind gray scale for text (`#111827` for headings, `#4b5563` for body)
- **Layer colors**: Blue for deterministic (`#2563eb`, `#1d4ed8`), green for ground truth (`#059669`, `#047857`), purple for downstream/model (`#7c3aed`, `#6d28d9`)
- **Card style**: White background, rounded corners (rx="8"), subtle shadow via `<filter>`
- **Dimensions**: Match existing diagram widths (720px or 760px for wider diagrams)

## Tutorial checklist

A good tutorial:
- [ ] Has a clear goal statement
- [ ] Shows commands the user can copy-paste and run
- [ ] Shows expected output for each step
- [ ] Explains how to interpret what the user sees
- [ ] Includes troubleshooting for common problems
- [ ] Links to next steps

## Build and preview

```bash
bun run dev          # Serve at http://localhost:4321/refract/ with live reload
bun run build        # Build the static site to dist/
bun run preview      # Serve dist/ as GitHub Pages will
```

## Review process

- PRs to `main` run lint, tests and the build (see `.github/workflows/docs-site.yml`)
- Merged PRs deploy to GitHub Pages automatically (see `.github/workflows/docs-deploy.yml`)
- Documentation PRs follow the same [code of conduct](https://github.com/refract-org/refract/blob/main/.github/CODE_OF_CONDUCT.md) as code PRs
