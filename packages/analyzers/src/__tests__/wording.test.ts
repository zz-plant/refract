import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contentWords, definitionalSentence, definitionHead, sameWording } from "../wording.js";

/** Trimmed lead sections of Wikipedia revisions (CC BY-SA 4.0), named by edition, title and revision ID. */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8");

describe("sameWording", () => {
  it("needs each phrase to share 80% of its content words with the other", () => {
    expect(sameWording("is a dwarf planet in the Kuiper belt", "was a dwarf planet in the Kuiper belt")).toBe(true);
    // One-sided, every word of the first is in the second.
    expect(sameWording("is a planet", "is a dwarf planet")).toBe(false);
    expect(sameWording("is a dwarf planet", "is a planet")).toBe(false);
  });

  it("takes a threshold", () => {
    expect(sameWording("a political philosophy and movement", "a political philosophy", { threshold: 0.6 })).toBe(true);
  });

  it("drops the stop words of the language it is given", () => {
    expect([...contentWords("Der Anarchismus ist eine politische Ideenlehre", { lang: "de" })]).toEqual([
      "anarchismus",
      "politische",
      "ideenlehre",
    ]);
    expect([...contentWords("L'anarchisme est une idéologie", { lang: "fr" })]).toEqual(["anarchisme", "idéologie"]);
  });

  it("compares phrases without content words by their text", () => {
    expect(sameWording("is a", "Is  a")).toBe(true);
    expect(sameWording("is a", "was a")).toBe(false);
  });
});

