import { stripWikitext } from "@refract-org/analyzers";
import type { Revision } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { MediaWikiClient } from "@refract-org/ingestion";
import { saveRevisions } from "./cache.js";

/** A date or page that cannot produce a snapshot, as opposed to a failed fetch. */
export class SnapshotInputError extends Error {}

export interface Snapshot {
  pageTitle: string;
  at: string;
  revisionId: number;
  pageId: number;
  timestamp: string;
  /** Days between the revision and the requested date, to one decimal place. */
  daysBeforeTarget: number;
  minor: boolean;
  user?: string;
  size: number;
  comment: string;
  sections: Array<{ level: number; name: string }>;
  wikitext: string;
}

/** The revision live at `atDate`: the newest one at or before it. */
export async function takeSnapshot(
  pageTitle: string,
  atDate: string,
  options: { apiUrl?: string; auth?: AuthConfig; revisionLimit?: number } = {},
): Promise<{ snapshot: Snapshot; revisions: Revision[] }> {
  const target = new Date(atDate);
  if (Number.isNaN(target.getTime())) {
    throw new SnapshotInputError(`Invalid date: ${atDate}. Use ISO 8601 format (e.g., 2024-01-15).`);
  }
  const { apiUrl, auth } = options;
  const client = new MediaWikiClient(apiUrl ? { apiUrl, auth } : auth ? { auth } : undefined);
  // Revisions at or before the target, newest first. "newer" with a limit read
  // the page's first revisions, so any date past them snapped to the latest of
  // those instead of to the revision live on that date.
  const revisions = await client.fetchRevisions(pageTitle, {
    limit: options.revisionLimit ?? 500,
    direction: "older",
    start: target,
  });
  if (revisions.length === 0) {
    throw new SnapshotInputError(`No revision of "${pageTitle}" exists at or before ${atDate}.`);
  }

  let closest = revisions[0];
  let closestDelta = Infinity;

  for (const rev of revisions) {
    const revDate = new Date(rev.timestamp);
    const delta = Math.abs(revDate.getTime() - target.getTime());
    if (delta < closestDelta && revDate <= target) {
      closestDelta = delta;
      closest = rev;
    }
  }

  return {
    snapshot: {
      pageTitle,
      at: atDate,
      revisionId: closest.revId,
      pageId: closest.pageId,
      timestamp: closest.timestamp,
      daysBeforeTarget: Math.round((closestDelta / (1000 * 60 * 60 * 24)) * 10) / 10,
      minor: closest.minor,
      ...(closest.user ? { user: closest.user } : {}),
      size: closest.size,
      comment: closest.comment,
      sections: headingLines(closest.content),
      wikitext: closest.content,
    },
    revisions,
  };
}

export async function runSnapshot(
  pageTitle: string,
  atDate: string,
  useCache = false,
  apiUrl?: string,
  cacheDir?: string,
  auth?: AuthConfig,
  revisionLimit = 500,
): Promise<void> {
  let taken: Awaited<ReturnType<typeof takeSnapshot>>;
  try {
    taken = await takeSnapshot(pageTitle, atDate, { apiUrl, auth, revisionLimit });
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
  console.log();

  console.log(`Sections (${snapshot.sections.length}):`);
  for (const { level, name } of snapshot.sections) {
    console.log(`${"  ".repeat(level - 1)}${name}`);
  }
  console.log();

  const plainText = stripWikitext(snapshot.wikitext);
  const lines = plainText.split("\n").filter((l) => l.trim().length > 0);
  console.log(`Content (${snapshot.size.toLocaleString()} bytes, ${lines.length} text lines):`);
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
