import type { EvidenceEvent, Revision } from "@refract-org/evidence-graph";

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_ENTITY_API = "https://www.wikidata.org/wiki/Special:EntityData";

export interface WikidataEntity {
  qid: string;
  label: string;
  description: string;
  aliases: string[];
  instanceOf: string[];
  claims: Record<string, WikidataClaim>;
  /** Every statement, with its ID, rank, qualifiers and reference count. `claims` keeps only main values. */
  statements?: WikidataStatementRecord[];
}

/**
 * One Wikidata statement as the entity records it. `id` is Wikidata's
 * statement GUID, which stays the same when the statement's value, rank,
 * qualifiers or references are edited, so statements compare across entity
 * revisions by ID rather than by text.
 */
export interface WikidataStatementRecord {
  id: string;
  property: string;
  rank: "preferred" | "normal" | "deprecated";
  /** `somevalue` is an unknown value and `novalue` an asserted absence; only `value` carries `value`. */
  snaktype: "value" | "somevalue" | "novalue";
  value?: WikidataValue;
  /** Qualifier values by property, e.g. P580 (start time), P582 (end time), P585 (point in time). */
  qualifiers: Record<string, WikidataValue[]>;
  referenceCount: number;
}

export interface WikidataClaim {
  property: string;
  propertyLabel: string;
  values: WikidataValue[];
}

export interface WikidataValue {
  type: "wikibase-item" | "string" | "time" | "quantity" | "url";
  value: string;
  /** On a time: Wikidata's precision, 9 for a year, 10 for a month, 11 for a day. */
  precision?: number;
}

export interface PageToEntityMap {
  pageTitle: string;
  qid: string;
  entity?: WikidataEntity;
}

export async function fetchWikidataId(pageTitle: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "query",
    prop: "pageprops",
    titles: pageTitle,
    format: "json",
    origin: "*",
  });
  const url = `${WIKIPEDIA_API}?${params}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const data = (await res.json()) as WikipediaQueryResponse;
  const pages = data.query?.pages;
  if (!pages) return null;
  for (const id of Object.keys(pages)) {
    if (id === "-1") continue;
    return pages[id].pageprops?.wikibase_item ?? null;
  }
  return null;
}

/**
 * The entity `qid` as Wikidata serves it now, or as it stood at `revisionId`
 * (a revision of the entity's own page) when one is given. Null when the
 * request fails or the entity is missing.
 */
export async function fetchWikidataEntity(
  qid: string,
  options: { revisionId?: number } = {},
): Promise<WikidataEntity | null> {
  const query = options.revisionId !== undefined ? `?revision=${encodeURIComponent(String(options.revisionId))}` : "";
  const url = `${WIKIDATA_ENTITY_API}/${encodeURIComponent(qid)}.json${query}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const data = (await res.json()) as WikidataEntityResponse;
  const entity = data.entities?.[qid];
  if (!entity) return null;
  return parseWikidataEntity(qid, entity);
}

/**
 * An entity from Wikidata's JSON serialization: an `entities` member of
 * Special:EntityData, or the text of a revision of the entity's page.
 */
export function parseWikidataEntity(qid: string, entity: unknown): WikidataEntity {
  const data = (entity ?? {}) as WikidataEntityData;
  return {
    qid,
    label: data.labels?.en?.value ?? qid,
    description: data.descriptions?.en?.value ?? "",
    aliases: Object.values(data.aliases?.en ?? {}).map((a) => a.value),
    instanceOf: extractInstanceOf(data),
    claims: extractClaims(data),
    statements: extractStatements(data),
  };
}

/** How a statement differs between two states of an entity. */
export interface WikidataStatementChange {
  kind: "added" | "removed" | "changed";
  statementId: string;
  property: string;
  /** Which parts differ, on a change. */
  parts?: Array<"value" | "rank" | "qualifiers" | "references">;
  before?: WikidataStatementRecord;
  after?: WikidataStatementRecord;
}

/**
 * The statements added, removed and changed between two states of an entity,
 * matched by statement ID, in the order `after` lists them, then removals in
 * the order `before` lists them. A statement deleted and re-entered gets a new
 * ID, so it shows as one removal and one addition.
 */
