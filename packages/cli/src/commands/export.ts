import { createHash } from "node:crypto";
import type { AnalyzerConfig, EvidenceEvent, PolicySignal, Report, Revision } from "@refract-org/evidence-graph";
import {
  createEventIdentity,
  createReplayManifest,
  createVerificationBundle,
  EVENT_SCHEMA_VERSION,
} from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { renderHtmlReport } from "../html-renderer.js";
import { REFRACT_VERSION } from "../version.js";
import { runAnalyze } from "./analyze.js";

interface EvidenceBundle {
  format: "refract-evidence-bundle/v1";
  generatedAt: string;
  pageTitle: string;
  revisionRange: { from: number; to: number };
  inputRevisions: Revision[];
  outputEvents: EvidenceEvent[];
  bundleHash: string;
}

export async function runExport(
  pageTitle: string,
  format: string,
  apiUrl?: string,
  bundle?: boolean,
  auth?: AuthConfig,
  manifest?: boolean,
  config?: AnalyzerConfig,
  flatten?: boolean,
  proof?: boolean,
  fromRev?: number,
  toRev?: number,
  since?: string,
): Promise<void> {
  if (proof) {
    const { events, revisions } = await runAnalyze(
      pageTitle,
      "detailed",
      fromRev,
      toRev,
      since,
      false,
      apiUrl,
      undefined,
      undefined,
      auth,
      config,
    );
    const proofBundle = createVerificationBundle({
      pageTitle,
      analyzerVersions: { refract: REFRACT_VERSION },
      revisions,
      events,
    });
    console.log(JSON.stringify(proofBundle, null, 2));
    return;
  }

  if (bundle) {
    const { events, revisions } = await runAnalyze(
      pageTitle,
      "detailed",
      fromRev,
      toRev,
      since,
      false,
      apiUrl,
      undefined,
      undefined,
      auth,
      config,
    );
    const bundleData = buildBundle(pageTitle, events, revisions);
    console.log(JSON.stringify(bundleData, null, 2));
    return;
  }

  if (manifest) {
    const { events, revisions } = await runAnalyze(
      pageTitle,
      "detailed",
      fromRev,
      toRev,
      since,
      false,
      apiUrl,
      undefined,
      undefined,
      auth,
      config,
    );
    const manifestData = createReplayManifest({
      pageTitle,
      analyzerVersions: { refract: REFRACT_VERSION },
      revisions,
      events,
    });
    console.log(JSON.stringify(manifestData, null, 2));
    return;
  }

  const { events, revisions } = await runAnalyze(
    pageTitle,
    "detailed",
    fromRev,
    toRev,
    since,
    false,
    apiUrl,
    undefined,
    undefined,
    auth,
    config,
  );

  if (format === "html") {
    process.stdout.write(renderHtmlReport(pageTitle, events, revisions));
    return;
  }

  if (events.length === 0) {
    // stderr, not stdout: stdout is the export. Printed there, this line became
    // a malformed first record of every empty NDJSON file redirected to disk.
    console.error("No events to export.");
    return;
  }

  if (format === "json") {
    const report = buildReport(pageTitle, events, revisions);
    console.log(JSON.stringify(report, null, 2));
  } else if (format === "csv") {
    console.log(flatten ? toFlatCSV(events) : toCSV(events));
  } else if (format === "ndjson") {
    for (const event of events) {
      console.log(
        JSON.stringify({
          ...event,
          eventId: event.eventId ?? createEventIdentity(event),
        }),
      );
    }
  } else if (format === "parquet") {
    // biome-ignore lint/suspicious/noExplicitAny: CJS interop — parquetjs-lite has no types
    const pkg: any = await import("parquetjs-lite");
    const mod = pkg.default ?? pkg;
    const { ParquetWriter, ParquetSchema } = mod;

    const rows = events.map(toFlatRow);
    const fields = Object.keys(rows[0] ?? {});
    const schemaFields: Record<string, { type: string }> = {};
    for (const field of fields) {
      const val = rows[0]?.[field];
      if (typeof val === "number") {
        schemaFields[field] = { type: "INT64" };
      } else if (typeof val === "boolean") {
        schemaFields[field] = { type: "BOOLEAN" };
      } else {
        schemaFields[field] = { type: "UTF8" };
      }
    }

    const schema = new ParquetSchema(schemaFields);
    const writer = await ParquetWriter.openStream(schema, process.stdout);
    for (const row of rows) {
      await writer.appendRow(row);
    }
    await writer.close();
    return;
  } else {
    console.log(JSON.stringify(events, null, 2));
  }
}

function buildBundle(pageTitle: string, events: EvidenceEvent[], revisions: Revision[]): EvidenceBundle {
  const from = revisions[0]?.revId ?? 0;
  const to = revisions[revisions.length - 1]?.revId ?? 0;

  const taggedEvents = events.map((e) => ({
    ...e,
    eventId: e.eventId ?? createEventIdentity(e),
  }));

  const bundle = {
    format: "refract-evidence-bundle/v1" as const,
    generatedAt: new Date().toISOString(),
    pageTitle,
    revisionRange: { from, to },
    inputRevisions: revisions,
    outputEvents: taggedEvents,
  };

  const bundleHash = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");

  return { ...bundle, bundleHash };
}

