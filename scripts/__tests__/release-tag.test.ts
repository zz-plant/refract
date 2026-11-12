import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decide, type ExistingTag, findBumpCommit, MANIFEST, outputs, plan, tagAndPush } from "../release-tag.js";

const RUN = "https://github.com/example/refract/actions/runs/12";
const BUMP = "b".repeat(40);
const LATER = "c".repeat(40);

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

let dirs: string[] = [];

beforeEach(() => {
  // Real repositories, isolated from the machine's git configuration (signing,
  // hooks, a default branch name) so the suite runs the same everywhere.
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_AUTHOR_NAME", "Test");
  vi.stubEnv("GIT_AUTHOR_EMAIL", "test@example.com");
  vi.stubEnv("GIT_COMMITTER_NAME", "Test");
  vi.stubEnv("GIT_COMMITTER_EMAIL", "test@example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/** A bare remote and a full clone of it, as publish.yml's guard job checks out main. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "refract-release-tag-"));
  dirs.push(dir);
  const origin = join(dir, "origin.git");
  const work = join(dir, "work");
  git(dir, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  git(dir, "clone", "--quiet", origin, work);
  git(work, "checkout", "--quiet", "-B", "main");
  return { dir, origin, work };
}

function commit(work: string, message: string, manifest?: { version: string; deps?: Record<string, string> }): string {
  if (manifest) {
    mkdirSync(join(work, "packages", "cli"), { recursive: true });
    const json = { name: "@example/cli", version: manifest.version, dependencies: manifest.deps ?? {} };
    writeFileSync(join(work, MANIFEST), `${JSON.stringify(json, null, 2)}\n`);
  } else {
    writeFileSync(join(work, "README.md"), `${message}\n`);
  }
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", message);
  return git(work, "rev-parse", "HEAD");
}

/** A tag pushed by a person: lightweight, and not left in the guard's checkout. */
function pushTagByHand(work: string, tag: string, at: string) {
  git(work, "tag", tag, at);
  git(work, "push", "--quiet", "origin", `refs/tags/${tag}`);
  git(work, "tag", "-d", tag);
}

/** The commit the bare remote's tag points at. */
function remoteTagCommit(origin: string, tag: string): string {
  return git(origin, "rev-parse", `refs/tags/${tag}^{commit}`);
}

/** 0.1.0, then the bump to 0.2.0: the start of every remote scenario below. */
function bumpedRepo() {
  const r = repo();
  const first = commit(r.work, "initial", { version: "0.1.0" });
  const bump = commit(r.work, "chore: release v0.2.0", { version: "0.2.0" });
  return { ...r, first, bump };
}

describe("decide", () => {
  const base = { tag: "v0.2.0", version: "0.2.0", bump: BUMP };
  const existing = (over: Partial<ExistingTag>): ExistingTag => ({
    commit: BUMP,
    version: "0.2.0",
    onMain: true,
    ownRun: false,
    ...over,
  });

  it("tags the bump commit when the remote has no tag", () => {
    expect(decide({ ...base, existing: null })).toMatchObject({ action: "tag", commit: BUMP });
  });

  it("does nothing when the tag is already at the bump commit", () => {
    expect(decide({ ...base, existing: existing({}) })).toMatchObject({ action: "skip", commit: BUMP });
  });

  it("does nothing when the tag was pushed by hand at a later commit on main, as v0.6.1 was", () => {
    const decision = decide({ ...base, existing: existing({ commit: LATER }) });
    expect(decision).toMatchObject({ action: "skip", commit: LATER });
    expect(decision.message).toContain("bbbbbbb");
  });

  it("fails when the tag is at a commit whose manifest names another version", () => {
    const decision = decide({ ...base, existing: existing({ commit: LATER, version: "0.1.0" }) });
    expect(decision.action).toBe("fail");
    expect(decision.message).toContain("version 0.1.0, not 0.2.0");
  });

  it("fails when the tag is at a commit main does not contain", () => {
    const decision = decide({ ...base, existing: existing({ commit: LATER, onMain: false }) });
    expect(decision.action).toBe("fail");
    expect(decision.message).toContain("main does not contain");
  });

  it("carries on when an earlier attempt of this run made the tag", () => {
    expect(decide({ ...base, existing: existing({ ownRun: true }) })).toMatchObject({
      action: "release",
      commit: BUMP,
    });
  });
});

describe("findBumpCommit", () => {
  it("finds the commit that set the version, not main's head", () => {
    const { work, bump } = bumpedRepo();
    commit(work, "docs: unrelated");
    expect(findBumpCommit(work)).toEqual({ version: "0.2.0", commit: bump });
  });

  it("is not moved by later edits to the manifest that leave the version alone", () => {
    const { work, bump } = bumpedRepo();
    commit(work, "chore: move a range", { version: "0.2.0", deps: { "@example/core": "^0.3.0" } });
    commit(work, "chore: move it again", { version: "0.2.0", deps: { "@example/core": "^0.3.1" } });
    expect(findBumpCommit(work)).toEqual({ version: "0.2.0", commit: bump });
  });

  it("takes the merge that brought a bump into main, not the branch commit", () => {
    const { work } = repo();
    commit(work, "initial", { version: "0.1.0" });
    git(work, "checkout", "--quiet", "-b", "release");
    const onBranch = commit(work, "chore: release v0.2.0", { version: "0.2.0" });
    git(work, "checkout", "--quiet", "main");
    commit(work, "docs: meanwhile on main");
    git(work, "merge", "--quiet", "--no-ff", "-m", "Merge the release", "release");
    const merge = git(work, "rev-parse", "HEAD");
    commit(work, "chore: move a range", { version: "0.2.0", deps: { "@example/core": "^0.3.0" } });
    expect(findBumpCommit(work)).toEqual({ version: "0.2.0", commit: merge });
    expect(merge).not.toBe(onBranch);
  });

  it("finds the latest change to the version when an earlier one was undone", () => {
    const { work } = bumpedRepo();
    commit(work, "revert the bump", { version: "0.1.0" });
    const again = commit(work, "chore: release v0.2.0 again", { version: "0.2.0" });
    expect(findBumpCommit(work).commit).toBe(again);
  });

  it("refuses a shallow checkout, where the bump may be cut off", () => {
    const { dir, origin, work } = bumpedRepo();
    commit(work, "docs: unrelated");
    git(work, "push", "--quiet", "origin", "HEAD:main");
    const shallow = join(dir, "shallow");
    git(dir, "clone", "--quiet", "--depth", "1", `file://${origin}`, shallow);
    expect(() => findBumpCommit(shallow)).toThrow(/shallow/);
  });
});

describe("plan and tagAndPush, against a remote", () => {
  it("does nothing when the version is already tagged", () => {
    const { work, bump } = bumpedRepo();
    git(work, "push", "--quiet", "origin", "HEAD:main");
    pushTagByHand(work, "v0.2.0", bump);

    const planned = plan(work, { runUrl: RUN });
    expect(planned.decision).toMatchObject({ action: "skip", commit: bump });
    const done = tagAndPush(work, planned, { runUrl: RUN });
    expect(done).toBe(planned);
    expect(outputs(done)).toMatchObject({ release: "false", tagged_here: "false" });
    expect(git(work, "cat-file", "-t", "refs/tags/v0.2.0")).toBe("commit");
  });

  it("tags the bump commit when the version is untagged, and releases from it", () => {
    const { origin, work, bump } = bumpedRepo();
    const head = commit(work, "chore: move a range", { version: "0.2.0", deps: { "@example/core": "^0.3.0" } });
    git(work, "push", "--quiet", "origin", "HEAD:main");

    const planned = plan(work, { runUrl: RUN });
    expect(planned).toMatchObject({ version: "0.2.0", tag: "v0.2.0", bump, head });
    expect(planned.decision).toMatchObject({ action: "tag", commit: bump });

    const done = tagAndPush(work, planned, { runUrl: RUN });
    expect(done.decision).toMatchObject({ action: "release", commit: bump });
    expect(outputs(done)).toEqual({ release: "true", tag: "v0.2.0", version: "0.2.0", sha: bump, tagged_here: "true" });
    expect(remoteTagCommit(origin, "v0.2.0")).toBe(bump);
    expect(git(work, "cat-file", "-t", "refs/tags/v0.2.0")).toBe("tag");
    expect(git(work, "for-each-ref", "--format=%(contents)", "refs/tags/v0.2.0")).toContain(`Run: ${RUN}`);
  });

  it("carries on in a re-run of the run that tagged, and only in that run", () => {
    const { work, bump } = bumpedRepo();
    git(work, "push", "--quiet", "origin", "HEAD:main");
    const run123 = `${RUN}3`;
    tagAndPush(work, plan(work, { runUrl: run123 }), { runUrl: run123 });

    expect(plan(work, { runUrl: run123 }).decision).toMatchObject({ action: "release", commit: bump });
    // Run 12's URL is the start of run 123's, so it has to match a whole line.
    expect(plan(work, { runUrl: RUN }).decision).toMatchObject({ action: "skip", commit: bump });
    expect(plan(work).decision).toMatchObject({ action: "skip", commit: bump });
  });

  it("fails when the tag is at a commit whose manifest names another version", () => {
    const { work, first } = bumpedRepo();
    git(work, "push", "--quiet", "origin", "HEAD:main");
    pushTagByHand(work, "v0.2.0", first);

    const decision = plan(work, { runUrl: RUN }).decision;
    expect(decision.action).toBe("fail");
    expect(decision.message).toContain("version 0.1.0, not 0.2.0");
  });

  it("fails when the tag is at a commit main does not contain", () => {
    const { work, first } = bumpedRepo();
    git(work, "push", "--quiet", "origin", "HEAD:main");
    git(work, "checkout", "--quiet", "-b", "elsewhere", first);
    const elsewhere = commit(work, "chore: release v0.2.0 from a branch", { version: "0.2.0" });
    pushTagByHand(work, "v0.2.0", elsewhere);
    git(work, "checkout", "--quiet", "main");
    git(work, "branch", "--quiet", "-D", "elsewhere");

    const decision = plan(work, { runUrl: RUN }).decision;
    expect(decision.action).toBe("fail");
    expect(decision.message).toContain("main does not contain");
  });

  it("stands down when a tag of the version reaches the remote while it is tagging", () => {
    const { work, bump } = bumpedRepo();
    git(work, "push", "--quiet", "origin", "HEAD:main");
    const planned = plan(work, { runUrl: RUN });
    expect(planned.decision.action).toBe("tag");
    pushTagByHand(work, "v0.2.0", bump);

    const done = tagAndPush(work, planned, { runUrl: RUN });
    expect(done.decision).toMatchObject({ action: "skip", commit: bump });
    expect(done.decision.message).toContain("while this run was tagging");
    expect(outputs(done).release).toBe("false");
    // The person's tag stays, and the checkout now holds it in place of this run's.
    expect(git(work, "cat-file", "-t", "refs/tags/v0.2.0")).toBe("commit");
  });

  it("fails when the tag that reaches the remote first is at a commit main does not contain", () => {
    const { origin, work, first } = bumpedRepo();
    git(work, "push", "--quiet", "origin", "HEAD:main");
    const planned = plan(work, { runUrl: RUN });
    git(work, "checkout", "--quiet", "-b", "elsewhere", first);
    const elsewhere = commit(work, "chore: release v0.2.0 from a branch", { version: "0.2.0" });
    git(work, "checkout", "--quiet", "main");
    pushTagByHand(work, "v0.2.0", elsewhere);

    const done = tagAndPush(work, planned, { runUrl: RUN });
    expect(done.decision.action).toBe("fail");
    expect(remoteTagCommit(origin, "v0.2.0")).toBe(elsewhere);
  });
});
