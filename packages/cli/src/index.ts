import { readFileSync } from "node:fs";
import type { InferenceBoundary } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { Argument, Command } from "commander";
import { buildConfig, buildObservationReport, runAnalyze } from "./commands/analyze.js";
import { runClaim } from "./commands/claim.js";
import { runCron } from "./commands/cron.js";
import { DelegationInputError, runDelegation, WHEN_RULES } from "./commands/delegation.js";
import type { DiffResult } from "./commands/diff.js";
import { runDiff } from "./commands/diff.js";
import { runEval } from "./commands/eval.js";
import { runExplore } from "./commands/explore.js";
import { runExport } from "./commands/export.js";
import { runInit } from "./commands/init.js";
import { runMcpServer } from "./commands/mcp.js";
import { acknowledgeReview, filterReviewEntries, observeReview, renderReview } from "./commands/review.js";
import { runSnapshot } from "./commands/snapshot.js";
import { runStream } from "./commands/stream.js";
import { runVerify } from "./commands/verify.js";
import { runVisualize } from "./commands/visualize.js";
import { runWatch } from "./commands/watch.js";
import { INFERENCE_BOUNDARIES, OpenAICompatibleProvider } from "./inference-provider.js";
import { bold, cyan, dim, formatEvent, gray, green, heading, red, success } from "./render.js";
import { REFRACT_VERSION } from "./version.js";

function withGlobal(cmd: Command, includeCacheDir = true): Command {
  cmd.option("--api <url>", "MediaWiki API base URL");
  if (includeCacheDir) cmd.option("--cache-dir <path>", "cache directory path");
  return cmd
    .option("--api-key <token>", "API key for bearer token auth")
    .option("--api-user <user>", "username for basic auth")
    .option("--api-password <pass>", "password for basic auth");
}

function withAnalyzerConfig(cmd: Command): Command {
  return cmd
    .option("--config <path>", "JSON file with AnalyzerConfig overrides")
    .option("--similarity <n>", "Sentence matching threshold (0-1, default 0.8)")
    .option("--revert-patterns <path>", "File with revert regex patterns (one per line)")
    .option("--cluster-window <min>", "Edit cluster window in minutes (default 60)")
    .option("--spike-factor <n>", "Talk activity spike multiplier (default 3.0)")
    .option("--talk-window <fmt>", "Talk correlation window in days. Format: before/after e.g. 7/3")
    .option("--section-rename <mode>", "Section rename detection: exact | similarity | none");
}

export function extractAuth(opts: Record<string, unknown>): AuthConfig | undefined {
  const apiKey = opts.apiKey as string | undefined;
  const apiUser = opts.apiUser as string | undefined;
  const apiPassword = opts.apiPassword as string | undefined;
  // Namespaced so an unrelated OAUTH_CLIENT_ID/OAUTH_CLIENT_SECRET in the
  // environment — common on CI runners — is not read as Refract's. Under the
  // generic names they were sent as headers to whatever wiki was queried,
  // including Wikipedia when --api was not given.
  const oauthClientId = process.env.REFRACT_OAUTH_CLIENT_ID;
  const oauthClientSecret = process.env.REFRACT_OAUTH_CLIENT_SECRET;

  if (!apiKey && !apiUser && !apiPassword && !oauthClientId && !oauthClientSecret) return undefined;

  return { apiKey, apiUser, apiPassword, oauthClientId, oauthClientSecret };
}

const DOCS_URL = "https://zz-plant.github.io/refract/";

export const program = new Command();

program
  .name("refract")
  .description("git log for Wikipedia: typed events for changes across MediaWiki revision histories")
  .version(REFRACT_VERSION)
  .addHelpCommand("help [command]", "show help for a specific command")
  .addHelpText(
    "after",
    `
Start from your question:
  Changes since my last review?  refract review --pages-file pages.txt
  When did this text change?     refract claim <page> --text "<text>"
  What did the page say then?    refract snapshot <page> --at 2024-01-15
  Changes as data?               refract export <page> --format ndjson
  Connect an agent?              refract mcp

Try it offline: refract init
Docs: ${DOCS_URL}`,
  );

