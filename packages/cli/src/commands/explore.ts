import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AnalyzerConfig } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { formatCoverage } from "../coverage.js";
import { renderHtmlReport } from "../html-renderer.js";
import { runAnalyze } from "./analyze.js";

// The server binds to 127.0.0.1, but a page can rebind its own DNS name to that
// address and become same-origin with it. Only the Host header gives that away.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  import("node:child_process")
    .then(({ exec }) => {
      exec(`${cmd} "${url}"`);
    })
    .catch(() => {});
}

export async function runExplore(
  pageTitle: string,
  port: number,
  noOpen: boolean,
  apiUrl?: string,
  auth?: AuthConfig,
  config?: AnalyzerConfig,
  useCache?: boolean,
  depth?: string,
  since?: string,
  options: {
    fromRevId?: number;
    toRevId?: number;
    cacheDir?: string;
    analysis?: Awaited<ReturnType<typeof runAnalyze>>;
  } = {},
): Promise<Server> {
  const { events, revisions, coverage } =
    options.analysis ??
    (await runAnalyze(
      pageTitle,
      depth ?? "detailed",
      options.fromRevId,
      options.toRevId,
      since,
      useCache ?? false,
      apiUrl,
      undefined,
      options.cacheDir,
      auth,
      config,
    ));

  let html: string | undefined;
  const server = createServer((req, res) => {
    if (!LOOPBACK_HOST.test(req.headers.host ?? "")) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("The Refract explorer only answers at localhost or 127.0.0.1.\n");
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://localhost:${port}`);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid request URL.\n");
      return;
    }
    if (url.pathname === "/api/coverage") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(coverage ?? null));
      return;
    }
    if (url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(events));
      return;
    }
    if (url.pathname === "/api/revisions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(revisions));
      return;
    }
    html ??= renderHtmlReport(pageTitle, events, revisions, true, coverage);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      const url = `http://localhost:${actualPort}`;
      console.log(`\n  Refract Explorer running at ${url}`);
      console.log(`  Page: ${pageTitle}`);
      console.log(`  Events: ${events.length}  |  Revisions: ${revisions.length}`);
      console.log(`  Press Ctrl+C to stop\n`);
      if (coverage) console.log(`  ${formatCoverage(coverage)}`);
      if (!noOpen) openBrowser(url);
      resolve();
    });
  });
  return server;
}
