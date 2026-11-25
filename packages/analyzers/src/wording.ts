import { stripLead } from "./wikitext-parser.js";

/** The editions whose copulas and stop words this module carries. */
export type WordingLanguage = "en" | "de" | "es" | "fr";

/**
 * The verbs a definitional sentence turns on, per language. Each is matched as
 * whole words without regard to case, and where two start at the same place
 * the longer wins, so "bezeichnet man" is read before "bezeichnet".
 *
 * Besides the copulas, each list holds the naming verbs leads in that language
 * use instead: "Unter dem Begriff Konjunktur versteht man …", "Se denomina
 * anarquismo a …", "On appelle anarchisme …". In the last two the subject
 * follows the verb; see definitionalSentence.
 */
export const DEFINITION_COPULAS: Readonly<Record<WordingLanguage, readonly string[]>> = {
  en: ["is", "was", "are", "were", "refers to", "describes", "denotes"],
  de: ["ist", "war", "sind", "waren", "bezeichnet", "bezeichnet man", "versteht man"],
  es: ["es", "fue", "son", "era", "se denomina", "se llama"],
  fr: ["est", "était", "sont", "désigne", "on appelle"],
};

/**
 * Words too common to tell two wordings apart, per language: articles,
 * prepositions, conjunctions, pronouns and the copulas. contentWords drops
 * them, along with every word of two letters or fewer.
 */
const STOP_WORDS: Readonly<Record<WordingLanguage, ReadonlySet<string>>> = {
  en: new Set(
    "the and for with from that this was are were been its which who their his her they she has have had not but also".split(
      " ",
    ),
  ),
  de: new Set(
    "der die das des dem den ein eine einer eines einem einen und oder von vom mit als auf aus bei für ist war sind waren wird werden wurde nicht auch sich sie dass zum zur".split(
      " ",
    ),
  ),
  es: new Set("los las una unos unas del por para con como que fue son era sus pero más".split(" ")),
  fr: new Set("les une des est était sont été par pour avec comme que qui ses son sur dans pas aux".split(" ")),
};

/** Articles a title can open with, skipped when picking the word that names the subject. */
const ARTICLES = new Set("the der die das el la los las le les".split(" "));

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Lowercase with diacritics removed, so "Économie" and "economie" compare equal. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function supported(lang: string): lang is WordingLanguage {
  return Object.hasOwn(DEFINITION_COPULAS, lang);
}

/**
 * The words that carry a phrase's meaning: runs of letters and digits,
 * lowercased, longer than two characters, and not among `lang`'s stop words
 * (English by default; a language without a list keeps every word that long).
 */
export function contentWords(text: string, options: { lang?: string } = {}): Set<string> {
  const lang = options.lang ?? "en";
  const stop = supported(lang) ? STOP_WORDS[lang] : undefined;
  const words = new Set<string>();
  for (const [word] of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    if (word.length > 2 && !stop?.has(word)) words.add(word);
  }
  return words;
}

/**
 * Whether two phrases are the same wording: each shares at least `threshold`
 * (default 0.8) of its content words with the other. The test runs both ways
 * because a one-sided one reads "is a planet" as matching "is a dwarf planet":
 * every word of the first is in the second, but the second's "dwarf" is not in
 * the first. Phrases with no content words match only when their text is the
 * same once case and whitespace are ignored.
 */
export function sameWording(a: string, b: string, options: { lang?: string; threshold?: number } = {}): boolean {
  const threshold = options.threshold ?? 0.8;
  const wordsA = contentWords(a, options);
  const wordsB = contentWords(b, options);
  if (wordsA.size === 0 || wordsB.size === 0) {
    const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
    return wordsA.size === wordsB.size && plain(a) === plain(b);
  }
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  return shared / wordsA.size >= threshold && shared / wordsB.size >= threshold;
}

export interface DefinitionOptions {
  /** The edition's language: "en" (default), "de", "es" or "fr". */
  lang?: string;
  /** Verbs to use in place of the language's list, for an edition this module has none for. */
  copulas?: readonly string[];
}

