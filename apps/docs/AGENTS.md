# Agent instructions for refract-docs

Refract-docs is the public documentation site for the Refract project — an open-source deterministic observation engine for public revision histories. Its source is `apps/docs` in the Refract monorepo.

## Quick Start

```bash
bun install          # at the repository root; installs every workspace
bun run dev          # http://localhost:4321/refract/ with live reload
bun run build        # Astro + Starlight build to dist/
bun run lint         # Biome check
bun run test         # Builds once, then Vitest checks the built site
```

## Tooling

- **Package manager:** Bun, through the repository root's workspace and lockfile
- **Site:** Astro with Starlight; Markdown through Astro's Sätteri processor, with `links.mjs` as an mdast plugin
- **Search:** Pagefind, built by Starlight into `dist/pagefind/`
- **Linter/Formatter:** Biome
- **Tests:** Vitest
- **Pre-commit:** the repository root's Husky hook runs lint-staged, which uses this directory's `.lintstagedrc.json`
- **CI:** `.github/workflows/docs-site.yml` at the repository root; `docs-deploy.yml` publishes `main` to https://refract-org.github.io/refract/
- **Commit style:** Conventional Commits

## Verification

```bash
bun run lint     # Biome check
bun run test     # Build, then links, titles, descriptions, JSON-LD and sitemap
bun run build    # Production build
```

`tests/seo.test.ts` requires each page's `description` to quote the page's
own text. `tests/links.test.ts` checks every source link and every link in the
built pages, anchors included.

## Repository structure

```
astro.config.mjs              # Starlight config: sidebar, head tags, theme CSS
site.mjs                      # Site URL, name, description, core guides and assets
links.mjs                     # .md links → page URLs; core guide titles from their H1
social-card.mjs               # Renders the Open Graph card PNG
src/content/docs/             # One Markdown page per URL (title + description frontmatter)
  index.md                    # Home page (splash template, hero actions)
  tutorials/                  # Tutorials
src/content.config.ts         # docs collection, plus the core guides from ../../docs
src/pages/[guide].astro       # /review/ and /usage/, from docs/review.md and docs/usage.md
src/pages/*.ts                # social-card.png, core-onboarding.svg, sitemap.xml
src/route-data.ts             # JSON-LD, og:type, escaped titles
src/styles/custom.css         # Theme tokens and home page cards
public/                       # Diagrams, screenshots, icons, notebook (served as-is)
tests/                        # Vitest; tests/build.ts builds the site once first
```

## Documentation principles

- **Tagline**: "Refract answers: 'What changed?'"
- **Boundary statement**: "Refract does not decide what is true. Refract makes visible how public knowledge changes."
- **Open source framing**: "What changed?" for what Refract does. "Not included: Domain-specific decision judgment." for what Refract excludes.
- **Tone**: technical, neutral, precise. No marketing language.
- **CLI examples**: always use `refract` as the command name (`wikihistory` works as a backward-compat alias).

## Copy conventions

- Use `Refract` (capital R) as the project name. Always use `Refract`, never `Varia`.
- Reference packages as `@refract-org/<name>`.
- Reference the CLI as `refract` (`wikihistory` works as a backward-compat alias).
- Use `refract` as the command name in all code examples.
- Lead with "git log for Wikipedia". "Deterministic observation engine" is the technical description, for pages about how it works.
- L1/L2/L3 references are legacy — prefer "deterministic" / "observation layer".

## Adding a page

Create `src/content/docs/<slug>.md` with `title` and `description` frontmatter,
then add it to the `sidebar` in `astro.config.mjs`. Link other pages by their
`.md` file and core guides by their file in the repository's `docs/`.