describe("definitionalSentence on real leads", () => {
  it("finds English Wikipedia's Anarchism definition", () => {
    const sentence = definitionalSentence(fixture("en-anarchism-1387138923-lead.wiki"), "Anarchism");
    expect(sentence).toBe(
      "Anarchism is a political philosophy and movement that seeks to abolish all institutions that perpetuate authority, coercion, or hierarchy, primarily targeting the state and capitalism.",
    );
    expect(definitionHead(sentence as string)).toBe(
      "a political philosophy and movement that seeks to abolish all institutions that",
    );
  });

  it("finds German Wikipedia's Anarchismus definition past the file at the top of its lead", () => {
    const sentence = definitionalSentence(fixture("de-anarchismus-270500816-lead.wiki"), "Anarchismus", { lang: "de" });
    expect(sentence).toMatch(/^Anarchismus \(abgeleitet von .*\) ist eine politische Ideenlehre und Philosophie, /);
    expect(definitionHead(sentence as string, { lang: "de" })).toBe(
      "eine politische ideenlehre und philosophie die herrschaft von menschen über menschen und",
    );
  });

  it("finds Spanish Wikipedia's Anarquismo definition, which opens with an article", () => {
    const sentence = definitionalSentence(fixture("es-anarquismo-176196524-lead.wiki"), "Anarquismo", { lang: "es" });
    expect(sentence).toMatch(/^El anarquismo es una filosofía política que busca abolir /);
    expect(definitionHead(sentence as string, { lang: "es" })).toBe(
      "una filosofía política que busca abolir todas las instituciones que perpetúan la",
    );
  });

  it("finds French Wikipedia's Anarchisme definition, its subject after an elided article", () => {
    const sentence = definitionalSentence(fixture("fr-anarchisme-241510641-lead.wiki"), "Anarchisme", { lang: "fr" });
    expect(sentence).toMatch(/^L'anarchisme , ou pensée libertaire, ou parfois acratisme, est une idéologie /);
    expect(definitionHead(sentence as string, { lang: "fr" })).toBe(
      "une idéologie et un mouvement politique qui regroupe plusieurs courants de philosophie",
    );
  });

  it("reads a German naming verb, with the subject inside an opening phrase", () => {
    const sentence = definitionalSentence(fixture("de-konjunktur-270138150-lead.wiki"), "Konjunktur", { lang: "de" });
    expect(sentence).toMatch(/^Unter dem Begriff Konjunktur versteht man die gesamtwirtschaftliche Lage, /);
    expect(definitionHead(sentence as string, { lang: "de" })).toMatch(/^die gesamtwirtschaftliche lage besonders /);
  });

  it("finds Pluto's definition once the infobox above it is stripped", () => {
    expect(definitionalSentence(fixture("pluto-1387362520-lead.wiki"), "Pluto (dwarf planet)")).toBe(
      "Pluto (minor-planet number 134340) is a dwarf planet in the Kuiper belt, a ring of bodies beyond the orbit of Neptune.",
    );
  });
});

describe("definitionalSentence", () => {
  it("skips a sentence that does not name the subject before its verb", () => {
    // The shape a lead took when the stripper lost it and the first prose came from a later section.
    const lead =
      "There are many types and traditions of anarchism, not all of which are mutually exclusive. Anarchism is a political philosophy.";
    expect(definitionalSentence(lead, "Anarchism")).toBe("Anarchism is a political philosophy.");
  });

  it("skips plain-text hatnotes and lists", () => {
    const lead =
      ":For other uses, see Anarchy.\n* Anarchism is a list item.\n'''Anarchism''' is a political philosophy.";
    expect(definitionalSentence(lead, "Anarchism")).toBe("Anarchism is a political philosophy.");
  });

  it("ignores copulas inside parentheticals", () => {
    const lead = "'''Mutualism''' (which is to say, reciprocity) is an anarchist school of thought.";
    expect(definitionHead(definitionalSentence(lead, "Mutualism (economic theory)") as string)).toBe(
      "an anarchist school of thought",
    );
  });

  it("does not split at an initial, an abbreviation or a German date", () => {
    expect(definitionalSentence("Pluto was named by J. Smith. It is small.", "Pluto")).toBe(
      "Pluto was named by J. Smith.",
    );
    expect(
      definitionalSentence("'''Anna Muster''' (* 14. März 1900) war eine Malerin. Sie lebte in Ulm.", "Anna Muster", {
        lang: "de",
      }),
    ).toBe("Anna Muster (* 14. März 1900) war eine Malerin.");
  });

  it("accepts a subject just after the verb outside English", () => {
    const de = "Im engeren Sinn ist der Anarchismus eine Ideenlehre.";
    expect(definitionalSentence(de, "Anarchismus", { lang: "de" })).toBe(de);
    expect(definitionHead(de, { lang: "de", title: "Anarchismus" })).toBe("eine ideenlehre");
    const es = "Se denomina anarquismo a la filosofía que busca abolir el Estado.";
    expect(definitionalSentence(es, "Anarquismo", { lang: "es" })).toBe(es);
    expect(definitionHead(es, { lang: "es", title: "Anarquismo" })).toBe("a la filosofía que busca abolir el estado");
    const fr = "On appelle anarchisme une philosophie politique.";
    expect(definitionalSentence(fr, "Anarchisme", { lang: "fr" })).toBe(fr);
    // English keeps to subject-before-verb.
    expect(definitionalSentence("Here is anarchism, a philosophy.", "Anarchism")).toBeNull();
  });

  it("returns null when no sentence of the lead defines the subject", () => {
    expect(definitionalSentence("It orbits the Sun.\n\n== Orbit ==\nPluto is far.", "Pluto")).toBeNull();
  });

  it("takes copulas for a language it has none for, and refuses one without them", () => {
    expect(
      definitionalSentence("L'anarchismo è una filosofia politica.", "Anarchismo", { lang: "it", copulas: ["è"] }),
    ).toBe("L'anarchismo è una filosofia politica.");
    expect(() => definitionalSentence("L'anarchismo è una filosofia.", "Anarchismo", { lang: "it" })).toThrow(
      RangeError,
    );
  });
});

describe("definitionHead", () => {
  it("keeps the dozen words after the copula, without parentheticals or punctuation", () => {
    expect(
      definitionHead(
        "Pluto (minor-planet designation: 134340 Pluto) is a dwarf planet in the Kuiper belt, a ring of bodies beyond Neptune.",
      ),
    ).toBe("a dwarf planet in the kuiper belt a ring of bodies beyond");
  });

  it("reads the longer of two verbs that start at the same place", () => {
    expect(definitionHead("Als Anarchismus bezeichnet man eine Ideenlehre.", { lang: "de" })).toBe("eine ideenlehre");
  });

  it("returns null without a copula, or when a title is given and the sentence does not name it", () => {
    expect(definitionHead("No copula here at all")).toBeNull();
    expect(definitionHead("There are many types of anarchism.", { title: "Anarchism" })).toBeNull();
  });
});