export function diffWikidataStatements(
  before: readonly WikidataStatementRecord[],
  after: readonly WikidataStatementRecord[],
): WikidataStatementChange[] {
  const earlier = new Map(before.map((s) => [s.id, s]));
  const later = new Set(after.map((s) => s.id));
  const changes: WikidataStatementChange[] = [];
  for (const s of after) {
    const prior = earlier.get(s.id);
    if (!prior) {
      changes.push({ kind: "added", statementId: s.id, property: s.property, after: s });
      continue;
    }
    const parts: NonNullable<WikidataStatementChange["parts"]> = [];
    if (prior.snaktype !== s.snaktype || !sameValue(prior.value, s.value)) parts.push("value");
    if (prior.rank !== s.rank) parts.push("rank");
    if (!sameQualifiers(prior.qualifiers, s.qualifiers)) parts.push("qualifiers");
    if (prior.referenceCount !== s.referenceCount) parts.push("references");
    if (parts.length > 0)
      changes.push({ kind: "changed", statementId: s.id, property: s.property, parts, before: prior, after: s });
  }
  for (const s of before) {
    if (!later.has(s.id)) changes.push({ kind: "removed", statementId: s.id, property: s.property, before: s });
  }
  return changes;
}

/** A statement change, placed between the two entity revisions it lies between. */
export interface WikidataStatementTransition extends WikidataStatementChange {
  revisionId: number;
  timestamp: string;
  previousRevisionId: number;
  previousTimestamp: string;
  /** True when the previous revision is this one's parent, so no revision lies between them. */
  adjacent: boolean;
  editSummary: string;
}

export interface WikidataStatementHistory {
  qid: string;
  /** The earliest revision read: the baseline. Statements present there may be older than the range. */
  baselineRevisionId?: number;
  baselineTimestamp?: string;
  baseline: WikidataStatementRecord[];
  transitions: WikidataStatementTransition[];
  /** Revisions read, and revisions skipped because their text was withheld or was not an entity. */
  revisionsRead: number;
  revisionsSkipped: number[];
}

/**
 * Statement-level history of an entity from revisions of its page (on
 * Wikidata, the page titled with the QID): the statements at the earliest
 * revision, then each statement added, removed or changed between successive
 * readable revisions. `properties`, when given, keeps only those properties.
 * Coverage is the revisions given; a change between two of them that are not
 * adjacent could be in any revision between them.
 */
export function wikidataStatementHistory(
  qid: string,
  revisions: readonly Revision[],
  options: { properties?: readonly string[] } = {},
): WikidataStatementHistory {
  const keep = options.properties ? new Set(options.properties) : undefined;
  const ordered = [...revisions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const history: WikidataStatementHistory = {
    qid,
    baseline: [],
    transitions: [],
    revisionsRead: 0,
    revisionsSkipped: [],
  };
  let previous: { rev: Revision; statements: WikidataStatementRecord[] } | undefined;
  for (const rev of ordered) {
    let parsed: unknown;
    try {
      parsed = rev.contentAvailable === false ? undefined : JSON.parse(rev.content);
    } catch {
      parsed = undefined;
    }
    if (!parsed || typeof parsed !== "object" || !("claims" in parsed)) {
      history.revisionsSkipped.push(rev.revId);
      continue;
    }
    history.revisionsRead++;
    const statements = extractStatements(parsed as WikidataEntityData).filter((s) => !keep || keep.has(s.property));
    if (!previous) {
      history.baselineRevisionId = rev.revId;
      history.baselineTimestamp = rev.timestamp;
      history.baseline = statements;
    } else {
      for (const change of diffWikidataStatements(previous.statements, statements)) {
        history.transitions.push({
          ...change,
          revisionId: rev.revId,
          timestamp: rev.timestamp,
          previousRevisionId: previous.rev.revId,
          previousTimestamp: previous.rev.timestamp,
          adjacent: rev.parentId === previous.rev.revId,
          editSummary: rev.comment,
        });
      }
    }
    previous = { rev, statements };
  }
  return history;
}

function sameValue(a: WikidataValue | undefined, b: WikidataValue | undefined): boolean {
  return a?.type === b?.type && a?.value === b?.value && a?.precision === b?.precision;
}

function sameQualifiers(a: Record<string, WikidataValue[]>, b: Record<string, WikidataValue[]>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const x = a[key];
    const y = b[key];
    return y !== undefined && x.length === y.length && x.every((value, i) => sameValue(value, y[i]));
  });
}

export async function mapPageToEntity(pageTitle: string): Promise<PageToEntityMap> {
  const qid = await fetchWikidataId(pageTitle);
  if (!qid) return { pageTitle, qid: "" };
  const entity = await fetchWikidataEntity(qid);
  return { pageTitle, qid, entity: entity ?? undefined };
}

export async function mapPagesToEntities(pageTitles: string[], concurrency = 3): Promise<PageToEntityMap[]> {
  const results: PageToEntityMap[] = [];
  for (let i = 0; i < pageTitles.length; i += concurrency) {
    const batch = pageTitles.slice(i, i + concurrency);
    const mapped = await Promise.all(batch.map((title) => mapPageToEntity(title)));
    results.push(...mapped);
  }
  return results;
}

