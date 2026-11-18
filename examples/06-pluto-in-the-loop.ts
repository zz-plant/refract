#!/usr/bin/env bun
/**
 * 06 — Refract in the loop: Pluto, 24 August 2006
 *
 * Replays the captured Pluto revisions from the day the IAU reclassified
 * Pluto. Refract's sentence matcher pairs a reworded sentence with its earlier
 * wording only when enough words survive (overlap 0.8). Below that it records
 * one sentence removed and another first seen, and the sentence's history
 * splits. At each split this script asks a model whether the two are the same
 * claim, through `refract classify sentence_similarity`: Refract's own prompt,
 * provider and reading of the reply.
 *
 * Model answers are interpretation, not observation. Each one names the two
 * events it is about, and before it is shown it is checked against the events
 * Refract derives from the saved revisions: the events must exist, hold the
 * sentences the answer quotes, and the recorded verdict must be what the
 * model's reply says. An answer that fails is not shown as a link.
 *
 * A model's answers differ between runs, so `--save` keeps them and
 * `--answers` replays them. Runs offline from docs/examples/pluto-revisions.json
 * unless `--ask` is given. Build first: `bun run build`.
 *
 * Usage:
 *   bun run examples/06-pluto-in-the-loop.ts                        # observed events and the questions
 *   REFRACT_INFERENCE_API_KEY=… bun run examples/06-pluto-in-the-loop.ts --ask --save answers.json
 *   bun run examples/06-pluto-in-the-loop.ts --answers answers.json  # replay saved answers, checked first
 *   bun run examples/06-pluto-in-the-loop.ts --answers answers.json --tamper
 *
 * Options:
 *   --ask             ask the model configured by REFRACT_INFERENCE_API_KEY,
 *                     REFRACT_INFERENCE_ENDPOINT and REFRACT_INFERENCE_MODEL
 *   --save <path>     with --ask, write the answers to <path>
 *   --answers <path>  replay answers saved by --save
 *   --tamper          change one saved answer's quoted sentence, to show the check refusing it
 *   --pace <seconds>  pause between revision pairs (default 0)
 *   --json            print NDJSON: observed events, then checked interpretations
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { annotateEvents, buildRevisionEvents, wordOverlapRatio } from "@refract-org/analyzers";
import type { EvidenceEvent, InferenceResult, Revision } from "@refract-org/evidence-graph";
import { buildInferencePrompt, createEventIdentity, parseInferenceResponse } from "@refract-org/evidence-graph";

const INPUTS = fileURLToPath(new URL("../docs/examples/pluto-revisions.json", import.meta.url));
const CLI = fileURLToPath(new URL("../packages/cli/dist/src/cli.js", import.meta.url));
const THRESHOLD = 0.8; // buildRevisionEvents' default similarityThreshold
const ANSWERS_FORMAT = "refract-in-the-loop/answers/v1";

type Pair = { from: number; to: number; revisions: Revision[] };

/** A removed and a first-seen sentence in one revision pair and section: where the matcher split a history. */
type Split = { pair: Pair; removed: EvidenceEvent; firstSeen: EvidenceEvent };

type SavedAnswer = {
  fromRevisionId: number;
  toRevisionId: number;
  removedEventId: string;
  firstSeenEventId: string;
  before: string;
  after: string;
  prompt: string;
  result: InferenceResult;
  askedAt: string;
};

type AnswersFile = { format: string; about: string; answers: SavedAnswer[] };

// ── options ──

