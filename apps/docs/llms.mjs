// llms.txt (https://llmstxt.org/) and llms-full.txt: the plain-text index and
// the full text an agent reads in place of crawling the site. The routes in
// src/pages/ render them from the pages the build publishes.
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./site.mjs";

const ORIGIN = new URL(SITE_URL).origin;

// What llms.txt says under the summary, before the sections.
const DETAILS = [
	"Refract reads the revision history of a page on Wikipedia or any other MediaWiki wiki and reports what changed between revisions: sentences, citations, templates, sections, links and categories. Each observation is an event that names the revisions it came from. The same captured inputs, analyzer versions and configuration produce the same observations. Refract runs locally, with no API key or model, and it does not decide what is true or which change matters.",
	"Use it from the command line (`refract`, in the npm package `@refract-org/cli`), from an MCP client (`refract mcp`, over stdio), or from the `@refract-org/*` packages. The unscoped npm package `refract` is an unrelated project: run `npx @refract-org/cli`, never `npx refract`.",
];

// The pages an agent needs, by section. A page entry names its slug and links
// under the page's own title; a file entry names its title.
export const LLMS_SECTIONS = [
	{
		heading: "Start",
		entries: [
			{
				page: "quickstart",
				note: "install the CLI, compare a known span of revisions, browse the observations and save the events",
			},
			{
				page: "install",
				note: "run with npx and no install, install globally with npm or Bun, build from source, or use Docker",
			},
			{
				page: "demo",
				note: "a captured walkthrough of a fictional five-revision history: changed wording, a removed reference and returned text, readable with no install",
			},
		],
	},
	{
		heading: "Reference",
		entries: [
			{
				page: "cli",
				note: "every `refract` command and its flags, with the global and analyzer options",
			},
			{
				page: "schema",
				note: "the `EvidenceEvent` interface, every event type, the supporting types, deterministic identity and version compatibility",
			},
			{
				page: "events",
				note: "what triggers each event type: sentences, citations, templates, page structure, links and categories, content conflict, talk pages and access control",
			},
		],
	},
	{
		heading: "AI agents",
		entries: [
			{
				page: "mcp",
				note: "`refract mcp` starts a stdio MCP server; client configuration for Claude Code, VS Code, Cursor, GitHub Copilot and Claude Desktop, and the parameters of each tool",
			},
			{
				page: "tutorials/mcp-agent",
				note: "connect an agent, then have it analyze a page, track a claim, classify a boundary with a model and verify the results",
			},
		],
	},
	{
		heading: "Review workflow",
		entries: [
			{
				page: "review",
				note: "`refract review` reports what changed on a list of pages since the last report a person acknowledged. Checking for updates acknowledges nothing: a person reads the report, then acknowledges it",
			},
		],
	},
	{
		heading: "Scope",
		entries: [
			{
				page: "boundary",
				note: "what Refract is and is not: it makes changes to public knowledge visible; it is not a fact-checker, a moderation tool, a predictor of future edits or a replacement for domain expertise",
			},
		],
	},
	{
		heading: "Optional",
		entries: [
			{
				file: "llms-full.txt",
				title: "Complete documentation",
				note: "the Markdown source of every page on this site in one file, with links made absolute",
			},
			{
				page: "usage",
				note: "which revisions a command analyzes, how much detail it reports and where results appear",
			},
			{
				page: "quickstart-events",
				note: "the five event types seen most often and how to query them",
			},
			{ page: "interpretation", note: "how to read the event stream" },
			{
				page: "sdk",
				note: "the packages and how they compose: ingest, analyze, persist",
			},
			{ page: "glossary" },
			{
				page: "faq",
				note: "rate limits, large pages, authentication, private wikis, cache issues and empty results",
			},
		],
	},
];

// The address the site serves a page at.
export function pageUrl(slug) {
	return slug === "index" ? SITE_URL : `${SITE_URL}${slug}/`;
}

// llms.txt from the page titles the build publishes, keyed by slug. A section
// that names a page the site does not publish fails the build.
export function llmsIndex(titles) {
	const blocks = [`# ${SITE_NAME}`, `> ${SITE_DESCRIPTION}`, ...DETAILS];
	for (const { heading, entries } of LLMS_SECTIONS) {
		const items = entries.map(({ page, file, title, note }) => {
			if (page && !titles.has(page)) {
				throw new Error(`llms.txt links "${page}", which is not a page`);
			}
			const link = page
				? `[${titles.get(page)}](${pageUrl(page)})`
				: `[${title}](${SITE_URL}${file})`;
			return note ? `- ${link}: ${note}` : `- ${link}`;
		});
		blocks.push(`## ${heading}`, items.join("\n"));
	}
	return `${blocks.join("\n\n")}\n`;
}

// The order llms-full.txt gives the pages: the home page, the pages llms.txt
// links in its order, then the rest by slug.
export function fullTextOrder(slugs) {
	const linked = LLMS_SECTIONS.flatMap(({ entries }) =>
		entries.flatMap(({ page }) => (page ? [page] : [])),
	);
	const rank = (slug) => {
		if (slug === "index") return -1;
		const at = linked.indexOf(slug);
		return at === -1 ? linked.length : at;
	};
	return [...slugs].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// llms-full.txt from each page's title, slug and Markdown, whose links are
// already absolute.
export function llmsFull(pages) {
	const blocks = [
		`# ${SITE_NAME}`,
		`> ${SITE_DESCRIPTION}`,
		`The Markdown source of the ${pages.length} pages of the Refract documentation, with links made absolute. Each page starts with its title as a level-one heading and the address it is published at. The index is ${SITE_URL}llms.txt.`,
	];
	for (const { slug, title, markdown } of pages) {
		blocks.push("---", `# ${title}`, `URL: ${pageUrl(slug)}`, markdown.trim());
	}
	return `${blocks.join("\n\n")}\n`;
}

// Turns a link the site's rules produced (`/refract/cli/`, `#flags`) into an
// absolute URL. A link with a scheme is already one.
export function absoluteUrl(href, page) {
	if (href.startsWith("#")) return `${page}${href}`;
	if (href.startsWith("/")) return `${ORIGIN}${href}`;
	return href;
}

// A fence opens or closes a code block; one in a list item is indented.
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
// A code span, left as it is, or a link destination: after "](" in an inline
// link or image, or in an href or src attribute of inline HTML.
const INLINE =
	/(`+)[^`\n]*?[^`\n]\1(?!`)|(\]\(\s*<?)([^\s<>)]+)|(\b(?:href|src)=["'])([^"']+)/g;
// A link reference definition: "[label]: destination".
const DEFINITION = /^( {0,3}\[[^\]]+\]:\s*<?)([^\s>]+)/;

// Rewrites every link destination in a Markdown source with `resolve`, except
// inside code blocks and code spans.
export function rewriteLinks(markdown, resolve) {
	let fence = null;
	return markdown
		.split("\n")
		.map((line) => {
			const marker = line.match(FENCE);
			if (fence) {
				if (
					marker &&
					marker[1][0] === fence[0] &&
					marker[1].length >= fence.length &&
					!marker[2].trim()
				) {
					fence = null;
				}
				return line;
			}
			if (marker) {
				fence = marker[1];
				return line;
			}
			return line
				.replace(DEFINITION, (_, start, href) => start + resolve(href))
				.replace(INLINE, (match, ticks, open, href, attr, value) => {
					if (ticks) return match;
					if (open) return open + resolve(href);
					return attr + resolve(value);
				});
		})
		.join("\n");
}
