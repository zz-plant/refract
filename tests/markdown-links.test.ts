import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Relative links in the repository's own Markdown, as GitHub renders them: the
// file must exist and a #fragment must name a heading in it. The docs site
// checks its pages and their links itself (apps/docs/tests/links.test.ts), so
// apps/ is left to it; the changelog and the daily observations are records of
// what was true when they were written.

const ROOT = join(import.meta.dirname, "..");
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "apps", "observations"]);
const SKIP_FILES = new Set(["CHANGELOG.md"]);

function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...markdownFiles(path));
    } else if (entry.name.endsWith(".md") && !SKIP_FILES.has(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** Lines outside fenced code blocks, with their line numbers. */
function prose(text: string): [string, number][] {
  let fenced = false;
  const lines: [string, number][] = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) lines.push([line, i + 1]);
  });
  return lines;
}

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
function anchorOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

const anchorCache = new Map<string, Set<string>>();
function anchorsIn(file: string): Set<string> {
  const cached = anchorCache.get(file);
  if (cached) return cached;
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const [line] of prose(readFileSync(file, "utf8"))) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const base = anchorOf(heading[1]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n ? `${base}-${n}` : base);
    }
    for (const named of line.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(named[1]);
  }
  anchorCache.set(file, anchors);
  return anchors;
}

function brokenLinks(): string[] {
  const broken: string[] = [];
  for (const file of markdownFiles(ROOT)) {
    const where = relative(ROOT, file);
    for (const [line, n] of prose(readFileSync(file, "utf8"))) {
      for (const match of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1];
        if (/^[a-z][a-z+.-]*:/i.test(target) || target.startsWith("/")) continue;
        const [path, fragment] = target.split("#");
        const dest = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
        if (!existsSync(dest)) {
          broken.push(`${where}:${n} ${target} (no such file)`);
        } else if (fragment && dest.endsWith(".md") && statSync(dest).isFile()) {
          if (!anchorsIn(dest).has(fragment)) broken.push(`${where}:${n} ${target} (no such heading)`);
        }
      }
    }
  }
  return broken;
}

describe("repository Markdown links", () => {
  it("point at files that exist and headings they contain", () => {
    expect(brokenLinks()).toEqual([]);
  });
});