/**
 * Printed after the explorer starts as well as after the text summary: in a
 * terminal, `analyze` opens the explorer, and this block used to print only on
 * the path that does not, so a person at a terminal never saw it.
 */
function printNextSteps(page: string, inExplorer: boolean): void {
  const file = `${page.toLowerCase().replace(/\s+/g, "-")}-events.jsonl`;
  const steps: [string, string][] = [
    ...(inExplorer ? [] : ([["View in browser", `refract explore "${page}"`]] as [string, string][])),
    ["Track text", `refract claim "${page}" --text "exact phrase"`],
    ["See an earlier date", `refract snapshot "${page}" --at 2024-01-15`],
    ["Export as data", `refract export "${page}" --format ndjson > ${file}`],
    ["Review changes later", `refract review "${page}"`],
    ["Connect an agent", "refract mcp"],
    ["Full docs", DOCS_URL],
  ];
  console.log();
  console.log(dim("Next steps:"));
  for (const [label, command] of steps) {
    console.log(dim(`  ${label.padEnd(20)} → ${command}`));
  }
}

// ── init ──
program
  .command("init")
  .description("onboarding — inspect a bundled fictional history offline")
  .option("-j, --json", "print the sample events as NDJSON")
  .action(async (opts) => {
    await runInit({ json: !!opts.json });
  });

// ── analyze ──
const analyzeCmd = program
  .command("analyze [page]")
  .description("analyze full edit history of a page")
  .option("-d, --depth <depth>", "analysis depth: brief, detailed, forensic", "detailed")
  .option("--from <revId>", "start revision ID")
  .option("--to <revId>", "end revision ID")
  .option("--since <timestamp>", "re-observe from ISO timestamp")
  .option("-c, --cache", "cache revisions in SQLite (~/.wikihistory/refract.db); needs Bun and a source checkout")
  .option("--pages-file <path>", "batch file of page titles (one per line)")
  .option("--brief-limit <n>", "max revisions in brief mode (default: 20)", parseInt)
  .option("--batch-concurrency <n>", "max pages to analyze in parallel (default: 4)", parseInt)
  .option("-r, --report", "output ObservationReport JSON instead of raw events")
  .option("-j, --json", "force JSON output to stdout (disable interactive web UI)");
