import type { AuthConfig, ExternalLinkUsage } from "@refract-org/ingestion";
import { MediaWikiClient } from "@refract-org/ingestion";

export interface LinkSearchOptions {
  /** Also match subdomains, by querying `*.<domain>` as well. */
  subdomains?: boolean;
  /** Namespace to search; 0, articles, by default. */
  namespace?: number;
  /** Most links read per query; 10,000 by default. */
  maxLinks?: number;
  apiUrl?: string;
  auth?: AuthConfig;
}

export interface LinkSearchPage {
  title: string;
  pageId: number;
  /** The distinct matching URLs the page links to, sorted. */
  urls: string[];
}

export interface LinkSearchResult {
  /** The patterns sent to the wiki. */
  queries: string[];
  namespace: number;
  /** Pages sorted by title. */
  pages: LinkSearchPage[];
  /** Links read, counting a URL once per page that links to it. */
  links: number;
  /** A query stopped at `maxLinks`, so more pages may link to the domain. */
  truncated: boolean;
  caveats: string[];
}

const DEFAULT_MAX_LINKS = 10_000;

/** A host and optional path, without protocol or trailing slash: what `exturlusage` takes. */
export function linkSearchPattern(input: string): string {
  const withoutProtocol = input.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  // Trailing slashes are cut by hand: /\/+$/ retried from every "/" in a long
  // run of them, which took time quadratic in its length.
  let end = withoutProtocol.length;
  while (end > 0 && withoutProtocol[end - 1] === "/") end--;
  const pattern = withoutProtocol.slice(0, end);
  if (!pattern || /\s/.test(pattern)) throw new Error(`Not a domain or URL prefix: "${input}"`);
  return pattern;
}

/** Group links by page and sort, so the same links always give the same result. */
export function groupLinks(links: readonly ExternalLinkUsage[]): LinkSearchPage[] {
  const byPage = new Map<number, { title: string; urls: Set<string> }>();
  for (const link of links) {
    const page = byPage.get(link.pageId) ?? { title: link.title, urls: new Set<string>() };
    page.urls.add(link.url);
    byPage.set(link.pageId, page);
  }
  return [...byPage]
    .map(([pageId, { title, urls }]) => ({ title, pageId, urls: [...urls].sort() }))
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : a.pageId - b.pageId));
}

export async function runLinkSearchQuery(domain: string, options: LinkSearchOptions = {}): Promise<LinkSearchResult> {
  const pattern = linkSearchPattern(domain);
  const queries = options.subdomains && !pattern.startsWith("*.") ? [pattern, `*.${pattern}`] : [pattern];
  const namespace = options.namespace ?? 0;
  const maxLinks = options.maxLinks ?? DEFAULT_MAX_LINKS;
  if (!Number.isSafeInteger(maxLinks) || maxLinks < 1) throw new Error("--limit must be a positive integer.");
  if (!Number.isSafeInteger(namespace) || namespace < 0) throw new Error("--namespace must be a namespace number.");

  const client = new MediaWikiClient(
    options.apiUrl ? { apiUrl: options.apiUrl, auth: options.auth } : options.auth ? { auth: options.auth } : undefined,
  );
  const links: ExternalLinkUsage[] = [];
  let truncated = false;
  for (const query of queries) {
    const found = await client.fetchExternalLinkUsage(query, { namespace, maxLinks });
    if (found.length >= maxLinks) truncated = true;
    links.push(...found);
  }

  const caveats = [
    "Pages are those that link to the domain now. A link removed from a page before this search is not found; analyze a page's history to see links that came and went.",
    "A link anywhere on the page counts, in a reference or not.",
  ];
  if (truncated) caveats.push(`A query stopped at ${maxLinks} links; raise --limit to read more.`);

  return { queries, namespace, pages: groupLinks(links), links: links.length, truncated, caveats };
}

export async function runLinkSearch(
  domain: string,
  options: LinkSearchOptions = {},
  output: { json?: boolean } = {},
): Promise<LinkSearchResult> {
  const result = await runLinkSearchQuery(domain, options);
  if (output.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  // Titles alone on stdout, so the output is a pages file; the rest goes to stderr.
  for (const page of result.pages) console.log(page.title);
  console.error(
    `${result.pages.length} pages link to ${result.queries.join(" or ")} (${result.links} links, namespace ${result.namespace}).`,
  );
  for (const caveat of result.caveats) console.error(`Note: ${caveat}`);
  return result;
}
