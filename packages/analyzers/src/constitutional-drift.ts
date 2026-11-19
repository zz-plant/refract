// Constitutional-drift detection (idea #14).
//
// Heuristic, auditable, model-free. Observes how rule-making power concentrates
// in open knowledge systems: protected edits, procedural depth, rule migration,
// revert asymmetry, bot share.
//
// Domain-neutral: operates on revisions and derived events. No healthcare vocab.
// Metadata (bot flags, rights levels, protection) is optional; the analyzer
// degrades gracefully and reports null where data is absent, rather than
// fabricating a number.

import type { Revision } from "@refract-org/evidence-graph";

export interface RevisionMetadata {
  /** Whether the editing account is a bot. */
  isBot?: boolean;
  /** Rights level of the editing account (e.g. "admin", "autoconfirmed", "anon"). */
  rightsLevel?: string;
}

export interface ConstitutionalDriftInput {
  revisions: Revision[];
  /** Optional per-revision metadata keyed by revId. */
  metadata?: Map<number, RevisionMetadata>;
  /** RevIds that are reverts (from revert detection). */
  revertRevIds?: Set<number>;
  /** Count of edits requiring elevated rights in the window (from protection tracker). */
  protectedEditCount?: number;
  /** Count of distinct policy/template/noticeboard references in the window. */
  proceduralDepth?: number;
  /** Count of rule-migration events in the window. */
  ruleMigrationCount?: number;
  /** Rights level considered "elevated" for asymmetry comparison. Default "admin". */
  elevatedRightsLevel?: string;
}

export interface ConstitutionalDriftResult {
  totalEdits: number;
  botEdits: number;
  botShareTrend: number;
  protectedEditShare: number;
  proceduralDepth: number;
  ruleMigrationCount: number;
  /** (revert rate for non-elevated) - (revert rate for elevated), or null if no rights data. */
  revertAsymmetry: number | null;
  /** Whether rights-level metadata was present for at least one revision. */
  hasRightsData: boolean;
  /** Whether bot metadata was present for at least one revision. */
  hasBotData: boolean;
}

/** Heuristic: account name ends with "Bot" or contains "bot" as a word. */
export function isBotByHeuristic(user: string | undefined): boolean {
  if (!user) return false;
  const u = user.trim();
  if (u.endsWith("Bot")) return true;
  if (/\bbot\b/i.test(u)) return true;
  return false;
}

export function isBot(rev: Revision, metadata?: Map<number, RevisionMetadata>): boolean {
  const m = metadata?.get(rev.revId);
  if (m && typeof m.isBot === "boolean") return m.isBot;
  return isBotByHeuristic(rev.user);
}

export function rightsLevel(rev: Revision, metadata?: Map<number, RevisionMetadata>): string | null {
  const m = metadata?.get(rev.revId);
  if (m && m.rightsLevel) return m.rightsLevel;
  return null;
}

export function computeBotShare(
  revisions: Revision[],
  metadata?: Map<number, RevisionMetadata>,
): {
  total: number;
  bot: number;
  share: number;
  hasBotData: boolean;
} {
  let bot = 0;
  let hasBotData = false;
  for (const r of revisions) {
    const m = metadata?.get(r.revId);
    if (m && typeof m.isBot === "boolean") hasBotData = true;
    if (isBot(r, metadata)) bot++;
  }
  const total = revisions.length;
  return { total, bot, share: total > 0 ? bot / total : 0, hasBotData };
}

export function computeProtectedEditShare(protectedEditCount: number, totalEdits: number): number {
  if (totalEdits <= 0) return 0;
  return protectedEditCount / totalEdits;
}

export function computeRevertAsymmetry(
  revisions: Revision[],
  revertRevIds: Set<number>,
  metadata: Map<number, RevisionMetadata> | undefined,
  elevatedRightsLevel: string,
): number | null {
  // Need rights data for at least one revision.
  let hasRights = false;
  for (const r of revisions) {
    if (rightsLevel(r, metadata) !== null) {
      hasRights = true;
      break;
    }
  }
  if (!hasRights) return null;

  const elevated = { total: 0, reverts: 0 };
  const other = { total: 0, reverts: 0 };
  for (const r of revisions) {
    const rl = rightsLevel(r, metadata);
    const isElevated = rl === elevatedRightsLevel;
    const bucket = isElevated ? elevated : other;
    bucket.total++;
    if (revertRevIds.has(r.revId)) bucket.reverts++;
  }
  const elevatedRate = elevated.total > 0 ? elevated.reverts / elevated.total : 0;
  const otherRate = other.total > 0 ? other.reverts / other.total : 0;
  return otherRate - elevatedRate;
}

export function computeConstitutionalDriftWindow(input: ConstitutionalDriftInput): ConstitutionalDriftResult {
  const totalEdits = input.revisions.length;
  const bot = computeBotShare(input.revisions, input.metadata);
  const hasRights = input.revisions.some((r) => rightsLevel(r, input.metadata) !== null);

  const revertAsymmetry = computeRevertAsymmetry(
    input.revisions,
    input.revertRevIds ?? new Set<number>(),
    input.metadata,
    input.elevatedRightsLevel ?? "admin",
  );

  return {
    totalEdits,
    botEdits: bot.bot,
    botShareTrend: bot.share,
    protectedEditShare: computeProtectedEditShare(input.protectedEditCount ?? 0, totalEdits),
    proceduralDepth: input.proceduralDepth ?? 0,
    ruleMigrationCount: input.ruleMigrationCount ?? 0,
    revertAsymmetry,
    hasRightsData: hasRights,
    hasBotData: bot.hasBotData,
  };
}
