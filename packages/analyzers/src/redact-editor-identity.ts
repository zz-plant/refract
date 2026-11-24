/**
 * Edit summaries, log comments and talk-page summaries name editors: MediaWiki's
 * own revert summaries read "Reverted edits by [[Special:Contributions/X|X]]
 * ([[User talk:X|talk]]) to last revision by Y", and tools write "Revert to
 * revision 123 dated … by X using popups". Events carry no editor identity, so
 * any such text is passed through this before it reaches an event.
 *
 * What is replaced with `[editor]`:
 * - links into the user, user talk and contributions namespaces, with or
 *   without an interwiki prefix (`[[:en:User:X]]`, `[[w:User talk:X|talk]]`),
 *   in English and Arabic, the two languages the revert patterns cover;
 * - `{{user|X}}`-style user templates;
 * - IPv4 and IPv6 addresses, which name logged-out editors;
 * - the name after "by" when "by" follows edit(s), revision(s) or version(s)
 *   (with or without a revision ID), change(s), or a time of day, as in every default revert summary, and the name before
 *   "moved page" in a move summary.
 *
 * The rest of the text is kept: the revert pattern, the revision IDs and the
 * reason given. "by" elsewhere ("caused by fire") is left alone, so a name an
 * editor typed into free prose is not caught.
 */

const EDITOR = "[editor]";

// Namespace names that hold editor pages. "Special:Contributions" and its
// short alias "Special:Contribs" name an editor too.
const USER_NAMESPACES = [
  "user",
  "user talk",
  "user_talk",
  "special:contributions",
  "special:contribs",
  "مستخدم",
  "نقاش المستخدم",
  "خاص:مساهمات",
].join("|");

// [[User:X]], [[User talk:X|talk]], [[:en:User:X|X]], [[w:Special:Contributions/X|X]]
const USER_LINK = new RegExp(`\\[\\[\\s*:?(?:[a-z-]{1,12}:)*\\s*(?:${USER_NAMESPACES})\\s*[:/][^\\]]*\\]\\]`, "giu");

// {{user|X}}, {{userlinks|X}}, {{IP user|…}}: templates whose argument is an editor.
const USER_TEMPLATE = /\{\{\s*(?:user|userlinks|user-multi|ip|iplinks|ip user|vandal|noping|ping|u)\s*\|[^{}]*\}\}/giu;

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Eight groups, or fewer with "::" standing for the rest. A time of day such
// as 04:35:51 has neither, so it is left alone.
const IPV6 =
  /\b(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?)(?![0-9a-f:])/gi;

// The name after "by": runs until a word or mark that ends it.
const NAME = String.raw`(?!\[editor\])[^\n()\[\]:;,|]+?`;
const NAME_END = String.raw`(?=\s+(?:using|to|with|via|per|and|from|on|as|in|at)\b|\s*[()\[\]:;,|]|\s+[-–—]\s|\s*$)`;
const BY_EDITOR = new RegExp(
  String.raw`(\b(?:edits?|(?:revisions?|versions?|rev\.?|changes?|contributions?)(?:\s+\d+)?|\d{1,2}:\d{2}(?::\d{2})?(?:\s*\(UTC\))?)\s+by\s+)${NAME}${NAME_END}`,
  "giu",
);
// "X moved page [[A]] to [[B]]" (and the older "X moved [[A]] to [[B]]").
const MOVER = /^[^\n[\]]+?(?=\s+moved\s+(?:page\s+)?\[\[)/iu;
// What a removed user-talk link leaves behind: "[editor] ([editor])".
const TALK_LEFTOVER = /\(\s*(?:\[editor\]\s*(?:[|·]\s*)?)+\)/gu;
const BARE_TALK = /\(\s*talk(?:\s*[|·]\s*contribs?)?\s*\)/giu;

export function redactEditorIdentity(text: string): string {
  if (!text) return text;
  return text
    .replace(USER_LINK, EDITOR)
    .replace(USER_TEMPLATE, EDITOR)
    .replace(IPV4, EDITOR)
    .replace(IPV6, EDITOR)
    .replace(BY_EDITOR, `$1${EDITOR}`)
    .replace(MOVER, EDITOR)
    .replace(TALK_LEFTOVER, "")
    .replace(BARE_TALK, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([:;,])/g, "$1")
    .trim();
}
