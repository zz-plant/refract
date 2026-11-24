import { type DatedSnapshot, type SnapshotScope, snapshotAt } from "@refract-org/analyzers";
import type { Revision } from "@refract-org/evidence-graph";
import type { AuthConfig, RevisionMetadata } from "@refract-org/ingestion";
import { findRevertedStates, MediaWikiClient } from "@refract-org/ingestion";
import { saveRevisions } from "./cache.js";

/** A date or page that cannot produce a snapshot, as opposed to a failed fetch. */
export class SnapshotInputError extends Error {}

export interface Snapshot {
  pageTitle: string;
  at: string;
  /** The moment read: the end of the UTC day for a date, or the timestamp given. */
  cutoff: string;
  revisionId: number;
  pageId: number;
  timestamp: string;
  /** Days between the revision and the cutoff, to one decimal place. */
  daysBeforeTarget: number;
  minor: boolean;
  user?: string;
  size: number;
  comment: string;
  /** Revisions live at the cutoff that a later edit reverted, newest first, which this snapshot steps past. */
  skipped?: Array<{ revisionId: number; timestamp: string }>;
  /** The revision that put the reported text back after them. */
  restoredBy?: { revisionId: number; timestamp: string };
  sections: Array<{ level: number; name: string }>;
  wikitext: string;
  /** Plain text of the scope asked for: the lead, one section or the whole page. */
  text: string;
}

export interface SnapshotOptions {
  apiUrl?: string;
  auth?: AuthConfig;
  /** Revisions read on each side of the cutoff, to find reverted states. Default 10. */
  revisionLimit?: number;
  scope?: SnapshotScope;
  section?: string;
  /** Report the revision live at the cutoff even when a later edit reverted it. */
  keepReverted?: boolean;
}

/**
 * The page as it stood at the end of `atDate`, from `snapshotAt` in
 * `@refract-org/analyzers`: the latest revision at or before the cutoff,
 * stepping back past a state a later edit reverted or repaired within 48
 * hours (`findRevertedStates`, near-restorations included), with the text of
 * `options.scope`.
 */
export async function takeSnapshot(
  pageTitle: string,
  atDate: string,
  options: SnapshotOptions = {},
): Promise<{ snapshot: Snapshot; revisions: Revision[] }> {
  const { apiUrl, auth } = options;
  const client = new MediaWikiClient(apiUrl ? { apiUrl, auth } : auth ? { auth } : undefined);
  const fetched: Revision[] = [];
  // snapshotAt checks the date and options before its first read, so an error
  // thrown before then is about the input, not the wiki.
  let reading = false;
  const fetchers = {
    async revisionsAround(title: string, isoDateTime: string, { around }: { around: number }) {
      reading = true;
      const { before, revision, after } = await client.revisionAt(title, isoDateTime, { around });
      return [...before, ...(revision ? [revision] : []), ...after];
    },
    // The whole page, though the lead would do for `scope: "lead"`: the
    // section list and the cache both need it.
    async fetchContent(revisionId: number) {
      const [revision] = await client.fetchRevisionsByIds([revisionId]);
      if (!revision || revision.contentAvailable === false) return null;
      fetched.push(revision);
      return revision.content;
    },
  };
  let taken: DatedSnapshot<RevisionMetadata> | null;
  try {
    taken = await snapshotAt(fetchers, pageTitle, atDate, {
      scope: options.scope,
      section: options.section,
      around: options.revisionLimit,
      excludeRevertedStates: !options.keepReverted,
      revertedStates: findRevertedStates,
    });
  } catch (error) {
    if (!reading && error instanceof Error) throw new SnapshotInputError(error.message);
    throw error;
  }
  if (!taken) throw new SnapshotInputError(`No revision of "${pageTitle}" exists at or before ${atDate}.`);
  if (taken.wikitext === null) throw new SnapshotInputError(`The text of revision ${taken.revisionId} is hidden.`);
  if (taken.text === null) {
    throw new SnapshotInputError(`Revision ${taken.revisionId} has no section headed "${taken.section}".`);
  }
  const { revision } = taken;
  const ref = (r: RevisionMetadata) => ({ revisionId: r.revId, timestamp: r.timestamp });
  const delta = Date.parse(taken.cutoff) - Date.parse(revision.timestamp);
  return {
    snapshot: {
      pageTitle,
      at: atDate,
      cutoff: taken.cutoff,
      revisionId: revision.revId,
      pageId: revision.pageId,
      timestamp: revision.timestamp,
      daysBeforeTarget: Math.round((delta / (1000 * 60 * 60 * 24)) * 10) / 10,
      minor: revision.minor,
      ...(revision.user ? { user: revision.user } : {}),
      size: revision.size,
      comment: revision.comment,
      ...(taken.skipped.length > 0 ? { skipped: taken.skipped.map(ref) } : {}),
      ...(taken.restoredBy ? { restoredBy: ref(taken.restoredBy) } : {}),
      sections: headingLines(taken.wikitext),
      wikitext: taken.wikitext,
      text: taken.text,
    },
    revisions: fetched,
  };
}