function usage(message: string): never {
  process.stderr.write(`${message}\nSee the usage notes at the top of examples/06-pluto-in-the-loop.ts.\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) usage(`${name} needs a value.`);
  return v;
};
const known = new Set(["--ask", "--save", "--answers", "--tamper", "--pace", "--json"]);
for (const [i, arg] of argv.entries()) {
  const previous = argv[i - 1];
  const isValue = previous === "--save" || previous === "--answers" || previous === "--pace";
  if (!isValue && !known.has(arg)) usage(`Unknown option: ${arg}`);
}

const ask = flag("--ask");
const savePath = value("--save");
const answersPath = value("--answers");
const tamper = flag("--tamper");
const json = flag("--json");
const pace = Number(value("--pace") ?? 0);

if (ask && answersPath) usage("--ask asks a model now; --answers replays saved answers. Pass one.");
if (savePath && !ask) usage("--save writes the answers --ask gets; pass --ask too.");
if (tamper && !answersPath) usage("--tamper changes a saved answer; pass --answers too.");
if (!Number.isFinite(pace) || pace < 0) usage("--pace takes a number of seconds.");
if (ask && !process.env.REFRACT_INFERENCE_API_KEY) {
  usage(
    "--ask needs a model. Set REFRACT_INFERENCE_API_KEY, and REFRACT_INFERENCE_ENDPOINT and\n" +
      "REFRACT_INFERENCE_MODEL for a provider other than OpenAI. Without a key, `refract classify`\n" +
      "answers with its default rule, which is the matcher's own word overlap.",
  );
}
if (ask && !existsSync(CLI)) usage("--ask runs the built CLI. Run `bun run build` first.");

// ── terminal ──

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = paint(2);
const bold = paint(1);
const green = paint(32);
const red = paint(31);
const cyan = paint(36);
const yellow = paint(33);

const out = (line = "") => {
  if (!json) process.stdout.write(`${line}\n`);
};

function wrap(text: string, indent: number): string {
  const width = Math.max(60, Math.min(process.stdout.columns || 100, 110)) - indent;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join(`\n${" ".repeat(indent)}`);
}

const sleep = (seconds: number) => new Promise((done) => setTimeout(done, seconds * 1000));

// ── observed: events Refract derives from the saved revisions ──

const pairs: Pair[] = JSON.parse(readFileSync(INPUTS, "utf8"));

// Each pair is analyzed on its own, as the capture script does, so nothing is
// inferred across the revisions between pairs that were not saved.
const eventsByPair = new Map<Pair, EvidenceEvent[]>();
const eventsById = new Map<string, EvidenceEvent>();
for (const pair of pairs) {
  const events = annotateEvents(buildRevisionEvents(pair.revisions, { depth: "detailed" }));
  for (const event of events) {
    event.eventId = createEventIdentity(event);
    eventsById.set(event.eventId, event);
  }
  eventsByPair.set(pair, events);
}

function splitsIn(pair: Pair): Split[] {
  const events = eventsByPair.get(pair) ?? [];
  const removed = events.filter((e) => e.eventType === "sentence_removed");
  const firstSeen = events.filter((e) => e.eventType === "sentence_first_seen");
  return removed.flatMap((r) => firstSeen.filter((f) => f.section === r.section).map((f) => ({ pair, removed: r, firstSeen: f })));
}

const promptFor = (before: string, after: string) => buildInferencePrompt("sentence_similarity", { before, after });

// ── interpretation: answers, and the check each passes before it is shown ──

/** Why `saved` cannot be shown as a link between two of Refract's events; empty when it can. */
function check(saved: SavedAnswer): string[] {
  const problems: string[] = [];
  const removed = eventsById.get(saved.removedEventId);
  const firstSeen = eventsById.get(saved.firstSeenEventId);
  if (!removed || removed.eventType !== "sentence_removed") {
    problems.push(`cites ${saved.removedEventId} as a removed sentence; the saved revisions give no such event`);
  } else if (removed.before !== saved.before) {
    problems.push(`quotes a removed sentence that event ${saved.removedEventId} does not hold`);
  }
  if (!firstSeen || firstSeen.eventType !== "sentence_first_seen") {
    problems.push(`cites ${saved.firstSeenEventId} as a first-seen sentence; the saved revisions give no such event`);
  } else if (firstSeen.after !== saved.after) {
    problems.push(`quotes a first-seen sentence that event ${saved.firstSeenEventId} does not hold`);
  }
  for (const event of [removed, firstSeen]) {
    if (event && (event.fromRevisionId !== saved.fromRevisionId || event.toRevisionId !== saved.toRevisionId)) {
      problems.push(
        `names revisions ${saved.fromRevisionId} → ${saved.toRevisionId}; event ${event.eventId} is in ${event.fromRevisionId} → ${event.toRevisionId}`,
      );
    }
  }
  if (removed && firstSeen && saved.prompt !== promptFor(removed.before, firstSeen.after)) {
    problems.push("was asked with a prompt other than the one these two sentences give");
  }
  if (saved.result?.source !== "model" || typeof saved.result.answer !== "string") {
    problems.push("is not a model's reply");
  } else {
    const reread = parseInferenceResponse("sentence_similarity", saved.result.answer, {}).output;
    if (JSON.stringify(reread) !== JSON.stringify(saved.result.output)) {
      problems.push(`records a verdict its reply ("${saved.result.answer.trim()}") does not give`);
    }
  }
  return problems;
}

const execute = promisify(execFile);

async function askModel(split: Split): Promise<SavedAnswer> {
  const before = split.removed.before;
  const after = split.firstSeen.after;
  const { stdout } = await execute(
    process.execPath,
    [CLI, "classify", "sentence_similarity", "--input", JSON.stringify({ before, after })],
    { encoding: "utf8", env: process.env },
  );
  const result = JSON.parse(stdout) as InferenceResult;
  if (result.source !== "model") {
    throw new Error("`refract classify` answered with its default rule, not a model. Check REFRACT_INFERENCE_API_KEY.");
  }
  return {
    fromRevisionId: split.pair.from,
    toRevisionId: split.pair.to,
    removedEventId: split.removed.eventId as string,
    firstSeenEventId: split.firstSeen.eventId as string,
    before,
    after,
    prompt: promptFor(before, after),
    result,
    askedAt: new Date().toISOString(),
  };
}

let saved: SavedAnswer[] = [];
if (answersPath) {
  const file = JSON.parse(readFileSync(answersPath, "utf8")) as AnswersFile;
  if (file.format !== ANSWERS_FORMAT) usage(`${answersPath} is not a file --save wrote (format ${ANSWERS_FORMAT}).`);
  saved = file.answers;
  if (tamper && saved.length > 0) {
    const first = saved[0];
    first.after = first.after.includes("demoted")
      ? first.after.replace("demoted", "promoted")
      : `${first.after} (edited)`;
  }
}
const keyOf = (removedId: string, firstSeenId: string) => `${removedId}→${firstSeenId}`;
const savedByKey = new Map(saved.map((a) => [keyOf(a.removedEventId, a.firstSeenEventId), a]));

// ── replay ──

type Outcome = { answer: SavedAnswer; problems: string[] };
const outcomes: Outcome[] = [];
let splitCount = 0;
let promptShown = false;

/** Print the matcher's and the model's view of one split, asking the model if --ask. */
async function showSplit(split: Split): Promise<void> {
  splitCount += 1;
  const overlap = wordOverlapRatio(split.removed.before, split.firstSeen.after);
  out(`    ${yellow("matcher")}  ${dim(`word overlap ${overlap.toFixed(2)}, under ${THRESHOLD}: recorded as two unrelated sentences`)}`);

  const key = keyOf(split.removed.eventId as string, split.firstSeen.eventId as string);
  let answer = savedByKey.get(key);
  savedByKey.delete(key);
  if (!answer && ask) {
    if (!promptShown) {
      out(`    ${dim(`asking   ${promptFor("…", "…").split("\n")[0]}`)}`);
      promptShown = true;
    }
    answer = await askModel(split);
    saved.push(answer);
  }
  if (!answer) {
    out(`    ${dim("model    not asked")}`);
    return;
  }

  const problems = check(answer);
  outcomes.push({ answer, problems });
  if (problems.length > 0) {
    out(`    ${red("model    answer refused by the check, so not shown:")}`);
    for (const problem of problems) out(`             ${red(wrap(`the answer ${problem}`, 13))}`);
    return;
  }
  const isSame = answer.result.output.isSameClaim;
  const verdict = isSame === true ? green("same claim") : isSame === false ? "a different claim" : yellow("no answer read");
  const who = `${answer.result.model ?? "model not named"}, asked ${answer.askedAt.slice(0, 10)}`;
  out(`    model    ${verdict}  ${dim(`reply "${answer.result.answer?.trim()}" (${who})`)}`);
  out(`             ${green("✓")} ${dim(`checked against events ${answer.removedEventId} and ${answer.firstSeenEventId}`)}`);
}

const LABEL = 21; // "  " + event type padded to 19

out(bold("Pluto, 24 August 2006: Refract in the loop"));
out(dim(wrap("Observed: Refract's events, derived now from the saved revisions in docs/examples/pluto-revisions.json.", 0)));
out(
  dim(
    wrap(
      answersPath
        ? `Interpretation: saved model answers from ${answersPath}, each checked against those events before it is shown.`
        : ask
          ? "Interpretation: the configured model, asked at each split, each answer checked against the events before it is shown."
          : "Interpretation: none. Pass --ask, or --answers with a saved file, to put a model in the loop.",
      0,
    ),
  ),
);
if (tamper) out(yellow("--tamper: the first saved answer's quoted sentence was changed before checking."));

for (const [index, pair] of pairs.entries()) {
  const previous = pairs[index - 1];
  if (previous && previous.to !== pair.from) {
    out(dim(`  ⋯ revisions between ${previous.to} and ${pair.from} were not saved; nothing is inferred across them`));
  }
  if (index > 0 && pace) await sleep(pace);
  out();
  out(`${bold(pair.revisions[1].timestamp.replace("T", " "))}  ${dim(`revisions ${pair.from} → ${pair.to}`)}`);

  const events = eventsByPair.get(pair) ?? [];
  const sentence = (event: EvidenceEvent, text: string) => out(`  ${cyan(event.eventType.padEnd(LABEL - 2))} ${wrap(text, LABEL + 1)}`);

  for (const event of events.filter((e) => e.eventType === "sentence_modified" || e.eventType === "sentence_reintroduced")) {
    if (event.eventType === "sentence_reintroduced") {
      sentence(event, event.after);
      continue;
    }
    out(`  ${cyan(event.eventType.padEnd(LABEL - 2))} ${dim("was")} ${wrap(event.before, LABEL + 5)}`);
    out(`  ${" ".repeat(LABEL - 2)} ${dim("now")} ${wrap(event.after, LABEL + 5)}`);
    const overlap = wordOverlapRatio(event.before, event.after);
    out(`    ${dim(`matcher  word overlap ${overlap.toFixed(2)}, at least ${THRESHOLD}: one sentence, reworded`)}`);
  }

  // Each removed sentence, then each sentence first seen beside it: the splits.
  const splits = splitsIn(pair);
  const shown = new Set<EvidenceEvent>();
  for (const removed of events.filter((e) => e.eventType === "sentence_removed")) {
    sentence(removed, removed.before);
    shown.add(removed);
    for (const split of splits.filter((s) => s.removed === removed)) {
      sentence(split.firstSeen, split.firstSeen.after);
      shown.add(split.firstSeen);
      await showSplit(split);
    }
  }
  for (const firstSeen of events.filter((e) => e.eventType === "sentence_first_seen" && !shown.has(e))) {
    sentence(firstSeen, firstSeen.after);
  }

  const others = events.filter((e) => !e.eventType.startsWith("sentence_")).map((e) => e.eventType);
  if (others.length > 0) out(dim(`  also observed: ${others.join(", ")}`));
}

// Saved answers about two events this run does not pair: stale, or never Refract's.
const strays: Outcome[] = [...savedByKey.values()].map((answer) => ({
  answer,
  problems: ["is about two events this run does not pair", ...check(answer)],
}));
outcomes.push(...strays);

// ── summary ──

const refused = outcomes.filter((o) => o.problems.length > 0);
const accepted = outcomes.filter((o) => o.problems.length === 0);
const count = (v: unknown) => accepted.filter((o) => o.answer.result.output.isSameClaim === v).length;
const splitPairs = pairs.filter((pair) => splitsIn(pair).length > 0).length;

out();
out(bold("Summary"));
out(`  The matcher split this history in ${splitPairs} of ${pairs.length} saved revision pairs: ${splitCount} possible links.`);
if (outcomes.length === 0) {
  out(dim("  No model was asked. To ask one and keep its answers:"));
  out(dim("    REFRACT_INFERENCE_API_KEY=… bun run examples/06-pluto-in-the-loop.ts --ask --save answers.json"));
} else {
  const noAnswer = accepted.length - count(true) - count(false);
  out(
    `  Model answers shown: ${green(`${count(true)} same claim`)}, ${count(false)} a different claim` +
      `${noAnswer ? `, ${noAnswer} with no answer read` : ""}.`,
  );
  out(
    refused.length
      ? red(`  ${refused.length} saved answer${refused.length === 1 ? " was" : "s were"} refused by the check and not shown.`)
      : `  Every answer passed the check against Refract's events.`,
  );
  for (const { answer, problems } of strays) {
    out(red(`  Answer about ${answer.removedEventId} and ${answer.firstSeenEventId}, not shown:`));
    for (const problem of problems) out(red(`    the answer ${problem}`));
  }
}

