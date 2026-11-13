import { get, type Server } from "node:http";
import type { Revision } from "@refract-org/evidence-graph";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../commands/analyze.js", () => ({ runAnalyze: vi.fn(async () => ({ events: [], revisions: [] })) }));

import { runAnalyze } from "../commands/analyze.js";
import { runExplore } from "../commands/explore.js";
import { describeCoverage } from "../coverage.js";
import * as htmlRenderer from "../html-renderer.js";

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  vi.restoreAllMocks();
});
describe("explorer range", () => {
  it("serves the exact captured analysis without fetching it again", async () => {
    const revisions: Revision[] = [
      {
        revId: 7,
        pageId: 1,
        pageTitle: "Page",
        content: "Example",
        timestamp: "2025-01-01T00:00:00Z",
        comment: "",
        size: 7,
        minor: false,
      },
    ];
    const coverage = describeCoverage(revisions, { fromRevisionId: 7, toRevisionId: 7 });
    const analysis = { events: [], revisions, coverage };
    server = await runExplore("Page", 0, true, undefined, undefined, undefined, false, "brief", undefined, {
      analysis,
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing port");
    const root = `http://127.0.0.1:${address.port}`;
    expect(await (await fetch(`${root}/api/revisions`)).json()).toEqual(revisions);
    expect(await (await fetch(`${root}/api/coverage`)).json()).toEqual(coverage);
    expect(await (await fetch(root)).text()).toContain("Coverage: insufficient");
    expect(runAnalyze).not.toHaveBeenCalled();
  });
  it("forwards direct explorer bounds and cache settings", async () => {
    server = await runExplore(
      "Page",
      0,
      true,
      "https://example.org/api.php",
      undefined,
      undefined,
      true,
      "detailed",
      undefined,
      { fromRevId: 2, toRevId: 3, cacheDir: "/tmp/example-cache" },
    );
    expect(runAnalyze).toHaveBeenCalledWith(
      "Page",
      "detailed",
      2,
      3,
      undefined,
      true,
      "https://example.org/api.php",
      undefined,
      "/tmp/example-cache",
      undefined,
      undefined,
    );
  });
});

describe("explorer origin boundary", () => {
  const privateText = "Text from a private wiki";
  const routes = ["/", "/api/events", "/api/revisions", "/api/coverage"];

  async function startExplorer(): Promise<number> {
    const revisions: Revision[] = [
      {
        revId: 7,
        pageId: 1,
        pageTitle: "Page",
        content: privateText,
        timestamp: "2025-01-01T00:00:00Z",
        comment: "",
        size: privateText.length,
        minor: false,
      },
    ];
    server = await runExplore("Page", 0, true, undefined, undefined, undefined, false, "brief", undefined, {
      analysis: { events: [], revisions },
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing port");
    return address.port;
  }

  // Host is a forbidden header in the fetch spec, so this goes through node:http.
  function getWithHost(port: number, path: string, host: string): Promise<{ status?: number; body: string }> {
    return new Promise((resolve, reject) => {
      get({ host: "127.0.0.1", port, path, headers: { Host: host }, signal: AbortSignal.timeout(2_000) }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }).on("error", reject);
    });
  }

  it("gives a cross-origin page no CORS grant on any route", async () => {
    const port = await startExplorer();
    for (const route of routes) {
      const res = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { Origin: "https://example.com" } });
      expect(res.status, route).toBe(200);
      expect(res.headers.get("access-control-allow-origin"), route).toBeNull();
      await res.text();
    }
  });

  it("refuses a Host that is not the loopback, as a rebound DNS name would send", async () => {
    const port = await startExplorer();
    const hosts = ["evil.example", `evil.example:${port}`, "localhost.evil.example", "127.0.0.1.evil.example"];
    for (const host of hosts) {
      for (const route of [...routes, "//"]) {
        const res = await getWithHost(port, route, host);
        expect(res.status, `${host} ${route}`).toBe(403);
        expect(res.body, `${host} ${route}`).not.toContain(privateText);
      }
    }
  });

  it("serves the addresses the explorer can be opened at", async () => {
    const port = await startExplorer();
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) {
      const res = await getWithHost(port, "/api/revisions", host);
      expect(res.status, host).toBe(200);
      expect(res.body, host).toContain(privateText);
    }
  });

  it("rejects a malformed request URL and keeps serving requests", async () => {
    const port = await startExplorer();
    const host = `localhost:${port}`;

    expect(await getWithHost(port, "//", host)).toEqual({ status: 400, body: "Invalid request URL.\n" });
    const revisions = await getWithHost(port, "/api/revisions", host);
    expect(revisions.status).toBe(200);
    expect(revisions.body).toContain(privateText);
  });

  it("renders the captured HTML report once, on demand", async () => {
    const render = vi.spyOn(htmlRenderer, "renderHtmlReport");
    const port = await startExplorer();
    const host = `localhost:${port}`;

    expect((await getWithHost(port, "/api/revisions", host)).status).toBe(200);
    expect(render).not.toHaveBeenCalled();

    const first = await getWithHost(port, "/", host);
    expect(first.status).toBe(200);
    expect(await getWithHost(port, "/?reload=1", host)).toEqual(first);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
