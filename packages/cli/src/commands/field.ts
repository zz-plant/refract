import { sanitizeWikitext, templateTracker } from "@refract-org/analyzers";
import type { Revision } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { DEFAULT_BATCH_CONCURRENCY, forEachPage } from "./batch.js";
import { type ClaimRange, fetchRevisionRange } from "./claim.js";
import type { RevisionSourceSpec } from "./revision-source.js";

/**
 * One revision at which the field's value differed from the revision before it.
 * The change happened after `previousRevisionId` and at or before `revisionId`;
 * when `adjacent` is false, revisions that were not fetched lie between them and
 * the change could be in any of those.
 */
export interface FieldChange {
  revisionId: number;
  timestamp: string;
  /**
   * The fetched revision before this one with readable text. Absent on the first
   * revision read: a value reported `added` there may be older than the range.
   */
  previousRevisionId?: number;
  previousTimestamp?: string;
  /** True when `previousRevisionId` is this revision's parent, so no revision lies between them. */
  adjacent: boolean;
  /** The template the value was read from, as the page names it; absent when the field is gone. */
  template?: string;
  /** The parameter's wikitext, references and comments included; absent when the field is gone. */
  value?: string;
  /**
   * The value as prose: references, comments and link markup removed, list
   * templates such as {{blist}} reduced to their items, and other templates removed.
   */
  text?: string;
  /**
   * What changed: `added` and `removed` for the field appearing and going,
   * `text` when its prose changed, and `markup` when only its wikitext did,
   * such as a reference added or removed while the words stayed.
   */
  kind: "added" | "removed" | "text" | "markup";
  /** The prose returned to what it was at an earlier revision in this selection. */
  returnsToEarlierText: boolean;
}

export interface FieldHistoryResult {
  page: string;
  pageId?: number;
  param: string;
  template?: string;
  status: "present" | "absent" | "unknown";
  latestRevisionId?: number;
  latestValue?: string;
  latestText?: string;
  revisionsRead: number;
  changes: FieldChange[];
  /** Changes whose prose matched an earlier value: the back-and-forth of an edit war over the field. */
  returns: number;
  caveats: string[];
}

export interface FieldQuery {
  param: string;
  /** Read the parameter only from this template; any top-level template that has it otherwise. */
  template?: string;
}

