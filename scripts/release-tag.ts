#!/usr/bin/env bun
/**
 * Release tag: has the release version on main been tagged, and if not, which
 * commit does its tag belong on?
 *
 * The release version is packages/cli/package.json's. Every tag from v0.5.9 on
 * names it, while the root package.json said 0.5.0 until 0.5.14. publish.yml
 * runs this on a push to main that changes that file, and on a dispatch from
 * main:
 *
 *   - v<version> is not on the remote: tag the commit that set the version, push
 *     the tag, and let the same run publish from that commit. That commit is
 *     found on main's first-parent line, so it is the merge (or squash) that
 *     brought the bump in, and a later edit to the manifest that leaves the
 *     version alone (a dependency range) does not move it.
 *   - v<version> is on the remote, at a commit on main whose manifest says that
 *     version: already released, nothing to do. It need not be the bump commit:
 *     v0.6.1 was pushed by hand two merges after the bump, at b53f878.
 *   - v<version> is on the remote at a commit whose manifest says another
 *     version, or that main does not contain: fail. npm's copy of that version
 *     did not come from main's.
 *   - v<version> is on the remote and its message names this workflow run: an
 *     earlier attempt of this run made it, so carry on with the release.
 *
 * Only the run that creates the tag releases it. A tag pushed with a workflow's
 * own token starts no other workflow, a hand-pushed tag starts its own runs, and
 * the remote refuses a second tag of the same name, so the two can never both
 * release one version: whichever creates the ref first does, and if this run's
 * push loses, it reads the remote again and stands down (or fails, by the rules
 * above).
 *
 * Usage:
 *   bun scripts/release-tag.ts                              # print what a run would do
 *   bun scripts/release-tag.ts --push [--run-url <url>]     # tag, push, write GITHUB_OUTPUT
 *   bun scripts/release-tag.ts --remote <name>              # read a remote other than origin
 */

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Plain Node APIs, not Bun's, so the vitest suite (which runs under Node) can
// import and test this directly, as it does check-release.ts.
export const MANIFEST = "packages/cli/package.json";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A tag of the release version that is already on the remote. */
export interface ExistingTag {
  commit: string;
  /** packages/cli/package.json's version at that commit, or null if it has none. */
  version: string | null;
  /** Whether main's head contains the commit. */
  onMain: boolean;
  /** Whether the tag's message names this workflow run, so an earlier attempt of it made the tag. */
  ownRun: boolean;
}

export type Decision =
  | { action: "tag"; commit: string; message: string }
  | { action: "release"; commit: string; message: string }
  | { action: "skip"; commit: string; message: string }
  | { action: "fail"; message: string };

export interface Plan {
  version: string;
  tag: string;
  /** The commit that set the release version on main's first-parent line. */
  bump: string;
  head: string;
  decision: Decision;
}

const short = (sha: string) => sha.slice(0, 7);

/** What to do about tag `tag` for `version`, given what the remote has. Pure, so it can be tested on its own. */
export function decide(input: { tag: string; version: string; bump: string; existing: ExistingTag | null }): Decision {
  const { tag, version, bump, existing } = input;
  if (!existing) {
    return {
      action: "tag",
      commit: bump,
      message: `${tag} is not on the remote: tag ${short(bump)}, the commit that set ${MANIFEST} to ${version}, and release it`,
    };
  }
  if (existing.ownRun) {
    return {
      action: "release",
      commit: existing.commit,
      message: `${tag} was pushed at ${short(existing.commit)} by an earlier attempt of this run; carrying on with its release`,
    };
  }
  if (existing.version !== version) {
    return {
      action: "fail",
      message: `${tag} is on the remote at ${short(existing.commit)}, where ${MANIFEST} has ${existing.version === null ? "no version" : `version ${existing.version}`}, not ${version}: the tag does not mark a release of ${version}. Nothing was tagged or published`,
    };
  }
  if (!existing.onMain) {
    return {
      action: "fail",
      message: `${tag} is on the remote at ${short(existing.commit)}, which main does not contain: ${version} was released from other code than the ${version} main set at ${short(bump)}. Nothing was tagged or published`,
    };
  }
  return {
    action: "skip",
    commit: existing.commit,
    message:
      existing.commit === bump
        ? `${tag} is already on the remote at ${short(bump)}, the commit that set ${version}; nothing to do`
        : `${tag} is already on the remote at ${short(existing.commit)}, on main and at ${version}; the commit that set ${version} is ${short(bump)}. Nothing to do`,
  };
}

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const run = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (run.error) throw run.error;
  return { status: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
}

