---
title: "Installation"
description: "Run the CLI as node packages/cli/dist/src/cli.js <command>, or put it on your PATH with bun link inside packages/cli."
---

## System requirements

- **Node.js** 20+ or **Bun** v1.2+
- **macOS** or **Linux** (Windows not yet supported)
- **Bun and a source checkout** for SQLite persistence (`--cache`): it needs `@refract-org/persistence`, which uses `bun:sqlite` and is not published to npm. Analysis-only workflows work with Node.js.

## Zero install

No download needed — runs directly from npm:

```bash
npx @refract-org/cli analyze "Earth" --depth brief
```

With bun (if installed):

```bash
bunx @refract-org/cli analyze "Earth" --depth brief
```

## Local install

```bash
# with bun
bun add -g @refract-org/cli

# with npm
npm install -g @refract-org/cli
```

Then use the `refract` command directly (or `wikihistory` as an alias):

```bash
refract analyze "Earth" --depth brief
```

## From source

```bash
git clone https://github.com/refract-org/refract.git
cd refract
bun install
bun run build
node packages/cli/dist/src/cli.js --version
```

Run the CLI as `node packages/cli/dist/src/cli.js <command>`, or put it on your
`PATH` with `bun link` inside `packages/cli`.

## Docker

Build the image from a checkout. Its entry point is the CLI:

```bash
git clone https://github.com/refract-org/refract.git
cd refract
docker build -t refract .
docker run --rm refract analyze "Bitcoin" --depth brief --json
```

## Verify installation

```bash
refract --version
```

A version number means the CLI started. The CLI
before it on npm, 0.5.7, does not start and fails here with `SyntaxError: The
requested module '@refract-org/analyzers' does not provide an export named …`;
`npm install -g @refract-org/cli` replaces it.