withGlobal(analyzeCmd);
withAnalyzerConfig(analyzeCmd);
analyzeCmd.action(async (page, opts) => {
  const pagesFile = opts.pagesFile as string | undefined;
  const auth = extractAuth(opts);

  const config = buildConfig(opts);

  if (pagesFile) {
    const result = await runAnalyze(
      "",
      opts.depth as string,
      opts.from ? Number(opts.from) : undefined,
      opts.to ? Number(opts.to) : undefined,
      opts.since as string | undefined,
      !!opts.cache,
      opts.api as string | undefined,
      pagesFile,
      opts.cacheDir as string | undefined,
      auth,
      config,
    );
    console.log(`\n${success(`Batch complete. ${result.events.length} events total.`)}`);
    return;
  }

  if (!page) {
    console.error(red("Error: page title required (or use --pages-file for batch mode)"));
    console.error(gray("  refract analyze <page> [options]"));
    process.exit(1);
  }

  const analysis = await runAnalyze(
    page,
    opts.depth as string,
    opts.from ? Number(opts.from) : undefined,
    opts.to ? Number(opts.to) : undefined,
    opts.since as string | undefined,
    !!opts.cache,
    opts.api as string | undefined,
    undefined,
    opts.cacheDir as string | undefined,
    auth,
    config,
  );

  const { events, revisions, coverage } = analysis;

  if (opts.report) {
    const pageId = revisions[0]?.pageId ?? 0;
    const report = buildObservationReport(page, pageId, events, revisions);
    console.log(JSON.stringify({ ...report, coverage }, null, 2));
    return;
  }

  if (opts.json) {
    for (const event of events) {
      console.log(JSON.stringify(event));
    }
    return;
  }

  // Interactive mode: auto-launch web UI when stdout is a TTY and no --json flag
  const isInteractive = process.stdout.isTTY && !opts.json;
  if (isInteractive && events.length > 0) {
    await runExplore(
      page,
      8899,
      false,
      opts.api as string | undefined,
      auth,
      config,
      !!opts.cache,
      opts.depth as string,
      opts.since as string | undefined,
      { analysis },
    );
    printNextSteps(page, true);
    return;
  }

  console.log(heading("Analysis Results"));
  console.log(`  ${bold("Page:")}    ${page}`);
  console.log(`  ${bold("Events:")}  ${cyan(String(events.length))}`);
  if (opts.since) console.log(`  ${gray(`Re-observation since: ${opts.since}`)}`);
  console.log();

  for (const event of events) {
    console.log(formatEvent(event));
  }

  if (events.length === 0) {
    console.log(
      gray(
        revisions.length < 2
          ? "  Insufficient revisions to compare text."
          : "  No events emitted for the captured range.",
      ),
    );
  }

  if (events.length > 0) printNextSteps(page, false);
});

// ── review ──
const reviewCmd = program
  .command("review [page]")
  .option("--sample", "review the bundled fictional history offline")
  .description("inspect source changes since the last acknowledged review")
  .option("--pages-file <path>", "watchlist: one page title per line")
  .option("--state-dir <path>", "review state and saved reports (default ~/.refract/review)")
  .option("--from <id>", "initial comparison baseline; does not mark it reviewed", Number)
  .option("--limit <n>", "new revisions per page per run (default 200); repeat to resume", Number)
  .option("--ack <report-id>", "acknowledge an inspected saved report without fetching")
  .option("--format <format>", "markdown or json", "markdown")
  .option("--event-type <types>", "comma-separated mechanical event types")
  .option("--section <name>", "show only events in this section")
  .option("--text <text>", "show events containing this text");
