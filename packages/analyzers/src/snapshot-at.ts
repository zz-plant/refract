import { stripLead, stripSection, stripWikitext } from "./wikitext-parser.js";

/** What snapshotAt needs to know of each revision near the date. A client's revision metadata fits. */
export interface SnapshotRevision {
  revId: number;
  timestamp: string;
  /** MediaWiki's digest of the revision's text; absent when the text is suppressed. Reverted states are found from it. */
  sha1?: string;
}

/** The two reads snapshotAt makes, supplied by the caller so the library reads no network. */
export interface SnapshotFetchers<R extends SnapshotRevision> {
  /**
   * The revisions around a moment: up to `around` at or before it, the
   * revision live then among them, and up to `around` after it, in any order.
   * A client's `revisionAt(title, isoDateTime, { around })` fits once its
   * revisions are listed together.
   */
  revisionsAround(title: string, isoDateTime: string, options: { around: number }): Promise<readonly R[]>;
  /**
   * One revision's wikitext, or null when it is hidden. `section: 0` asks for
   * the lead only, which a client that reads sections can honour to fetch
   * less; returning the whole page instead gives the same result.
   */
  fetchContent(revisionId: number, options: { section?: number }): Promise<string | null>;
}

export type SnapshotScope = "lead" | "section" | "full";

export interface SnapshotAtOptions<R extends SnapshotRevision> {
  /** The text to return: the lead, one section (with `section`), or the whole page. Default `full`. */
  scope?: SnapshotScope;
  /** The heading, for `scope: "section"`. Matched as stripSection matches it. */
  section?: string;
  /**
   * Step back past a reverted state: a revision that a later edit undid by
   * restoring the text before it, within `windowHours` (default 48) of the
   * first undone edit. On by default; `false` reports the revision live at
   * the cutoff whatever happened to it.
   */
  excludeRevertedStates?: boolean | { windowHours?: number };
  /**
   * Revisions read on each side of the cutoff. Default 10. A reverted state
   * is only seen when both the revision whose text came back and the
   * revision that brought it back are among them.
   */
  around?: number;
  /**
   * Finds the reverted states among the revisions read, in place of the
   * built-in rule, exact restorations by `sha1`. `findRevertedStates` in
   * `@refract-org/ingestion` fits, and adds damage repaired by hand (its
   * near-restorations, which need each revision's `size`); pass it to have
   * snapshots agree with longitudinal sampling.
   */
  revertedStates?: (revisions: readonly R[], windowHours: number) => ReadonlySet<number>;
}

export interface DatedSnapshot<R extends SnapshotRevision> {
  title: string;
  /** The date as given. */
  date: string;
  /** The moment read: the end of the day for a date, 23:59:59 UTC, or the timestamp given. */
  cutoff: string;
  scope: SnapshotScope;
  section?: string;
  /** The revision reported: the latest at or before the cutoff that is not a reverted state. */
  revision: R;
  revisionId: number;
  timestamp: string;
  /** Revisions live at the cutoff that were stepped past as reverted states, newest first. Empty when none was. */
  skipped: R[];
  /** The revision after them that put this revision's text back, when it is among those read. */
  restoredBy?: R;
  /**
   * True when every revision read at or before the cutoff is a reverted
   * state, so the live one is reported unskipped: read more with `around`.
   * The built-in rule never gives this, since the text a restoration brings
   * back is itself read; a `revertedStates` rule with other evidence can.
   */
  revertedStateUnresolved?: boolean;
  /** The revision's wikitext as fetched (the lead only, for `lead`, from a client that honours `section: 0`); null when hidden. */
  wikitext: string | null;
  /** The scope's prose, stripped as stripWikitext strips a page; null when the text is hidden or the section is not on the page. */
  text: string | null;
}

const DEFAULT_WINDOW_HOURS = 48;

/** The moment a snapshot reads: the end of a UTC day for "YYYY-MM-DD", else the ISO timestamp given (UTC when it names no zone). */
function cutoffOf(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(date);
  // Date.parse reads 2024-02-30 as 1 March, so the calendar date is checked on its own.
  const [year, month, day] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const real = match && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
  const time = !real
    ? Number.NaN
    : date.length === 10
      ? Date.parse(`${date}T23:59:59Z`)
      : Date.parse(match[4] ? date : `${date}Z`);
  if (Number.isNaN(time)) {
    throw new RangeError(
      `Invalid date: ${date}. Use ISO 8601, a date (2024-01-15) or a timestamp (2024-01-15T12:00:00Z).`,
    );
  }
  return new Date(time).toISOString().replace(".000Z", "Z");
}

