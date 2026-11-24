/**
 * What a protection log entry says, read into fixed categories.
 *
 * Both readings are of the text an administrator wrote, not findings about the
 * page: `content_dispute` means the comment names an edit war or content
 * dispute, not that one took place. The same comment always gives the same
 * category.
 */

/**
 * The reason an administrator gave for a protection log entry, by the policy
 * the comment links or, without one, its wording:
 *
 * - `content_dispute`: edit warring or a content dispute (`[[WP:PP#Content disputes|…]]`, "edit war", "revert war")
 * - `vandalism`: `[[WP:Vandalism|…]]`, including page-move vandalism
 * - `disruption`: `[[WP:Disruptive editing|…]]`
 * - `sockpuppetry`: `[[WP:Sock puppetry|…]]`, or a banned or blocked user editing
 * - `sourcing`: `[[WP:INTREF|…]]` or `[[WP:Verifiability|…]]`, unsourced or poorly sourced content
 * - `other`: any other reason, or none
 */
export type ProtectionReasonCategory =
  | "content_dispute"
  | "vandalism"
  | "disruption"
  | "sockpuppetry"
  | "sourcing"
  | "other";

/**
 * Who may edit a protected page: `semi` (autoconfirmed accounts), `extended`
 * (extended-confirmed accounts), `full` (administrators), `template` (template
 * editors).
 */
export type ProtectionLevel = "semi" | "extended" | "full" | "template";

/**
 * Policy pages a protection comment links, keyed by the title after its
 * project-namespace prefix, lowercased, with spaces, underscores and hyphens
 * removed. English Wikipedia's names and shortcuts; a wiki whose comments link
 * these pages is read the same way whatever language the rest is in.
 */
const POLICY_CATEGORIES: Record<string, ProtectionReasonCategory> = {
  ew: "content_dispute",
  editwar: "content_dispute",
  editwarring: "content_dispute",
  "3rr": "content_dispute",
  vandalism: "vandalism",
  vand: "vandalism",
  vandal: "vandalism",
  movevandal: "vandalism",
  pagemovevandalism: "vandalism",
  disruptiveediting: "disruption",
  disruptive: "disruption",
  disrupt: "disruption",
  de: "disruption",
  sockpuppetry: "sockpuppetry",
  sockpuppet: "sockpuppetry",
  sockpuppets: "sockpuppetry",
  sock: "sockpuppetry",
  socks: "sockpuppetry",
  blockevasion: "sockpuppetry",
  evade: "sockpuppetry",
  intref: "sourcing",
  verifiability: "sourcing",
  v: "sourcing",
};

/** The protection policy, whose "Content disputes" section the standard edit-warring reason links. */
const PROTECTION_POLICY_PAGES = new Set(["pp", "ppol", "protection", "protectionpolicy"]);

const PROJECT_NAMESPACE = /^(?:wp|wikipedia|project):/;

/** Wording checked, in this order, when no linked policy decides: an edit war fought over vandalism accusations is an edit war. */
const KEYWORD_CATEGORIES: Array<[RegExp, ProtectionReasonCategory]> = [
  [/edit[\s-]?war|revert[\s-]?war|disput/, "content_dispute"],
  [/sock|banned user|(?:ban|block) evasion|evading (?:a )?(?:ban|block)/, "sockpuppetry"],
  [/vandal/, "vandalism"],
  [/disrupt/, "disruption"],
  [/unsourced|poorly sourced|verifiab/, "sourcing"],
];

const WIKILINK = /\[\[\s*:?([^\]|]*)(?:\|([^\]]*))?\]\]/g;

/** Links that name an editor, whose text says nothing about the reason. */
const EDITOR_LINK = /^\s*(?:user|user talk|special):/i;

function policyCategory(target: string): ProtectionReasonCategory | undefined {
  const normalized = target.toLowerCase().replace(/_/g, " ").trim();
  if (!PROJECT_NAMESPACE.test(normalized)) return undefined;
  const [page, fragment = ""] = normalized.replace(PROJECT_NAMESPACE, "").split("#");
  const key = page.replace(/[\s-]/g, "");
  if (PROTECTION_POLICY_PAGES.has(key)) {
    return /content dispute|edit war/.test(fragment) ? "content_dispute" : undefined;
  }
  return POLICY_CATEGORIES[key];
}

/**
 * The reason category of a protection log comment: the first policy link it
 * makes that names a category, or else the first keyword group its wording
 * matches, or `other`. The wording reads each link as its label and leaves out
 * links to user pages and contributions, so an editor's name cannot match.
 */
export function protectionReasonCategory(comment: string): ProtectionReasonCategory {
  for (const [, target] of comment.matchAll(WIKILINK)) {
    const category = policyCategory(target);
    if (category) return category;
  }
  const wording = comment
    .replace(WIKILINK, (_, target: string, label?: string) => (EDITOR_LINK.test(target) ? "" : (label ?? target)))
    .toLowerCase();
  for (const [pattern, category] of KEYWORD_CATEGORIES) {
    if (pattern.test(wording)) return category;
  }
  return "other";
}

/**
 * A MediaWiki protection level read as one of four. Takes the group names
 * (`autoconfirmed`, `extendedconfirmed`, `templateeditor`, `sysop`), the
 * `editsemiprotected`/`editprotected` rights some wikis use, and the English
 * labels 2012–13 entries were logged with ("Block new and unregistered users",
 * "Block all non-admin users").
 */
function normalizeLevel(raw: string): ProtectionLevel | undefined {
  const level = raw.toLowerCase();
  if (level.includes("extended")) return "extended";
  if (level.includes("template")) return "template";
  if (/autoconfirmed|semi|new and unregistered/.test(level)) return "semi";
  if (/sysop|admin|editprotected/.test(level)) return "full";
  return undefined;
}

/** `[edit=autoconfirmed:move=sysop]`, `[edit=sysop]`, `[create=sysop]`: the restriction lists log text carries. */
const RESTRICTION_LIST = /\[((?:edit|move|create|upload)=[^\]]*)\]/gi;

function restrictionsIn(text: string): Map<string, string> {
  const restrictions = new Map<string, string>();
  for (const [, list] of text.matchAll(RESTRICTION_LIST)) {
    for (const pair of list.split(":")) {
      const [action, value] = pair.split("=");
      if (action && value && !restrictions.has(action.toLowerCase())) {
        restrictions.set(action.toLowerCase(), value.trim());
      }
    }
  }
  return restrictions;
}

/**
 * The edit protection a log entry set, or the create protection for a page
 * protected from being created. Read from the entry's `details` (entries
 * since about 2015), else the `[edit=…]` list in its `description` (about
 * 2009–2014), else the same list at the end of its comment (earlier entries).
 * Undefined for an unprotection, a move-only protection, or a level not
 * recognized.
 */
export function protectionLevel(entry: {
  comment: string;
  details?: ReadonlyArray<{ type?: string; level?: string }>;
  description?: string;
}): ProtectionLevel | undefined {
  if (entry.details && entry.details.length > 0) {
    const restriction = entry.details.find((d) => d.type === "edit") ?? entry.details.find((d) => d.type === "create");
    return restriction?.level ? normalizeLevel(restriction.level) : undefined;
  }
  for (const text of [entry.description, entry.comment]) {
    if (!text) continue;
    const restrictions = restrictionsIn(text);
    const level = restrictions.get("edit") ?? restrictions.get("create");
    if (level) return normalizeLevel(level);
    if (restrictions.size > 0) return undefined;
  }
  return undefined;
}