function copulaPattern(options: DefinitionOptions): RegExp {
  const lang = options.lang ?? "en";
  const copulas = options.copulas ?? (supported(lang) ? DEFINITION_COPULAS[lang] : undefined);
  if (!copulas?.length) {
    throw new RangeError(
      `No copulas for language "${lang}". Pass options.copulas, or use one of ${Object.keys(DEFINITION_COPULAS).join(", ")}.`,
    );
  }
  const alternatives = [...copulas]
    .sort((a, b) => b.length - a.length)
    .map((verb) => verb.trim().split(/\s+/).map(escapeRegExp).join("\\s+"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The sentence with each parenthetical removed, nested ones with it:
 * etymologies and pronunciations, which can hold copulas of their own.
 * Parentheses are paired in one scan, so deep nesting takes linear time; an
 * unpaired one stays.
 */
function withoutParentheticals(sentence: string): string {
  const closeOf = new Map<number, number>();
  const opens: number[] = [];
  for (let i = 0; i < sentence.length; i++) {
    if (sentence[i] === "(") opens.push(i);
    else if (sentence[i] === ")" && opens.length > 0) closeOf.set(opens.pop() as number, i);
  }
  let out = "";
  let at = 0;
  for (const [open, close] of [...closeOf].sort((a, b) => a[0] - b[0])) {
    if (open < at) continue;
    out += `${sentence.slice(at, open)} `;
    at = close + 1;
  }
  return (out + sentence.slice(at)).replace(/\s+/g, " ").trim();
}

/** The title word a definitional sentence has to name: the first word of three letters or more that is not an article, disambiguation removed. */
function subjectWord(title: string): string {
  const words = [...fold(withoutParentheticals(title)).matchAll(/[\p{L}\p{N}]+/gu)].map(([word]) => word);
  return words.find((word) => word.length >= 3 && !ARTICLES.has(word)) ?? words[0] ?? "";
}

function names(text: string, subject: string): boolean {
  if (!subject) return false;
  const folded = fold(text);
  if (subject.length >= 4) return folded.includes(subject);
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(subject)}(?![\\p{L}\\p{N}])`, "u").test(folded);
}

/** How many words after the verb the subject may sit when it follows the verb: "ist der Anarchismus", "se denomina anarquismo". */
const SUBJECT_AFTER_VERB_WORDS = 3;

interface DefinitionParts {
  /** The text after the verb, parentheticals removed. */
  after: string;
  /** Where the definition starts in `after`: past the subject when it follows the verb. */
  headStart: number;
}

/**
 * Splits a sentence at its first copula, and says whether it defines the
 * subject: the subject is named before the verb ("Anarchism is …", "Unter dem
 * Begriff Konjunktur versteht man …") or, outside English, within a few words
 * after it, as German word order puts it after an opening phrase ("Im engeren
 * Sinn ist der Anarchismus …") and Spanish and French naming verbs do.
 */
/** Participles after an English copula that make the sentence about the subject's origin or name, not a definition. */
const NOT_DEFINING = /^\s*(?:derived|based|named|pronounced|taken|borrowed)\s+(?:from|on|upon|after|for|as)\b/i;

function splitDefinition(
  sentence: string,
  subject: string | undefined,
  copula: RegExp,
  lang: string,
): DefinitionParts | null {
  const clean = withoutParentheticals(sentence);
  const verb = copula.exec(clean);
  if (!verb) return null;
  const after = clean.slice(verb.index + verb[0].length);
  // A passive "is derived from", "is based on" or "is named after" tells where the subject comes from, not what it is.
  if (lang === "en" && NOT_DEFINING.test(after)) return null;
  if (subject === undefined || names(clean.slice(0, verb.index), subject)) return { after, headStart: 0 };
  if (lang === "en") return null;
  const words = [...after.matchAll(/\S+/g)].slice(0, SUBJECT_AFTER_VERB_WORDS);
  const at = words.find(([word]) => names(word, subject));
  return at ? { after, headStart: (at.index ?? 0) + at[0].length } : null;
}

/** Words that end in "." without ending a sentence. A single letter followed by "." (an initial, "z. B.") never ends one either. */
const ABBREVIATIONS = new Set("ca approx bzw vgl sog st dr mr mrs ms jr sr nr chr sra mme mlle".split(" "));
/** Era abbreviations written with stops, at the end of the text so far: "B.C.", "B.C.E.", "A.D.", "C.E.". */
const ERA = /(?:^|[^\p{L}.])(?:B\.C\.(?:E\.)?|A\.D\.|C\.E\.)$/u;

/**
 * The sentences of one line of prose. A sentence ends at ".", "!" or "?"
 * outside brackets when whitespace and a capital, digit, quotation mark or
 * opening bracket follow, unless the word before the stop is an abbreviation
 * or a single letter, or, in German, a number: "14. März" is a date.
 */
function sentences(line: string, lang: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    if (depth > 0 || (c !== "." && c !== "!" && c !== "?")) continue;
    const next = /^\s+(?=[\p{Lu}\p{N}"'“„«‚(¿¡])/u.exec(line.slice(i + 1, i + 3));
    if (!next) continue;
    if (c === ".") {
      let wordStart = i;
      while (wordStart > start && LETTER_OR_DIGIT.test(line[wordStart - 1])) wordStart--;
      const word = line.slice(wordStart, i);
      // An era abbreviation ends a sentence when a capitalised word follows ("… third century B.C. The
      // stoics …"); other initials ("U.S. Army", "z. B.") don't. "A.D." before a year is followed by a digit.
      if (
        word.length === 1 &&
        /\p{L}/u.test(word) &&
        !(ERA.test(line.slice(start, i + 1)) && /^\s+\p{Lu}/u.test(line.slice(i + 1, i + 3)))
      )
        continue;
      if (ABBREVIATIONS.has(word.toLowerCase())) continue;
      if (lang === "de" && /^\d+$/.test(word)) continue;
    }
    out.push(line.slice(start, i + 1).trim());
    start = i + 1 + next[0].length;
    i = start - 1;
  }
  const rest = line.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * The sentence of a page's lead that defines its subject: the first sentence
 * of the lead's prose that names the subject before its copula, as
 * "Anarchism is a political philosophy …" does and "There are many types and
 * traditions of anarchism" does not. Null when no sentence of the lead does.
 *
 * The lead is read as `stripLead` strips it, so the sentence is the text a
 * sentence event or `claimHistory` sees, with whitespace runs as single
 * spaces (which claimHistory's matching ignores). Lines that open with list,
 * indent or table markup are skipped, which drops old plain-text hatnotes
 * such as ":For other uses, see …".
 *
 * The subject is the title's first word of three letters or more that is not
 * an article, with any "(disambiguation)" removed, compared without regard to
 * case or accents and anywhere in the text before the copula, so leads that
 * open with an article or a phrase still count: "L'anarchisme … est",
 * "La oligarquía, del griego …, es", "Unter dem Begriff Konjunktur versteht
 * man". In German, Spanish and French the subject may instead follow the verb
 * by up to three words: German puts the verb second after an opening phrase,
 * and naming verbs such as "se denomina" and "on appelle" come first.
 * Parentheticals are ignored when looking for the copula.
 */
export function definitionalSentence(wikitext: string, title: string, options: DefinitionOptions = {}): string | null {
  const lang = options.lang ?? "en";
  const subject = subjectWord(title);
  const copula = copulaPattern(options);
  for (const line of stripLead(wikitext).split("\n")) {
    const prose = line.replace(/\s+/g, " ").trim();
    if (!LETTER_OR_DIGIT.test(prose) || /^[:*#;|!{]/.test(prose)) continue;
    for (const sentence of sentences(prose, lang)) {
      if (splitDefinition(sentence, subject, copula, lang)) return sentence;
    }
  }
  return null;
}

/** A word without the hyphens and apostrophes at its ends; those inside it stay. */
function trimJoiners(word: string): string {
  const joiner = (c: string) => c === "-" || c === "'" || c === "’";
  let start = 0;
  let end = word.length;
  while (start < end && joiner(word[start])) start++;
  while (end > start && joiner(word[end - 1])) end--;
  return word.slice(start, end);
}

/** How many words definitionHead keeps. */
const HEAD_WORDS = 12;

/**
 * The defining phrase of a definitional sentence: the dozen words after its
 * first copula, lowercased, with parentheticals and punctuation removed (a
 * hyphen or apostrophe inside a word stays). "Pluto (minor-planet number
 * 134340) is a dwarf planet in the Kuiper belt, …" gives "a dwarf planet in
 * the kuiper belt a ring of bodies beyond the". Null when the sentence has no
 * copula. With `title`, the sentence also has to name the subject as
 * definitionalSentence requires, and a subject that follows the verb is
 * skipped, so "Se denomina anarquismo a la filosofía …" gives "a la filosofía
 * …"; without it, such a subject is part of the head.
 *
 * Compare heads with sameWording to tell whether a definition changed.
 */
export function definitionHead(sentence: string, options: DefinitionOptions & { title?: string } = {}): string | null {
  const parts = splitDefinition(
    sentence,
    options.title === undefined ? undefined : subjectWord(options.title),
    copulaPattern(options),
    options.lang ?? "en",
  );
  if (!parts) return null;
  const words = parts.after
    .slice(parts.headStart)
    .split(/\s+/)
    .map((word) => trimJoiners(word.toLowerCase().replace(/[^\p{L}\p{N}'’-]+/gu, "")))
    .filter(Boolean)
    .slice(0, HEAD_WORDS);
  return words.length > 0 ? words.join(" ") : null;
}