/**
 * Exact restorations, the first rule of `findRevertedStates` in
 * `@refract-org/ingestion`: when a revision has the `sha1` of an earlier one that is not
 * directly before it, every revision between the two is a reverted state,
 * provided the first of them came no more than `windowHours` before the
 * restoration. Ingestion keeps its own copy because the boundary lets
 * analyzers import nothing from it.
 */
function exactRestorations<R extends SnapshotRevision>(sorted: readonly R[], windowHours: number): Set<number> {
  const windowMs = windowHours * 60 * 60 * 1000;
  const lastIndexBySha1 = new Map<string, number>();
  const reverted = new Set<number>();
  for (let j = 0; j < sorted.length; j++) {
    const sha1 = sorted[j].sha1;
    if (!sha1) continue;
    const k = lastIndexBySha1.get(sha1);
    if (k !== undefined && j - k >= 2) {
      const firstReverted = Date.parse(sorted[k + 1].timestamp);
      if (Date.parse(sorted[j].timestamp) - firstReverted <= windowMs) {
        for (let r = k + 1; r < j; r++) reverted.add(sorted[r].revId);
      }
    }
    lastIndexBySha1.set(sha1, j);
  }
  return reverted;
}

/**
 * What a page said at the end of a date: the latest revision at or before
 * it, stepping back past a reverted state, and the lead, one section or the
 * whole page as prose. Null when no revision exists at or before the cutoff.
 *
 * A date such as "2024-01-15" reads the end of that UTC day, so an edit made
 * that afternoon counts; a timestamp reads that moment. The revisions around
 * the cutoff are read once, with their `sha1`. When the one live at the
 * cutoff is a reverted state, as vandalism undone the next morning is, the
 * snapshot reports the latest earlier revision that is not, and lists the
 * revisions it stepped past in `skipped`. A section is looked up by its
 * heading in the reported revision's own text, so a heading renamed later is
 * found under the name it had then.
 *
 * Reads no network itself: `fetchers` supply the revisions and the text.
 */
export async function snapshotAt<R extends SnapshotRevision>(
  fetchers: SnapshotFetchers<R>,
  title: string,
  date: string,
  options: SnapshotAtOptions<R> = {},
): Promise<DatedSnapshot<R> | null> {
  const scope = options.scope ?? "full";
  if (scope === "section" && !options.section?.trim()) throw new TypeError('scope "section" needs a section heading.');
  const cutoff = cutoffOf(date);
  const around = options.around ?? 10;
  if (!Number.isSafeInteger(around) || around < 1) throw new RangeError("around must be a positive integer.");

  const byId = new Map<number, R>();
  for (const revision of await fetchers.revisionsAround(title, cutoff, { around })) byId.set(revision.revId, revision);
  const sorted = [...byId.values()].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.revId - b.revId,
  );
  const cutoffTime = Date.parse(cutoff);
  const live = sorted.filter((r) => Date.parse(r.timestamp) <= cutoffTime);
  if (live.length === 0) return null;

  const exclude = options.excludeRevertedStates ?? true;
  const windowHours = (typeof exclude === "object" ? exclude.windowHours : undefined) ?? DEFAULT_WINDOW_HOURS;
  const reverted =
    exclude === false ? new Set<number>() : (options.revertedStates ?? exactRestorations)(sorted, windowHours);
  let chosenAt = live.length - 1;
  while (chosenAt >= 0 && reverted.has(live[chosenAt].revId)) chosenAt--;
  const unresolved = chosenAt < 0;
  if (unresolved) chosenAt = live.length - 1;
  const revision = live[chosenAt];
  const skipped = unresolved ? [] : live.slice(chosenAt + 1).reverse();
  const restoredBy =
    skipped.length > 0 && revision.sha1
      ? sorted.slice(sorted.indexOf(skipped[0]) + 1).find((r) => r.sha1 === revision.sha1)
      : undefined;

  const wikitext = await fetchers.fetchContent(revision.revId, scope === "lead" ? { section: 0 } : {});
  const section = options.section?.trim();
  let text: string | null = null;
  if (wikitext !== null) {
    if (scope === "lead") text = stripLead(wikitext);
    else if (scope === "section") text = stripSection(wikitext, section as string);
    else text = stripWikitext(wikitext);
  }

  return {
    title,
    date,
    cutoff,
    scope,
    ...(scope === "section" ? { section } : {}),
    revision,
    revisionId: revision.revId,
    timestamp: revision.timestamp,
    skipped,
    ...(restoredBy ? { restoredBy } : {}),
    ...(unresolved ? { revertedStateUnresolved: true } : {}),
    wikitext,
    text,
  };
}