function gitOk(cwd: string, args: string[]): string {
  const run = git(cwd, args);
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed:\n${run.stderr.trim()}`);
  return run.stdout.trim();
}

/** packages/cli/package.json's version at `commit`, or null where it is missing or unreadable. */
export function versionAt(cwd: string, commit: string): string | null {
  const show = git(cwd, ["show", `${commit}:${MANIFEST}`]);
  if (show.status !== 0) return null;
  try {
    const version = (JSON.parse(show.stdout) as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * The release version at `head`, and the commit on head's first-parent line
 * where the manifest last changed to it. With --first-parent, git compares a
 * merge with its first parent only, so the merge that brought a bump in counts
 * as the commit that set it; commits that edit the manifest without changing
 * the version are walked past.
 */
export function findBumpCommit(cwd: string, head = "HEAD"): { version: string; commit: string } {
  if (gitOk(cwd, ["rev-parse", "--is-shallow-repository"]) === "true") {
    throw new Error(
      "the checkout is shallow, so the commit that set the version cannot be found (check out with fetch-depth: 0)",
    );
  }
  const version = versionAt(cwd, head);
  if (!version) throw new Error(`${MANIFEST} at ${head} has no version`);
  let bump: string | null = null;
  for (const commit of gitOk(cwd, ["rev-list", "--first-parent", head, "--", MANIFEST]).split("\n").filter(Boolean)) {
    if (versionAt(cwd, commit) !== version) break;
    bump = commit;
  }
  if (!bump) throw new Error(`no commit on ${head}'s first-parent line sets ${MANIFEST} to ${version}`);
  return { version, commit: bump };
}

/** The tag as the remote has it now, or null if the remote has none of that name. */
export function readRemoteTag(
  cwd: string,
  opts: { remote: string; tag: string; head: string; runUrl?: string },
): ExistingTag | null {
  const ref = `refs/tags/${opts.tag}`;
  const ls = git(cwd, ["ls-remote", "--exit-code", "--tags", opts.remote, ref]);
  if (ls.status === 2) return null;
  if (ls.status !== 0) throw new Error(`could not read ${ref} from ${opts.remote}:\n${ls.stderr.trim()}`);
  // Forced, so a local tag of the same name (this run's own, after a push that
  // lost) is replaced by the remote's.
  gitOk(cwd, ["fetch", "--quiet", "--no-tags", opts.remote, `+${ref}:${ref}`]);
  const commit = gitOk(cwd, ["rev-parse", `${ref}^{commit}`]);
  const annotated = gitOk(cwd, ["cat-file", "-t", ref]) === "tag";
  const message = annotated ? gitOk(cwd, ["for-each-ref", "--format=%(contents)", ref]) : "";
  return {
    commit,
    version: versionAt(cwd, commit),
    onMain: git(cwd, ["merge-base", "--is-ancestor", commit, opts.head]).status === 0,
    // A whole line, since one run's URL is a prefix of later runs' (…/runs/12, …/runs/123).
    ownRun: Boolean(opts.runUrl) && message.split("\n").includes(`Run: ${opts.runUrl}`),
  };
}

export function plan(cwd: string, opts: { remote?: string; runUrl?: string } = {}): Plan {
  const remote = opts.remote ?? "origin";
  const head = gitOk(cwd, ["rev-parse", "HEAD"]);
  const { version, commit: bump } = findBumpCommit(cwd, head);
  if (!SEMVER.test(version)) {
    throw new Error(`${MANIFEST} says ${JSON.stringify(version)}, which is not a release version`);
  }
  const tag = `v${version}`;
  const existing = readRemoteTag(cwd, { remote, tag, head, runUrl: opts.runUrl });
  return { version, tag, bump, head, decision: decide({ tag, version, bump, existing }) };
}

