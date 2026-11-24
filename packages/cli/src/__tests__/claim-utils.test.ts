import { stripWikitext } from "@refract-org/analyzers";
import { describe, expect, it } from "vitest";

describe("stripWikitext", () => {
  it("strips HTML comments", () => {
    const result = stripWikitext("text <!-- comment --> more");
    expect(result).not.toContain("comment");
  });

  it("strips ref tags", () => {
    expect(stripWikitext("text<ref>citation</ref>more")).toBe("textmore");
  });

  it("strips templates", () => {
    expect(stripWikitext("{{citation needed}}")).toBe("");
  });

  it("strips wikilinks keeping display text", () => {
    expect(stripWikitext("[[Foo]] and [[Bar|baz]]")).toBe("Foo and baz");
  });

  it("strips bold and italic markers", () => {
    expect(stripWikitext("'''bold''' and ''italic''")).toBe("bold and italic");
  });

  it("collapses multiple newlines", () => {
    expect(stripWikitext("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("removes HTML tags", () => {
    expect(stripWikitext("hello<br/>world")).toBe("helloworld");
  });
});