export function wikidataEntityToEvents(entity: WikidataEntity, _pageTitle: string): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];
  const props = Object.keys(entity.claims).join(", ");
  const instanceOf = entity.instanceOf.join(", ");

  events.push({
    eventType: "sentence_first_seen",
    fromRevisionId: 0,
    toRevisionId: 0,
    section: "",
    before: "",
    after: `Wikidata entity: ${entity.label}`,
    deterministicFacts: [{ fact: "wikidata_entity_linked", detail: `qid=${entity.qid} label=${entity.label}` }],
    layer: "observed",
    timestamp: new Date().toISOString(),
  });

  if (instanceOf) {
    events.push({
      eventType: "category_added",
      fromRevisionId: 0,
      toRevisionId: 0,
      section: "",
      before: "",
      after: instanceOf,
      deterministicFacts: [{ fact: "wikidata_instance_of", detail: `types=${instanceOf} properties=${props}` }],
      layer: "observed",
      timestamp: new Date().toISOString(),
    });
  }

  return events;
}

interface WikipediaQueryResponse {
  query?: {
    pages?: Record<string, { pageprops?: { wikibase_item?: string } }>;
  };
}

interface WikidataEntityData {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  aliases?: Record<string, Array<{ value: string }>>;
  claims?: Record<string, Array<WikidataStatement>>;
}

interface WikidataSnak {
  snaktype: string;
  property?: string;
  datavalue?: {
    type: string;
    value: unknown;
  };
  datatype?: string;
}

interface WikidataStatement {
  id?: string;
  rank?: string;
  mainsnak?: WikidataSnak;
  qualifiers?: Record<string, WikidataSnak[]>;
  references?: unknown[];
}

interface WikidataEntityResponse {
  entities?: Record<string, WikidataEntityData>;
}

function extractInstanceOf(entity: WikidataEntityData | undefined): string[] {
  return (entity?.claims?.P31 ?? []).flatMap((c) => {
    const value = snakValue(c.mainsnak);
    return value?.type === "wikibase-item" ? [value.value] : [];
  });
}

/** A snak's value in the shape `WikidataValue` gives it, or undefined for a datatype not read here. */
function snakValue(snak: WikidataSnak | undefined): WikidataValue | undefined {
  if (snak?.snaktype !== "value" || !snak.datavalue) return undefined;
  const dt = snak.datavalue;
  switch (dt.type) {
    case "wikibase-entityid":
    case "wikibase-item":
      return { type: "wikibase-item", value: (dt.value as { id: string }).id };
    case "string":
      return { type: "string", value: dt.value as string };
    case "time": {
      const time = dt.value as { time: string; precision?: number };
      return time.precision === undefined
        ? { type: "time", value: time.time }
        : { type: "time", value: time.time, precision: time.precision };
    }
    case "quantity":
      return { type: "quantity", value: String((dt.value as { amount: string }).amount) };
    case "url":
      return { type: "url", value: dt.value as string };
    default:
      return undefined;
  }
}

function extractClaims(entity: WikidataEntityData | undefined): Record<string, WikidataClaim> {
  const result: Record<string, WikidataClaim> = {};
  if (!entity?.claims) return result;
  for (const [prop, statements] of Object.entries(entity.claims)) {
    const values = statements.flatMap((stmt) => snakValue(stmt.mainsnak) ?? []);
    if (values.length > 0) {
      result[prop] = { property: prop, propertyLabel: prop, values };
    }
  }
  return result;
}

const RANKS = new Set(["preferred", "normal", "deprecated"]);
const SNAK_TYPES = new Set(["value", "somevalue", "novalue"]);

/** Every statement with an ID, in the order the entity lists properties and statements. */
function extractStatements(entity: WikidataEntityData | undefined): WikidataStatementRecord[] {
  const result: WikidataStatementRecord[] = [];
  for (const [property, statements] of Object.entries(entity?.claims ?? {})) {
    for (const stmt of statements) {
      if (!stmt.id || !stmt.mainsnak) continue;
      const qualifiers: Record<string, WikidataValue[]> = {};
      for (const [qualifier, snaks] of Object.entries(stmt.qualifiers ?? {})) {
        const values = snaks.flatMap((snak) => snakValue(snak) ?? []);
        if (values.length > 0) qualifiers[qualifier] = values;
      }
      const value = snakValue(stmt.mainsnak);
      result.push({
        id: stmt.id,
        property,
        rank: (RANKS.has(stmt.rank ?? "") ? stmt.rank : "normal") as WikidataStatementRecord["rank"],
        snaktype: (SNAK_TYPES.has(stmt.mainsnak.snaktype)
          ? stmt.mainsnak.snaktype
          : "value") as WikidataStatementRecord["snaktype"],
        ...(value ? { value } : {}),
        qualifiers,
        referenceCount: stmt.references?.length ?? 0,
      });
    }
  }
  return result;
}