export async function runSnapshot(
  pageTitle: string,
  atDate: string,
  useCache = false,
  apiUrl?: string,
  cacheDir?: string,
  auth?: AuthConfig,
  options: Pick<SnapshotOptions, "revisionLimit" | "scope" | "section" | "keepReverted"> = {},
): Promise<void> {
  let taken: Awaited<ReturnType<typeof takeSnapshot>>;
  try {
    taken = await takeSnapshot(pageTitle, atDate, { apiUrl, auth, ...options });
  } catch (error) {
    if (!(error instanceof SnapshotInputError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
  const { snapshot, revisions } = taken;

  console.log(`\nSnapshot of "${pageTitle}" at ${atDate}`);
  console.log(`Closest revision: ${snapshot.revisionId} (${snapshot.timestamp})`);
  if (snapshot.timestamp.slice(0, 10) !== atDate.slice(0, 10)) {
    console.log(`  (${snapshot.daysBeforeTarget} days before target date)`);
  }
  for (const skipped of snapshot.skipped ?? []) {
    const restored = snapshot.restoredBy ? `; rev ${snapshot.restoredBy.revisionId} restored the text` : "";
    console.log(`  Skipped rev ${skipped.revisionId} (${skipped.timestamp}): a later edit reverted it${restored}`);
  }
  console.log();

  console.log(`Sections (${snapshot.sections.length}):`);
  for (const { level, name } of snapshot.sections) {
    console.log(`${"  ".repeat(level - 1)}${name}`);
  }
  console.log();

  const plainText = snapshot.text;
  const lines = plainText.split("\n").filter((l) => l.trim().length > 0);
  if (options.scope === "lead" || options.scope === "section") {
    // The byte size is the page's, so it is left off a part of the page.
    console.log(`${options.scope === "lead" ? "Lead" : `Section "${options.section}"`} (${lines.length} text lines):`);
  } else {
    console.log(`Content (${snapshot.size.toLocaleString()} bytes, ${lines.length} text lines):`);
  }
  console.log();
  console.log(plainText.slice(0, 2000));
  if (plainText.length > 2000) {
    console.log(`\n... (${(plainText.length - 2000).toLocaleString()} more characters)`);
  }
  console.log();

  console.log(`Metadata:`);
  console.log(`  Revision:  ${snapshot.revisionId}`);
  console.log(`  Page ID:   ${snapshot.pageId}`);
  console.log(`  Timestamp: ${snapshot.timestamp}`);
  console.log(`  Minor:     ${snapshot.minor}`);
  if (snapshot.user) console.log(`  Editor:    ${snapshot.user}`);
  console.log(`  Size:      ${snapshot.size.toLocaleString()} bytes`);
  console.log(`  Comment:   ${snapshot.comment.slice(0, 200)}`);

  if (useCache && revisions.length > 0) {
    await saveRevisions(revisions, cacheDir);
  }
}

/**
 * Lines that open and close with "=", with the name between the runs of "=".
 * /^=+\s*(.+?)\s*=+$/gm split each line's whitespace between three quantifiers,
 * which took time cubic in its length; a line that is only "=" and spaces,
 * which that pattern printed as a section named "=", is skipped.
 */
export function headingLines(wikitext: string): Array<{ level: number; name: string }> {
  const headings: Array<{ level: number; name: string }> = [];
  for (const match of wikitext.matchAll(/^=.*$/gm)) {
    const line = match[0];
    if (!line.endsWith("=")) continue;
    let start = 0;
    while (line[start] === "=") start++;
    let end = line.length;
    while (end > start && line[end - 1] === "=") end--;
    const name = line.slice(start, end).trim();
    if (name) headings.push({ level: start, name });
  }
  return headings;
}
