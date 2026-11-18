import { describe, expect, it } from "vitest";
import { WaybackRevisionSource } from "../wayback-source.js";

describe("WaybackRevisionSource", () => {
  it("fetches snapshots and yields parsed revisions", async () => {
    const mockCdx = [
      ["timestamp", "original", "digest"],
      ["20250101000000", "https://example.com/policy", "digest1"],
      ["20260101000000", "https://example.com/policy", "digest2"],
    ];

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/cdx/search/cdx")) {
        return new Response(JSON.stringify(mockCdx), { status: 200 });
      }
      if (url.includes("20250101000000")) {
        return new Response("<html><body><h1>Original</h1><p>First version.</p></body></html>", {
          status: 200,
        });
      }
      if (url.includes("20260101000000")) {
        return new Response("<html><body><h1>Updated</h1><p>Second version with edits.</p></body></html>", {
          status: 200,
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const source = new WaybackRevisionSource({
      fetchFn: mockFetch,
      rateLimitMs: 0,
    });

    const revs = [];
    for await (const rev of source.revisions("https://example.com/policy")) {
      revs.push(rev);
    }

    expect(revs).toHaveLength(2);
    expect(revs[0].timestamp).toBe("2025-01-01T00:00:00Z");
    // The snapshot's timestamp is its ID, the same whatever range is asked for.
    expect(revs.map((r) => r.revId)).toEqual([20250101000000, 20260101000000]);
    expect(revs[0].content).toContain("Original\nFirst version.");
    expect(revs[1].timestamp).toBe("2026-01-01T00:00:00Z");
    expect(revs[1].content).toContain("Updated\nSecond version with edits.");
  });

  it("reads the latest snapshots first when asked, so a limit keeps the latest", async () => {
    const fetched: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/cdx/search/cdx")) {
        return new Response(
          JSON.stringify([
            ["timestamp", "original", "digest"],
            ["20240101000000", "https://example.com/p", "d1"],
            ["20250101000000", "https://example.com/p", "d2"],
            ["20260101000000", "https://example.com/p", "d3"],
          ]),
          { status: 200 },
        );
      }
      fetched.push(url);
      return new Response("<p>text</p>", { status: 200 });
    };
    const source = new WaybackRevisionSource({ fetchFn: mockFetch, rateLimitMs: 0 });
    const ids = [];
    for await (const rev of source.revisions("https://example.com/p", { direction: "older", limit: 2 })) {
      ids.push(rev.revId);
    }
    expect(ids).toEqual([20260101000000, 20250101000000]);
    expect(fetched).toHaveLength(2);
  });

  it("reports an index request that fails rather than an empty history", async () => {
    const down: typeof fetch = async () => {
      throw new Error("connection reset");
    };
    const source = new WaybackRevisionSource({ fetchFn: down, rateLimitMs: 0 });
    await expect(async () => {
      for await (const _ of source.revisions("https://example.com/p")) {
        // drain
      }
    }).rejects.toThrow(/index request failed.*connection reset/);

    const refused: typeof fetch = async () => new Response("busy", { status: 503 });
    const busy = new WaybackRevisionSource({ fetchFn: refused, rateLimitMs: 0 });
    await expect(async () => {
      for await (const _ of busy.revisions("https://example.com/p")) {
        // drain
      }
    }).rejects.toThrow(/HTTP 503/);
  });

  it("returns nothing for a URL the archive never captured", async () => {
    const empty: typeof fetch = async () => new Response("", { status: 200 });
    const source = new WaybackRevisionSource({ fetchFn: empty, rateLimitMs: 0 });
    const revs = [];
    for await (const rev of source.revisions("https://example.com/never")) revs.push(rev);
    expect(revs).toEqual([]);
  });

  it("deduplicates snapshots with identical digests", async () => {
    const mockCdx = [
      ["timestamp", "original", "digest"],
      ["20250101000000", "https://example.com/policy", "same-digest"],
      ["20250102000000", "https://example.com/policy", "same-digest"],
    ];

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/cdx/search/cdx")) {
        return new Response(JSON.stringify(mockCdx), { status: 200 });
      }
      return new Response("<html><body><p>Content</p></body></html>", { status: 200 });
    };

    const source = new WaybackRevisionSource({
      fetchFn: mockFetch,
      rateLimitMs: 0,
    });

    const revs = [];
    for await (const rev of source.revisions("https://example.com/policy")) {
      revs.push(rev);
    }

    expect(revs).toHaveLength(1);
  });
});