function buildReport(pageTitle: string, events: EvidenceEvent[], revisions: Revision[]): Report {
  // The range and revision counts describe the revisions analyzed. Deriving them
  // from events reported the event count as a revision count, and a range that
  // started at the first revision to *receive* an event.
  const revIds = revisions.map((r) => r.revId);
  let earliest = "";
  let latest = "";
  let observedCount = 0;
  let policyCount = 0;
  let modelCount = 0;

  for (const r of revisions) {
    if (!earliest || r.timestamp < earliest) earliest = r.timestamp;
    if (!latest || r.timestamp > latest) latest = r.timestamp;
  }

  for (const e of events) {
    observedCount++;
    if (e.layer === "policy_coded") policyCount++;
    if (e.modelInterpretation != null) modelCount++;
  }

  const layers: Report["layers"] = [
    { label: "observed", description: "Deterministic", events: observedCount, reproducible: true },
  ];
  if (policyCount > 0) {
    layers.push({
      label: "policy_coded",
      description: "Wikipedia policy signals",
      events: policyCount,
      reproducible: true,
    });
  }
  if (modelCount > 0) {
    layers.push({
      label: "model_interpretation",
      description: "Model-assisted semantic interpretation",
      events: modelCount,
      reproducible: false,
    });
  }

  const hasModel = modelCount > 0;

  return {
    pageTitle,
    pageId: revisions[0]?.pageId ?? 0,
    analyzedRevisionRange: {
      from: revIds.length > 0 ? Math.min(...revIds) : 0,
      to: revIds.length > 0 ? Math.max(...revIds) : 0,
    },
    generatedAt: new Date().toISOString(),
    depth: "detailed",
    layers,
    timeline: {
      totalRevisions: revisions.length,
      analyzedRevisions: revisions.length,
      dateRange: {
        start: earliest,
        end: latest,
      },
      events: events.map((e) => ({
        revisionId: e.toRevisionId,
        timestamp: e.timestamp,
        eventType: e.eventType,
        summary: e.deterministicFacts.map((f) => f.fact).join("; "),
        layer: e.modelInterpretation ? "model_interpretation" : e.layer,
      })),
    },
    claims: [],
    sources: [],
    policySignals: extractPolicySignals(events),
    caveats: hasModel
      ? ["Model-assisted interpretation applied — confidence scores are per-event and may vary between runs."]
      : ["Deterministic analysis only; no bounded labels applied."],
    phase: "Phase 1b",
  };
}

function extractPolicySignals(events: EvidenceEvent[]): PolicySignal[] {
  const signalMap = new Map<string, PolicySignal>();
  const sortedEvents = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const event of sortedEvents) {
    if (event.layer !== "policy_coded") continue;
    const signalFact = event.deterministicFacts.find((f) => f.fact === "policy_signal");
    if (!signalFact?.detail) continue;

    const parts = signalFact.detail.split(" ");
    const dimMatch = parts.find((p) => p.startsWith("dimension="));
    const sigMatch = parts.find((p) => p.startsWith("signal="));
    if (!dimMatch || !sigMatch) continue;

    const dimension = dimMatch.slice("dimension=".length);
    const signal = sigMatch.slice("signal=".length);
    const key = `${dimension}:${signal}`;

    const existing = signalMap.get(key);
    if (existing) {
      existing.lastSeenRevisionId = event.toRevisionId;
      existing.active = true;
    } else {
      signalMap.set(key, {
        dimension,
        signal,
        firstSeenRevisionId: event.toRevisionId,
        active: true,
      });
    }
  }

  return [...signalMap.values()];
}

function toCSV(events: EvidenceEvent[]): string {
  const header = "timestamp,eventType,fromRevisionId,toRevisionId,section,before,after,facts";
  const rows = events.map((e) => {
    const facts = e.deterministicFacts.map((f) => f.fact + (f.detail ? `:${f.detail}` : "")).join("; ");
    return [
      e.timestamp,
      e.eventType,
      e.fromRevisionId,
      e.toRevisionId,
      csvEscape(e.section),
      csvEscape(e.before.slice(0, 200)),
      csvEscape(e.after.slice(0, 200)),
      csvEscape(facts),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

function toFlatRow(e: EvidenceEvent): Record<string, string | number> {
  const fact = e.deterministicFacts[0];
  return {
    timestamp: e.timestamp,
    event_type: e.eventType,
    from_revision_id: e.fromRevisionId,
    to_revision_id: e.toRevisionId,
    section: e.section,
    event_id: e.eventId ?? createEventIdentity(e),
    schema_version: e.schemaVersion ?? EVENT_SCHEMA_VERSION,
    layer: e.layer,
    fact: fact?.fact ?? "",
    fact_detail: fact?.detail ?? "",
    analyzer_name: fact?.provenance?.analyzer ?? "",
    analyzer_version: fact?.provenance?.version ?? "",
    input_hashes: JSON.stringify(fact?.provenance?.inputHashes ?? []),
    parameters_json: JSON.stringify(fact?.provenance?.parameters ?? {}),
  };
}

function toFlatCSV(events: EvidenceEvent[]): string {
  const header = [
    "timestamp",
    "event_type",
    "from_revision_id",
    "to_revision_id",
    "section",
    "event_id",
    "schema_version",
    "layer",
    "fact",
    "fact_detail",
    "analyzer_name",
    "analyzer_version",
    "input_hashes",
    "parameters_json",
  ].join(",");

  const rows = events.map((e) => {
    const r = toFlatRow(e);
    return [
      r.timestamp,
      r.event_type,
      r.from_revision_id,
      r.to_revision_id,
      csvEscape(String(r.section)),
      r.event_id,
      r.schema_version,
      r.layer,
      csvEscape(String(r.fact)),
      csvEscape(String(r.fact_detail)),
      r.analyzer_name,
      r.analyzer_version,
      csvEscape(String(r.input_hashes)),
      csvEscape(String(r.parameters_json)),
    ].join(",");
  });

  return [header, ...rows].join("\n");
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
