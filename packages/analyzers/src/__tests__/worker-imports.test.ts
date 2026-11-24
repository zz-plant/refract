import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What a Cloudflare Worker can import: claimHistory, snapshotAt and the rest
 * of the package entry run there (with nodejs_compat, for node:crypto), so
 * nothing reachable from it may read the filesystem, start a process, or pull
 * in the packages that do.
 */
const FORBIDDEN = [
  /^(node:)?fs(\/promises)?$/,
  /^(node:)?child_process$/,
  /^bun:/,
  /^@refract-org\/(ingestion|cli|persistence|eval)(\/|$)/,
];

const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Every module specifier a file imports at runtime: type-only imports are erased and skipped. */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const [, , typeOnly, specifier] of source.matchAll(statement)) if (!typeOnly) specifiers.push(specifier);
  for (const [, specifier] of source.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g))
    specifiers.push(specifier);
  return specifiers;
}

/** The source file a specifier names, for this repo's own modules; undefined for anything else. */
function sourceOf(specifier: string, from: string): string | undefined {
  if (specifier.startsWith(".")) return resolve(dirname(from), specifier.replace(/\.js$/, ".ts"));
  const workspace = /^@refract-org\/([a-z-]+)$/.exec(specifier);
  return workspace ? resolve(PACKAGES, workspace[1], "src/index.ts") : undefined;
}

/** The import graph from `entry`: each [file, specifier] edge, and every file read. */
function importGraph(entry: string): { edges: Array<[string, string]>; files: Set<string> } {
  const edges: Array<[string, string]> = [];
  const seen = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of runtimeImports(readFileSync(file, "utf-8"))) {
      edges.push([file, specifier]);
      const next = sourceOf(specifier, file);
      if (next && !FORBIDDEN.some((pattern) => pattern.test(specifier))) queue.push(next);
    }
  }
  return { edges, files: seen };
}

describe("the analyzers entry runs in a Worker", () => {
  const { edges, files: read } = importGraph(resolve(PACKAGES, "analyzers/src/index.ts"));

  it("reaches no filesystem, process or Node-only package", () => {
    const offending = edges
      .filter(([, specifier]) => FORBIDDEN.some((pattern) => pattern.test(specifier)))
      .map(([file, specifier]) => `${file.slice(PACKAGES.length + 1)} imports ${specifier}`);
    expect(offending).toEqual([]);
  });

  it("walks the modules the library functions live in", () => {
    const files = new Set([...read].map((file) => file.slice(PACKAGES.length + 1)));
    for (const module of ["claim-history", "snapshot-at", "locate-change", "wording", "wikitext-parser"]) {
      expect(files).toContain(`analyzers/src/${module}.ts`);
    }
    expect(files).toContain("evidence-graph/src/index.ts");
  });

  it("would catch a forbidden import", () => {
    expect(
      runtimeImports('import { readFileSync } from "node:fs";\nimport type { X } from "node:child_process";'),
    ).toEqual(["node:fs"]);
    expect(runtimeImports('const cp = await import("child_process");')).toEqual(["child_process"]);
  });
});