withGlobal(reviewCmd, false);
reviewCmd.action(async (page, opts) => {
  if (opts.ack) {
    if (page || opts.pagesFile || opts.from || opts.eventType || opts.text || opts.section || opts.sample) {
      throw new Error("Use --ack with --state-dir only; acknowledgment uses the saved unfiltered report.");
    }
    await acknowledgeReview(opts.ack, opts.stateDir);
    console.log(`Acknowledged report ${opts.ack}. Only its captured revision endpoints were marked reviewed.`);
    return;
  }
  if (!["markdown", "json"].includes(opts.format)) throw new Error("--format must be markdown or json.");
  const titles = opts.pagesFile
    ? readFileSync(opts.pagesFile, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
    : [];
  if (page) titles.push(page);
  const report = await observeReview(titles, {
    stateDir: opts.stateDir,
    sample: !!opts.sample,
    apiUrl: opts.api,
    auth: extractAuth(opts),
    from: opts.from,
    limit: opts.limit,
  });
  const filters = {
    eventTypes: opts.eventType
      ?.split(",")
      .map((type: string) => type.trim())
      .filter(Boolean),
    section: opts.section,
    text: opts.text,
  };
  if (opts.format === "json") {
    console.log(
      JSON.stringify(
        {
          ...report,
          view: {
            filters,
            pages: report.pages.map((p) => ({
              sourceKey: p.source.key,
              entries: filterReviewEntries(p.entries, filters),
            })),
          },
        },
        null,
        2,
      ),
    );
  } else console.log(renderReview(report, filters, opts.stateDir));
  if (report.pages.some((p) => p.status === "error" || p.status === "incomplete")) process.exitCode = 2;
});

// ── claim ──
const claimCmd = program
  .command("claim <page>")
  .description("track a specific claim across revisions")
  .option("-t, --text <text>", "claim text to track (required)")
  .option("--limit <n>", "max revisions to fetch (default: 50, or the whole range with --from and --to)", parseInt)
  .option("--from <revId>", "start revision ID", parseInt)
  .option("--to <revId>", "end revision ID", parseInt)
  .option("-c, --cache", "cache revisions in SQLite; needs Bun and a source checkout");
withGlobal(claimCmd);
claimCmd.action(async (page, opts) => {
  const claimText = opts.text as string | undefined;
  if (!claimText) {
    console.error(red("Error: --text is required"));
    process.exit(1);
  }
  await runClaim(
    page,
    claimText,
    !!opts.cache,
    opts.api as string | undefined,
    opts.cacheDir as string | undefined,
    extractAuth(opts),
    opts.limit as number | undefined,
    { from: opts.from as number | undefined, to: opts.to as number | undefined },
  );
});

// ── snapshot ──
const snapshotCmd = program
  .command("snapshot <page>")
  .description("reconstruct page state at a point in time")
  .option("--at <date>", "target date (ISO 8601, e.g. 2024-01-15)", new Date().toISOString().slice(0, 10))
  .option("--revision-limit <n>", "max revisions to fetch (default: 500)", parseInt)
  .option("-c, --cache", "cache revisions in SQLite; needs Bun and a source checkout");
withGlobal(snapshotCmd);
snapshotCmd.action(async (page, opts) => {
  await runSnapshot(
    page,
    opts.at as string,
    !!opts.cache,
    opts.api as string | undefined,
    opts.cacheDir as string | undefined,
    extractAuth(opts),
    opts.revisionLimit as number | undefined,
  );
});

// ── export ──
const exportCmd = program
  .command("export <page>")
  .description("export analysis as structured data")
  .option("-f, --format <format>", "output format: json, csv, ndjson, html, parquet", "json")
  .option("--bundle", "export as evidence bundle with a SHA-256 hash of its contents")
  .option("--manifest", "export as replay manifest listing all hashes")
  .option("--proof", "export as self-contained verification bundle with Merkle proofs")
  .option("--from <revId>", "start revision ID", parseInt)
  .option("--to <revId>", "end revision ID", parseInt)
  .option("--since <timestamp>", "re-observe from ISO timestamp")
  .option("--flatten", "flatten nested fields into flat columns (for csv format)");
withGlobal(exportCmd);
withAnalyzerConfig(exportCmd);
exportCmd.action(async (page, opts) => {
  const config = buildConfig(opts);
  await runExport(
    page,
    opts.format as string,
    opts.api as string | undefined,
    !!opts.bundle,
    extractAuth(opts),
    !!opts.manifest,
    config,
    !!opts.flatten,
    !!opts.proof,
    opts.from as number | undefined,
    opts.to as number | undefined,
    opts.since as string | undefined,
  );
});

// ── verify ──
const verifyCmd = program
  .command("verify <bundlePath>")
  .description("check a verification bundle's events, manifest hash, Merkle root and inclusion proofs")
  .option("--html <outPath>", "also write the result as an HTML receipt");
verifyCmd.action(async (bundlePath, opts) => {
  await runVerify(bundlePath, opts.html as string | undefined);
});

// ── delegation ──
// The operator supplies every judgment: what the receiving system calls this,
// what assumption is at stake, and which events count. None has a default.
const delegationCmd = program
  .command("delegation <page>")
  .description("write STD-07 discrepancy records for another system to read")
  .requiredOption("--subject <id>", "what the receiving system calls the thing this is about")
  .requiredOption("--expected <clause>", "the assumption these changes would violate")
  .requiredOption("--when <rule>", `which events count: ${Object.keys(WHEN_RULES).join(", ")}`)
  .option("-s, --section <name>", "only events in this section")
  .option("-o, --out <file>", "write to a file instead of stdout");
withGlobal(delegationCmd);
withAnalyzerConfig(delegationCmd);
delegationCmd.action(async (page, opts) => {
  try {
    await runDelegation(page, {
      subject: opts.subject as string,
      expected: opts.expected as string,
      when: opts.when as string,
      section: opts.section as string | undefined,
      out: opts.out as string | undefined,
      apiUrl: opts.api as string | undefined,
      auth: extractAuth(opts),
      config: buildConfig(opts),
    });
  } catch (error) {
    if (error instanceof DelegationInputError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
});

// ── watch ──
const watchCmd = program
  .command("watch <page>")
  .description("live polling daemon for new edits")
  .option("-s, --section <name>", "watch a specific section only")
  .option("-i, --interval <ms>", "poll interval in ms (default: 60000)", parseInt);
withGlobal(watchCmd);
watchCmd.action(async (page, opts) => {
  await runWatch(
    page,
    opts.section as string | undefined,
    opts.api as string | undefined,
    opts.interval as number | undefined,
    extractAuth(opts),
  );
});

// ── stream ──
const streamCmd = program
  .command("stream [page]")
  .description("live stream of Wikipedia edits via EventStreams")
  .option("--wiki <wiki>", "wiki to stream (e.g., enwiki, dewiki)", "enwiki");
withGlobal(streamCmd);
streamCmd.action(async (page, opts) => {
  await runStream(page as string | undefined, opts.wiki as string | undefined);
});

// ── cron ──
const cronCmd = program
  .command("cron <pages-file>")
  .description("one-shot re-observation for cron (exits 1 if new events detected)")
  .option("-i, --interval <hours>", "lookback window in hours (default: from last observation)", parseInt)
  .option("--notify-slack", "send Slack notification on changes (requires SLACK_WEBHOOK_URL env)")
  .option("--notify-email", "send email notification on changes (requires SMTP_TO env)")
  .option("--notify-webhook <url>", "send generic webhook POST on changes");
withGlobal(cronCmd);
cronCmd.action(async (pagesFile, opts) => {
  const notifyConfig = {
    slack: !!opts.notifySlack,
    email: !!opts.notifyEmail,
    webhookUrl: opts.notifyWebhook as string | undefined,
  };
  const hasNotify = notifyConfig.slack || notifyConfig.email || notifyConfig.webhookUrl;

  const result = await runCron(
    pagesFile,
    opts.interval as number | undefined,
    opts.api as string | undefined,
    opts.cacheDir as string | undefined,
    hasNotify ? notifyConfig : undefined,
    extractAuth(opts),
  );
  if (result.totalNewEvents > 0) {
    process.exit(1);
  }
});

// ── visualize ──
const visualizeCmd = program
  .command("visualize <page>")
  .description("export evidence graph as Mermaid or DOT diagram")
  .option("-f, --format <format>", "output format: mermaid, dot", "mermaid")
  .option("--all", "show all event types (default: claim events only)");
withGlobal(visualizeCmd);
visualizeCmd.action(async (page, opts) => {
  await runVisualize(page, opts.format as string, !!opts.all, opts.api as string | undefined, extractAuth(opts));
});

// ── explore ──
const exploreCmd = program
  .command("explore <page>")
  .description("start local web explorer with timeline, evidence table, and diff viewer")
  .option("-p, --port <n>", "server port (default: 8899)", parseInt)
  .option("--no-open", "don't open browser automatically")
  .option("--from <revId>", "start revision ID", Number)
  .option("--to <revId>", "end revision ID", Number)
  .option("--since <timestamp>", "start timestamp")
  .option("--depth <depth>", "brief, detailed, forensic", "detailed")
  .option("-c, --cache", "reuse a continuous fixed range from the local cache; needs Bun and a source checkout");
withGlobal(exploreCmd);
withAnalyzerConfig(exploreCmd);
exploreCmd.action(async (page, opts) => {
  const config = buildConfig(opts);
  await runExplore(
    page,
    opts.port ?? 8899,
    opts.open === false,
    opts.api as string | undefined,
    extractAuth(opts),
    config,
    !!opts.cache,
    opts.depth,
    opts.since,
    { fromRevId: opts.from, toRevId: opts.to, cacheDir: opts.cacheDir },
  );
});

// ── diff ──
const diffCmd = program
  .command("diff <topic>")
  .description("cross-wiki comparison of the same topic (2+ wikis)")
  .requiredOption("--wiki-a <url>", "first wiki API URL")
  .requiredOption("--wiki-b <url>", "second wiki API URL")
  .option("--wiki-c <url>", "third wiki API URL (optional)")
  .option("--wiki-d <url>", "fourth wiki API URL (optional)")
  .option("--wiki-e <url>", "fifth wiki API URL (optional)")
  .option("--wiki-f <url>", "sixth wiki API URL (optional)")
  .option("-d, --depth <depth>", "analysis depth: brief, detailed, forensic", "detailed")
  .option("--detect-borrowing", "detect verbatim text borrowing and n-gram shingle similarity between wikis");
diffCmd.action(async (topic, opts) => {
  const wikiUrls = [
    opts.wikiA as string,
    opts.wikiB as string,
    ...(opts.wikiC ? [opts.wikiC as string] : []),
    ...(opts.wikiD ? [opts.wikiD as string] : []),
    ...(opts.wikiE ? [opts.wikiE as string] : []),
    ...(opts.wikiF ? [opts.wikiF as string] : []),
  ];

  const result = await runDiff(topic, wikiUrls, opts.depth as string, {
    detectBorrowing: !!opts.detectBorrowing,
  });
  printUserFacingDiff(result);
});

function printUserFacingDiff(result: DiffResult): void {
  const { wikis, comparison, outliers, pairwiseBorrowing } = result;
  const labels =
    wikis.length <= 26 ? wikis.map((_, i) => String.fromCharCode(65 + i)) : wikis.map((_, i) => `W${i + 1}`);

  console.log(heading(`Cross-Wiki Diff: "${result.pageTitle}"`));
  for (let i = 0; i < wikis.length; i++) {
    const net = wikis[i].citationNetwork;
    const hhiStr = net
      ? ` (HHI: ${net.sourceConcentrationIndex}${net.isHighConcentration ? " [concentrated]" : ""})`
      : "";
    console.log(`  ${bold(`Wiki ${labels[i]}:`)} ${dim(wikis[i].url)}${hhiStr}`);
  }
  console.log();

  console.log(bold("── Overview ──"));
  console.log(
    `  ${"Total events".padEnd(14)} ${comparison.totalEvents.map((n) => cyan(String(n).padStart(6))).join(" ")}`,
  );
  console.log(`  ${"Sections".padEnd(14)} ${comparison.totalSections.map((n) => String(n).padStart(6)).join(" ")}`);
  console.log(`  ${"Citations".padEnd(14)} ${wikis.map((w) => String(w.summary.citations).padStart(6)).join(" ")}`);
  console.log(`  ${"Templates".padEnd(14)} ${wikis.map((w) => String(w.summary.templates).padStart(6)).join(" ")}`);
  console.log(`  ${"Reverts".padEnd(14)} ${wikis.map((w) => String(w.summary.reverts).padStart(6)).join(" ")}`);
  console.log(`  ${"Categories".padEnd(14)} ${wikis.map((w) => String(w.summary.categories).padStart(6)).join(" ")}`);
  console.log(`  ${"Wikilinks".padEnd(14)} ${wikis.map((w) => String(w.summary.wikilinks).padStart(6)).join(" ")}`);

  if (pairwiseBorrowing && pairwiseBorrowing.length > 0) {
    console.log(bold("\n── Cross-Wiki Text Propagation & Borrowing ──"));
    for (const b of pairwiseBorrowing) {
      const p = b.propagation;
      const pct = (p.jaccardSimilarity * 100).toFixed(1);
      const flag = p.isSignificantBorrowing ? red(" [SIGNIFICANT BORROWING]") : "";
      console.log(
        `  Wikis ${b.sourceWikiLabel} ↔ ${b.targetWikiLabel}: ${cyan(`${pct}%`)} Jaccard similarity (${p.sharedTokenCount} shared tokens, ${p.borrowedSpans.length} spans)${flag}`,
      );
    }
  }

  if (comparison.eventTypeDiffs.length > 0) {
    console.log(bold("\n── Event Type Breakdown ──"));
    const headerLabels = labels.map((l) => l.padStart(5));
    console.log(`  ${"Event Type".padEnd(28)} ${headerLabels.join(" ")}`);
    console.log(`  ${"─".repeat(28)} ${"─".repeat(6 * labels.length - 1)}`);
    for (const d of comparison.eventTypeDiffs) {
      const label = d.eventType.padEnd(28);
      const values = d.counts.map((c, i) => {
        const str = String(c).padStart(5);
        const baselineZero = i === 0;
        if (!baselineZero && c !== d.counts[0]) {
          return c > d.counts[0] ? green(str) : red(str);
        }
        return str;
      });
      console.log(`  ${label} ${values.join(" ")}`);
    }
  }

  if (outliers.length > 0) {
    console.log(bold("\n── Outliers (|z-score| > 2) ──"));
    for (const o of outliers) {
      const sign = o.zScore > 0 ? "+" : "";
      console.log(
        `  Wiki ${o.wikiLabel}: ${o.eventType} = ${cyan(String(o.count))} (mean=${o.mean}, z=${sign}${o.zScore})`,
      );
    }
  }
}

// ── eval ──
const evalCmd = program
  .command("eval")
  .description("run evaluation harness against benchmark pages or ground truth")
  .option("--page <title>", "run only benchmarks for a specific page")
  .option("--ground-truth <path|builtin>", "validate against L3 ground truth labels");
evalCmd.action(async (opts) => {
  await runEval(opts.page as string | undefined, opts.groundTruth as string | undefined);
});

// ── classify ──
program
  .command("classify")
  .addArgument(new Argument("<boundary>", "observation boundary to classify").choices(INFERENCE_BOUNDARIES))
  .description("classify a single observation boundary using its default rule or an inference provider")
  .option("--input <json>", 'input data as JSON string (e.g. \'{"comment": "revert vandalism"}\')')
  .option("--api-key <key>", "API key for inference provider")
  .option("--endpoint <url>", "inference provider endpoint URL (OpenAI-compatible)")
  .option("--model <name>", "model name (default: gpt-4o-mini)")
  .action(async (boundary, opts) => {
    const input = opts.input ? JSON.parse(opts.input as string) : {};
    const provider = new OpenAICompatibleProvider({
      apiKey: (opts.apiKey as string) || process.env.REFRACT_INFERENCE_API_KEY,
      endpoint: (opts.endpoint as string) || process.env.REFRACT_INFERENCE_ENDPOINT,
      model: (opts.model as string) || process.env.REFRACT_INFERENCE_MODEL,
    });
    const result = await provider.infer(boundary as InferenceBoundary, input);
    console.log(JSON.stringify(result, null, 2));
  });

// ── mcp ──
program
  .command("mcp")
  .description("start MCP server for AI agent integration (stdio JSON-RPC)")
  .action(async () => {
    try {
      await runMcpServer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Fatal MCP error: ${message}\n`);
      process.exit(1);
    }
  });

export async function cli(args: string[]): Promise<void> {
  if (args.length === 0) {
    program.outputHelp();
    return;
  }
  await program.parseAsync(args, { from: "user" });
}
