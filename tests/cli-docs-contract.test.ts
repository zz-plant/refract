import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOOLS } from "@refract-org/mcp";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { program } from "../packages/cli/src/index.js";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

/** Splits Markdown into the sections under headings the pattern matches, keyed by its first group. */
function sections(markdown: string, heading: RegExp, end: RegExp): Map<string, string> {
  const found = new Map<string, string>();
  let current: string | undefined;
  for (const line of markdown.split("\n")) {
    const match = line.match(heading);
    if (match) {
      current = match[1];
      found.set(current, "");
    } else if (end.test(line)) {
      current = undefined;
    } else if (current) {
      found.set(current, `${found.get(current)}${line}\n`);
    }
  }
  return found;
}

/** The first cell of each table row, where the references name a flag or parameter they define. */
function firstCells(section: string): string[] {
  return [...section.matchAll(/^\| (.+?) \|/gm)].map((match) => match[1]);
}

const commands = program.commands as readonly Command[];
const longFlags = (command: Command) => command.options.flatMap((option) => (option.long ? [option.long] : []));

describe("the CLI reference covers the CLI", () => {
  const reference = read("apps/docs/src/content/docs/cli.md");
  const documented = sections(reference, /^## `refract ([a-z]+)`$/, /^## /);
  const shared = sections(reference, /^## (Global options|Analyzer options)$/, /^## /);
  const sharedText = [...shared.values()].join("\n");

  it("has a section for each command and none for a command that does not exist", () => {
    expect([...documented.keys()].sort()).toEqual(commands.map((command) => command.name()).sort());
  });

  it("documents each option in its command's section or a shared one", () => {
    const missing = commands.flatMap((command) =>
      longFlags(command)
        .filter((flag) => !`${documented.get(command.name())}\n${sharedText}`.includes(flag))
        .map((flag) => `refract ${command.name()} ${flag}`),
    );
    expect(missing).toEqual([]);
  });

  it("lists no option its command does not accept", () => {
    const stale = commands.flatMap((command) => {
      const accepted = new Set(longFlags(command));
      const listed = firstCells(documented.get(command.name()) ?? "").flatMap(
        (cell) => cell.match(/--[a-z][a-z-]*/g) ?? [],
      );
      return listed.filter((flag) => !accepted.has(flag)).map((flag) => `refract ${command.name()} ${flag}`);
    });
    expect(stale).toEqual([]);
  });
});

describe("the npm README covers the CLI", () => {
  it("lists each command", () => {
    const readme = read("packages/cli/README.md");
    const missing = commands.map((command) => command.name()).filter((name) => !readme.includes(`| \`${name}`));
    expect(missing).toEqual([]);
  });
});

describe("the MCP npm README covers the MCP server", () => {
  it("lists each tool", () => {
    const readme = read("packages/mcp/README.md");
    const missing = TOOLS.map((tool) => tool.name).filter((name) => !readme.includes(`| \`${name}\``));
    expect(missing).toEqual([]);
  });
});

describe("the MCP documentation covers the MCP server", () => {
  const toolNames = TOOLS.map((tool) => tool.name).sort();
  const parameters = (tool: (typeof TOOLS)[number]) => Object.keys(tool.inputSchema.properties);

  describe.each(["docs/mcp.md", "apps/docs/src/content/docs/mcp.md"])("%s", (path) => {
    const documented = sections(read(path), /^### `([a-z_]+)`$/, /^#{1,3} /);

    it("has a section for each tool and none for a tool that does not exist", () => {
      expect([...documented.keys()].sort()).toEqual(toolNames);
    });

    it("lists exactly the parameters each tool declares", () => {
      for (const tool of TOOLS) {
        const listed = firstCells(documented.get(tool.name) ?? "")
          .flatMap((cell) => cell.match(/^`([A-Za-z]+)`$/)?.[1] ?? [])
          .sort();
        expect({ tool: tool.name, parameters: listed }).toEqual({
          tool: tool.name,
          parameters: parameters(tool).sort(),
        });
      }
    });
  });

  describe.each([".well-known/mcp/server-card.json"])("%s", (path) => {
    const advertised = JSON.parse(read(path)).tools as { name: string; input: Record<string, unknown> }[];

    it("advertises each tool", () => {
      expect(advertised.map((tool) => tool.name).sort()).toEqual(toolNames);
    });

    it("advertises only inputs the tool declares", () => {
      for (const { name, input } of advertised) {
        const declared = parameters(TOOLS.find((tool) => tool.name === name) as (typeof TOOLS)[number]);
        expect({ tool: name, undeclared: Object.keys(input).filter((key) => !declared.includes(key)) }).toEqual({
          tool: name,
          undeclared: [],
        });
      }
    });
  });
});
