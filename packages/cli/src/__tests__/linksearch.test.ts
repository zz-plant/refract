import { afterEach, describe, expect, it, vi } from "vitest";
import { groupLinks, linkSearchPattern, runLinkSearchQuery } from "../commands/linksearch.js";

const API = "https://wiki.example/w/api.php";

function respond(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

describe("linkSearchPattern", () => {
  it("drops the protocol and trailing slashes", () => {
    expect(linkSearchPattern("https://news.example/")).toBe("news.example");
    expect(linkSearchPattern(" news.example/section ")).toBe("news.example/section");
    expect(linkSearchPattern("*.news.example")).toBe("*.news.example");
  });

  it("stays linear on a long run of slashes", () => {
    const input = `a${"/".repeat(50_000)}x`;
    const t0 = performance.now();
    expect(linkSearchPattern(input)).toBe(input);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("rejects an empty pattern or one with spaces", () => {
    expect(() => linkSearchPattern("  ")).toThrow();
    expect(() => linkSearchPattern("news example")).toThrow();
  });
});

describe("groupLinks", () => {
  it("groups by page, removes repeated URLs and sorts", () => {
    expect(
      groupLinks([
        { pageId: 2, namespace: 0, title: "Zeta", url: "https://a.example/2" },
        { pageId: 1, namespace: 0, title: "Alpha", url: "https://a.example/9" },
        { pageId: 1, namespace: 0, title: "Alpha", url: "https://a.example/1" },
        { pageId: 1, namespace: 0, title: "Alpha", url: "https://a.example/1" },
      ]),
    ).toEqual([
      { title: "Alpha", pageId: 1, urls: ["https://a.example/1", "https://a.example/9"] },
      { title: "Zeta", pageId: 2, urls: ["https://a.example/2"] },
    ]);
  });
});

describe("runLinkSearchQuery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows continuation and passes every continue value back", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (!url.searchParams.has("eucontinue")) {
        return respond({
          continue: { eucontinue: "page-2", continue: "-||" },
          query: { exturlusage: [{ pageid: 1, ns: 0, title: "Alpha", url: "https://news.example/a" }] },
        });
      }
      expect(url.searchParams.get("continue")).toBe("-||");
      return respond({ query: { exturlusage: [{ pageid: 2, ns: 0, title: "Beta", url: "https://news.example/b" }] } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLinkSearchQuery("https://news.example", { apiUrl: API });
    expect(result.pages.map((p) => p.title)).toEqual(["Alpha", "Beta"]);
    expect(result.truncated).toBe(false);
    const first = new URL(String(fetchMock.mock.calls[0][0]));
    expect(first.searchParams.get("list")).toBe("exturlusage");
    expect(first.searchParams.get("euquery")).toBe("news.example");
    expect(first.searchParams.get("eunamespace")).toBe("0");
  });

  it("queries subdomains as well when asked", async () => {
    const queries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        queries.push(new URL(String(input)).searchParams.get("euquery") ?? "");
        return respond({ query: { exturlusage: [] } });
      }),
    );
    const result = await runLinkSearchQuery("news.example", { apiUrl: API, subdomains: true });
    expect(queries).toEqual(["news.example", "*.news.example"]);
    expect(result.queries).toEqual(queries);
  });

  it("stops at the limit and says the result is incomplete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond({
          continue: { eucontinue: "more" },
          query: {
            exturlusage: [
              { pageid: 1, ns: 0, title: "Alpha", url: "https://news.example/a" },
              { pageid: 2, ns: 0, title: "Beta", url: "https://news.example/b" },
            ],
          },
        }),
      ),
    );
    const result = await runLinkSearchQuery("news.example", { apiUrl: API, maxLinks: 2 });
    expect(result.links).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.caveats.some((c) => c.includes("--limit"))).toBe(true);
  });
});