if (savePath) {
  const file: AnswersFile = {
    format: ANSWERS_FORMAT,
    about:
      "Answers from a model to `refract classify sentence_similarity` at the Pluto splits, saved so a replay shows " +
      "the same thing. Asking again can give different answers. examples/06-pluto-in-the-loop.ts checks each against " +
      "the events derived from docs/examples/pluto-revisions.json before showing it.",
    answers: saved,
  };
  writeFileSync(savePath, `${JSON.stringify(file, null, 2)}\n`);
  out(dim(`  Saved ${saved.length} answers to ${savePath}.`));
}

// ── NDJSON ──

if (json) {
  for (const pair of pairs) {
    for (const event of eventsByPair.get(pair) ?? []) process.stdout.write(`${JSON.stringify(event)}\n`);
  }
  for (const { answer } of accepted) {
    process.stdout.write(
      `${JSON.stringify({
        layer: "model_interpretation",
        interpretation: "same_claim",
        isSameClaim: answer.result.output.isSameClaim ?? null,
        fromRevisionId: answer.fromRevisionId,
        toRevisionId: answer.toRevisionId,
        basedOn: [answer.removedEventId, answer.firstSeenEventId],
        answer: answer.result.answer,
        model: answer.result.model ?? null,
        askedAt: answer.askedAt,
        checked: true,
      })}\n`,
    );
  }
  for (const { answer, problems } of refused) {
    process.stderr.write(`Refused saved answer ${answer.removedEventId} → ${answer.firstSeenEventId}: ${problems.join("; ")}\n`);
  }
}

process.exitCode = refused.length > 0 ? 1 : 0;