/**
 * Carry out a plan whose decision is "tag": create an annotated tag at the bump
 * commit and push it. If the remote refuses because the tag appeared meanwhile,
 * decide again from what it holds now. Any other plan is returned unchanged.
 */
export function tagAndPush(cwd: string, current: Plan, opts: { remote?: string; runUrl?: string } = {}): Plan {
  if (current.decision.action !== "tag") return current;
  const remote = opts.remote ?? "origin";
  const { tag, version, bump, head } = current;
  const message = [
    `Release ${tag}`,
    "",
    `Tagged by publish.yml at the commit that set ${MANIFEST} to ${version}.`,
    ...(opts.runUrl ? [`Run: ${opts.runUrl}`] : []),
  ].join("\n");
  gitOk(cwd, ["tag", "--annotate", "--message", message, tag, bump]);
  const push = git(cwd, ["push", "--quiet", remote, `refs/tags/${tag}`]);
  if (push.status === 0) {
    return {
      ...current,
      decision: {
        action: "release",
        commit: bump,
        message: `pushed ${tag} at ${short(bump)}, the commit that set ${MANIFEST} to ${version}`,
      },
    };
  }
  const existing = readRemoteTag(cwd, { remote, tag, head, runUrl: opts.runUrl });
  if (!existing) throw new Error(`could not push ${tag}:\n${push.stderr.trim()}`);
  const decision = decide({ tag, version, bump, existing });
  if (decision.action === "skip") {
    return {
      ...current,
      decision: {
        ...decision,
        message: `${tag} reached the remote at ${short(existing.commit)} while this run was tagging, so the run that pushed it releases it. ${decision.message}`,
      },
    };
  }
  return { ...current, decision };
}

/**
 * The guard job's outputs for a plan that has been carried out: publish.yml
 * releases when `release` is true, from `sha`. `tagged_here` tells it that no
 * tag push started the Docker and GitHub release workflows, so it calls them.
 */
export function outputs(result: Plan): Record<string, string> {
  const { decision } = result;
  if (decision.action === "tag" || decision.action === "fail") {
    throw new Error(`no outputs for a plan that still says "${decision.action}"`);
  }
  const release = String(decision.action === "release");
  return { release, tag: result.tag, version: result.version, sha: decision.commit, tagged_here: release };
}

function annotate(level: "error" | "notice" | "warning", message: string): string {
  return process.env.GITHUB_ACTIONS === "true" ? `::${level}::${message}` : message;
}

function main() {
  const argv = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const push = argv.includes("--push");
  const opts = { remote: valueOf("--remote") ?? "origin", runUrl: valueOf("--run-url") };
  const cwd = process.cwd();

  let result: Plan;
  try {
    result = plan(cwd, opts);
    if (push) result = tagAndPush(cwd, result, opts);
  } catch (err) {
    console.error(annotate("error", `Release tag: ${(err as Error).message}`));
    process.exit(1);
  }

  const { decision } = result;
  if (decision.action === "fail") {
    console.error(annotate("error", decision.message));
    process.exit(1);
  }
  if (decision.action === "tag") {
    console.log(`${decision.message}. Nothing was pushed: --push does it.`);
    return;
  }
  console.log(annotate("notice", decision.message));
  if (decision.action === "release" && decision.commit !== result.head) {
    // npm writes the run's own commit (GITHUB_SHA) into the provenance of what it publishes.
    console.log(
      annotate(
        "warning",
        `Publishing ${result.tag} from ${short(decision.commit)}; npm provenance will name ${short(result.head)}, the commit this run started on`,
      ),
    );
  }

  if (!push) return;
  const out = outputs(result);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(out)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(""),
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const verb = out.release === "true" ? "Releasing" : "Not releasing";
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${verb} ${result.tag}: ${decision.message}.\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