// A module call such as {{#invoke:Infobox military conflict|main …}} is what
// the template of that name expands to, and pages that call the module
// directly pass it the same parameters, so it answers to that template's name.
function templateKey(name: string): string {
  return name
    .replace(/^\s*#invoke\s*:/i, "")
    .replace(/^\s*template\s*:/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The parameter's value in one revision's wikitext: from the named template,
 * or from the first top-level template in page order that has the parameter.
 * Names compare without regard to case, a module call {{#invoke:Name|…}}
 * answers to the template name Name, and a parameter left empty counts as
 * absent, as diffTemplateParams treats it.
 */
export function readField(
  wikitext: string,
  query: FieldQuery,
): { template: string; value: string; others: string[] } | undefined {
  const param = query.param.trim().toLowerCase();
  const wanted = query.template ? templateKey(query.template) : undefined;
  const carriers: { template: string; value: string }[] = [];
  for (const template of templateTracker.extractTemplates(wikitext)) {
    if (wanted !== undefined && templateKey(template.name) !== wanted) continue;
    for (const [key, value] of Object.entries(template.params ?? {})) {
      if (key.trim().toLowerCase() === param && value.trim() !== "") {
        carriers.push({ template: template.name, value: value.trim() });
        break;
      }
    }
  }
  if (carriers.length === 0) return undefined;
  return { ...carriers[0], others: carriers.slice(1).map((c) => c.template) };
}

export function fieldHistory(pageTitle: string, revisions: Revision[], query: FieldQuery): FieldHistoryResult {
  if (!query.param.trim()) throw new Error("Supply a nonempty parameter name.");
  const revs = [...revisions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const caveats = [
    `Values are read from ${revs.length} fetched revisions, not the page's entire history.`,
    "A value is the parameter's wikitext as the page stored it; Refract does not evaluate whether it is correct.",
  ];
  const base: FieldHistoryResult = {
    page: pageTitle,
    pageId: revs[0]?.pageId,
    param: query.param,
    template: query.template,
    status: "absent",
    revisionsRead: revs.length,
    changes: [],
    returns: 0,
    caveats,
  };
  if (revs.length === 0) return base;

  const changes: FieldChange[] = [];
  const seenTexts = new Set<string>();
  let previous: { value: string; text: string } | undefined;
  const sharedWith = new Set<string>();
  let unavailable = 0;
  let latestReadable = true;
  let priorReadable: Revision | undefined;

  for (const rev of revs) {
    if (rev.contentAvailable === false) {
      unavailable++;
      latestReadable = false;
      continue;
    }
    latestReadable = true;
    // Taken before any `continue` below, so every readable revision becomes the next one's prior.
    const before = priorReadable;
    priorReadable = rev;
    const between = {
      ...(before ? { previousRevisionId: before.revId, previousTimestamp: before.timestamp } : {}),
      adjacent: before !== undefined && rev.parentId === before.revId,
    };
    const found = readField(rev.content, query);
    for (const other of found?.others ?? []) sharedWith.add(other);
    if (!found) {
      if (previous) {
        changes.push({
          revisionId: rev.revId,
          timestamp: rev.timestamp,
          ...between,
          kind: "removed",
          returnsToEarlierText: false,
        });
        previous = undefined;
      }
      continue;
    }
    const text = sanitizeWikitext(found.value);
    if (previous && previous.value === found.value) continue;
    const kind: FieldChange["kind"] = !previous ? "added" : previous.text === text ? "markup" : "text";
    const returnsToEarlierText = kind !== "markup" && seenTexts.has(text) && previous?.text !== text;
    changes.push({
      revisionId: rev.revId,
      timestamp: rev.timestamp,
      ...between,
      template: found.template,
      value: found.value,
      text,
      kind,
      returnsToEarlierText,
    });
    seenTexts.add(text);
    previous = { value: found.value, text };
  }

  if (unavailable > 0) caveats.push(`${unavailable} revision(s) had their text withheld and were skipped.`);
  if (sharedWith.size > 0 && !query.template) {
    caveats.push(
      `Other templates on the page also have "${query.param}" (${[...sharedWith].join(", ")}); values were read from the first in page order. Name one with --template.`,
    );
  }

  const latest = revs.at(-1) as Revision;
  return {
    ...base,
    status: !latestReadable ? "unknown" : previous ? "present" : "absent",
    latestRevisionId: latest.revId,
    latestValue: previous?.value,
    latestText: previous?.text,
    changes,
    returns: changes.filter((c) => c.returnsToEarlierText).length,
  };
}

export async function runFieldHistory(
  pageTitle: string,
  query: FieldQuery,
  apiUrl?: string,
  auth?: AuthConfig,
  revisionLimit?: number,
  range: ClaimRange = {},
): Promise<FieldHistoryResult> {
  if (!query.param.trim()) throw new Error("Supply a nonempty parameter name.");
  const revisions = await fetchRevisionRange(pageTitle, range, revisionLimit, apiUrl, auth);
  return fieldHistory(pageTitle, revisions, query);
}

export async function runField(
  pageTitle: string,
  query: FieldQuery,
  apiUrl?: string,
  auth?: AuthConfig,
  revisionLimit?: number,
  range?: ClaimRange,
  output: { json?: boolean } = {},
): Promise<void> {
  const result = await runFieldHistory(pageTitle, query, apiUrl, auth, revisionLimit, range);
  if (output.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const where = query.template ? `${query.template} | ${query.param}` : query.param;
  console.log(`Tracking field "${where}" in "${pageTitle}" across ${result.revisionsRead} revisions\n`);
  for (const change of result.changes) {
    const label = change.kind.toUpperCase().padEnd(7);
    const back = change.returnsToEarlierText ? "  (returns to an earlier value)" : "";
    const shown = change.kind === "removed" ? "(field removed)" : `"${change.text}"`;
    const gap = change.previousRevisionId !== undefined && !change.adjacent ? "  (not adjacent)" : "";
    console.log(`[${change.timestamp}] ${label} rev ${change.revisionId}  ${shown}${back}${gap}`);
    if (change.kind === "markup") console.log(`  wikitext: ${change.value}`);
  }
  console.log(`\nStatus:        ${result.status}`);
  console.log(`Latest value:  ${result.latestText !== undefined ? `"${result.latestText}"` : "none"}`);
  console.log(`Changes:       ${result.changes.length} (${result.returns} back to an earlier value)`);
  for (const caveat of result.caveats) console.log(`Note: ${caveat}`);
}

/**
 * Track one field across every page in `titles`, reporting pages in the order
 * given. With `json`, each page is one line of NDJSON: its result, or
 * `{ page, status: "error", error }` when it could not be read. Text output is
 * one line per page. Resolves with how many pages failed.
 */
export async function runFieldBatch(
  titles: readonly string[],
  query: FieldQuery,
  apiUrl?: string,
  auth?: AuthConfig,
  revisionLimit?: number,
  concurrency = DEFAULT_BATCH_CONCURRENCY,
  output: { json?: boolean; write?: (line: string) => void } = {},
  source?: RevisionSourceSpec,
): Promise<{ failed: number }> {
  if (!query.param.trim()) throw new Error("Supply a nonempty parameter name.");
  const write = output.write ?? ((line: string) => console.log(line));
  if (!output.json) write(`Tracking field "${query.param}" across ${titles.length} pages\n`);
  const { failed } = await forEachPage(
    titles,
    concurrency,
    (title) => runFieldHistory(title, query, apiUrl, auth, revisionLimit, { source }),
    ({ title, result, error }) => {
      if (!result) {
        if (output.json) write(JSON.stringify({ page: title, status: "error", error }));
        else write(`${"error".padEnd(8)} ${title}: ${error}`);
        return;
      }
      if (output.json) {
        write(JSON.stringify(result));
        return;
      }
      const latest = result.latestText !== undefined ? `"${result.latestText}"` : "none";
      write(
        `${result.status.padEnd(8)} ${title}: ${latest}; ${result.changes.length} changes, ${result.returns} back to an earlier value`,
      );
    },
  );
  return { failed };
}
