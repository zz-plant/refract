import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	CARD_HEIGHT,
	CARD_WIDTH,
	MAX_LINES,
	renderSocialCard,
	socialCardSvg,
	wrapText,
} from "../social-card.mjs";
import { DIST_DIR, pageSlugs, renderedPathForSlug } from "./site";

const SITE_URL = "https://zz-plant.github.io/refract/";
const SITE_DESCRIPTION =
	"A git log for Wikipedia: see how a page's sentences, citations, and structure changed, revision by revision, as data you can check.";
// Pages that use the site description: the home page by design, and pages with
// no prose paragraph to describe them (the build logs these).
const SITE_DESCRIPTION_PAGES = ["glossary", "index"];
const SOCIAL_CARD_URL = `${SITE_URL}social-card.png`;

type Page = { slug: string; title: string; html: string };
type JsonLdNode = Record<string, unknown> & { "@type": string };

// Width and height from a PNG's IHDR chunk, after checking the signature.
function pngSize(png: Buffer): { width: number; height: number } {
	expect(png.subarray(0, 8)).toEqual(
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	);
	expect(png.toString("latin1", 12, 16)).toBe("IHDR");
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function canonicalFor(slug: string): string {
	return slug === "index" ? SITE_URL : `${SITE_URL}${slug}/`;
}

function decodeEntities(text: string): string {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function metaContents(html: string, attr: string, key: string): string[] {
	const pattern = new RegExp(
		`<meta ${attr}="${key}" content="([^"]*)"\\s*/?>`,
		"g",
	);
	return Array.from(html.matchAll(pattern), (match) =>
		decodeEntities(match[1]),
	);
}

function descriptionOf(html: string): string {
	return metaContents(html, "name", "description")[0] ?? "";
}

// Visible text of an HTML fragment: tags dropped, entities decoded,
// whitespace collapsed.
function textOf(fragment: string): string {
	return decodeEntities(fragment.replace(/<[^>]+>/g, ""))
		.replace(/\s+/g, " ")
		.trim();
}

function stringsIn(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(stringsIn);
	if (value && typeof value === "object") {
		return Object.values(value).flatMap(stringsIn);
	}
	return [];
}

function canonicals(html: string): string[] {
	return Array.from(
		html.matchAll(/<link rel="canonical" href="([^"]*)"\s*\/?>/g),
		(match) => decodeEntities(match[1]),
	);
}

function jsonLdGraph(html: string): JsonLdNode[] {
	const blocks = Array.from(
		html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
		(match) => JSON.parse(match[1]),
	);
	expect(blocks).toHaveLength(1);
	expect(blocks[0]["@context"]).toBe("https://schema.org");
	return blocks[0]["@graph"];
}

function nodeOfType(graph: JsonLdNode[], type: string): JsonLdNode {
	const node = graph.find((entry) => entry["@type"] === type);
	expect(node, `missing ${type} node`).toBeDefined();
	return node as JsonLdNode;
}

describe("technical SEO", () => {
	const pages: Page[] = [];

	beforeAll(async () => {
		// A page's title is the visible text of its H1, which Starlight prints
		// from the frontmatter title (or from a core guide's own H1).
		for (const slug of await pageSlugs()) {
			const html = await readFile(renderedPathForSlug(slug), "utf-8");
			const h1 = html.match(/<h1 [^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
			pages.push({ slug, title: textOf(h1), html });
		}
		expect(pages.length).toBeGreaterThan(1);
	});

	it("gives every page one canonical URL, at the address it is served from", () => {
		for (const { slug, html } of pages) {
			expect(canonicals(html), slug).toEqual([canonicalFor(slug)]);
		}
	});

	it("titles each page with the visible text of its H1", () => {
		for (const { slug, title, html } of pages) {
			expect(title, slug).not.toBe("");
			const documentTitle = title.startsWith("Refract")
				? title
				: `${title} — Refract`;
			const titleElement = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
			expect(decodeEntities(titleElement), slug).toBe(documentTitle);
		}
		const crossWiki = pages.find((page) =>
			page.slug.endsWith("cross-wiki-diff"),
		);
		expect(crossWiki?.title).toBe(
			"Tutorial: Cross-wiki comparison with refract diff",
		);
	});

	it("keeps the site description on the home page", () => {
		const home = pages.find((page) => page.slug === "index");
		expect(descriptionOf(home?.html ?? "")).toBe(SITE_DESCRIPTION);
	});

	it("gives each doc page its own description, apart from listed fallbacks", () => {
		const fallbacks = pages
			.filter(({ html }) => descriptionOf(html) === SITE_DESCRIPTION)
			.map(({ slug }) => slug)
			.sort();
		expect(fallbacks).toEqual(SITE_DESCRIPTION_PAGES);

		const descriptions = pages
			.filter(({ slug }) => !SITE_DESCRIPTION_PAGES.includes(slug))
			.map(({ html }) => descriptionOf(html));
		expect(new Set(descriptions).size).toBe(descriptions.length);
	});

	it("takes each description from the page's own text, cut at a word boundary", () => {
		for (const { slug, html } of pages) {
			if (SITE_DESCRIPTION_PAGES.includes(slug)) continue;
			const description = descriptionOf(html);
			const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
			const body = textOf(main?.[1] ?? "");
			const cut = description.endsWith("…");
			const prefix = cut ? description.slice(0, -1) : description;
			const at = body.indexOf(prefix);

			expect(at, `${slug}: ${description}`).toBeGreaterThanOrEqual(0);
			if (cut) {
				expect(body[at + prefix.length], slug).toMatch(/[^\p{L}\p{N}]/u);
			}
		}
	});

	it("keeps every description to 160 characters or fewer", () => {
		for (const { slug, html } of pages) {
			const description = descriptionOf(html);
			expect(description.length, `${slug}: ${description}`).toBeLessThanOrEqual(
				160,
			);
			expect(description.length, slug).toBeGreaterThan(0);
		}
	});

	it("leaves no markdown backticks or asterisks in titles or descriptions", () => {
		for (const { slug, html } of pages) {
			const texts = [
				textOf(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
				descriptionOf(html),
				...metaContents(html, "property", "og:title"),
				...metaContents(html, "property", "og:description"),
				...stringsIn(jsonLdGraph(html)),
			];
			for (const text of texts) {
				expect(text, slug).not.toMatch(/[`*]/);
			}
		}
	});

	it("emits Open Graph and Twitter card tags that match the page", () => {
		for (const { slug, title, html } of pages) {
			const description = metaContents(html, "name", "description");
			expect(metaContents(html, "property", "og:title"), slug).toEqual([title]);
			expect(metaContents(html, "property", "og:description"), slug).toEqual(
				description,
			);
			expect(metaContents(html, "property", "og:url"), slug).toEqual([
				canonicalFor(slug),
			]);
			expect(metaContents(html, "property", "og:type"), slug).toEqual([
				slug === "index" ? "website" : "article",
			]);
			expect(metaContents(html, "property", "og:site_name"), slug).toEqual([
				"Refract",
			]);
			expect(metaContents(html, "property", "og:image"), slug).toEqual([
				SOCIAL_CARD_URL,
			]);
			expect(metaContents(html, "property", "og:image:width"), slug).toEqual([
				String(CARD_WIDTH),
			]);
			expect(metaContents(html, "property", "og:image:height"), slug).toEqual([
				String(CARD_HEIGHT),
			]);
			expect(metaContents(html, "property", "og:image:alt"), slug).toEqual([
				`Refract. ${SITE_DESCRIPTION}`,
			]);
			expect(metaContents(html, "name", "twitter:card"), slug).toEqual([
				"summary_large_image",
			]);
		}
	});

	it("publishes the 1200×630 card that og:image points to", async () => {
		const png = await readFile(
			join(DIST_DIR, SOCIAL_CARD_URL.slice(SITE_URL.length)),
		);
		expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
		// A flat rectangle compresses to a few kilobytes; rendered text does not.
		expect(png.length).toBeGreaterThan(20_000);
		expect(png.length).toBeLessThan(500_000);
	});

	it("escapes titles in the title element, attributes and JSON-LD", () => {
		const mcp = pages.find((page) => page.slug === "mcp");
		expect(mcp?.title).toContain("&");
		expect(mcp?.html).toContain("<title>Wikipedia &amp; MediaWiki");
		expect(mcp?.html).toContain(
			'<meta property="og:title" content="Wikipedia &amp; MediaWiki',
		);
		for (const { slug, html } of pages) {
			const head = html
				.slice(0, html.indexOf("</head>"))
				.replace(/<script[\s\S]*?<\/script>/g, "");
			// Outside scripts, every "&" in the head starts a character reference.
			expect(head, slug).not.toMatch(/&(?![a-z]+;|#\d+;)/);
			for (const [, json] of html.matchAll(
				/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
			)) {
				expect(json, slug).not.toContain("<");
			}
		}
	});

	it("describes the home page as a WebSite for the Refract source code", () => {
		const home = pages.find((page) => page.slug === "index");
		const graph = jsonLdGraph(home?.html ?? "");
		const website = nodeOfType(graph, "WebSite");
		const source = nodeOfType(graph, "SoftwareSourceCode");

		expect(website).toMatchObject({ name: "Refract", url: SITE_URL });
		expect(website.description).toBe(
			metaContents(home?.html ?? "", "name", "description")[0],
		);
		expect(source.codeRepository).toBe("https://github.com/zz-plant/refract");
		expect(website.about).toEqual({ "@id": source["@id"] });
	});

	it("describes every doc page as a TechArticle with a breadcrumb trail", () => {
		for (const { slug, title, html } of pages) {
			if (slug === "index") continue;
			const url = canonicalFor(slug);
			const graph = jsonLdGraph(html);
			const article = nodeOfType(graph, "TechArticle");
			const breadcrumbs = nodeOfType(graph, "BreadcrumbList");

			expect(article, slug).toMatchObject({
				headline: title,
				description: metaContents(html, "name", "description")[0],
				url,
				isPartOf: { "@type": "WebSite", url: SITE_URL },
			});
			expect(breadcrumbs.itemListElement, slug).toEqual([
				expect.objectContaining({ position: 1, name: "Home", item: SITE_URL }),
				expect.objectContaining({ position: 2, item: url }),
			]);
		}
	});

	it("keeps sitemap.xml as an index of the generated sitemap", async () => {
		for (const file of ["sitemap.xml", "sitemap-index.xml"]) {
			const index = await readFile(join(DIST_DIR, file), "utf-8");
			expect(index, file).toContain("<sitemapindex");
			const locs = Array.from(index.matchAll(/<loc>([^<]*)<\/loc>/g), (m) =>
				decodeEntities(m[1]),
			);
			expect(locs, file).toEqual([`${SITE_URL}sitemap-0.xml`]);
		}
	});

	it("lists every page once in the sitemap, with no guessed lastmod", async () => {
		const sitemap = await readFile(join(DIST_DIR, "sitemap-0.xml"), "utf-8");
		const locs = Array.from(sitemap.matchAll(/<loc>([^<]*)<\/loc>/g), (m) =>
			decodeEntities(m[1]),
		);

		expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
			true,
		);
		expect(sitemap).toContain(
			'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
		);
		expect(sitemap).not.toContain("<lastmod>");
		expect(new Set(locs).size).toBe(locs.length);
		expect([...locs].sort()).toEqual(
			pages.map((page) => canonicalFor(page.slug)).sort(),
		);
		for (const loc of locs) {
			const diskPath = join(DIST_DIR, loc.slice(SITE_URL.length), "index.html");
			expect(existsSync(diskPath), loc).toBe(true);
		}
	});
});

describe("social card", () => {
	const description = SITE_DESCRIPTION;

	it("wraps the description into lines that each fit the card", () => {
		const lines = wrapText(description);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
		expect(lines.join(" ")).toBe(description);
		for (const line of lines) {
			expect(wrapText(line), line).toEqual([line]);
		}
	});

	it("refuses a description too long to fit, instead of clipping it", () => {
		const long = Array(MAX_LINES + 2)
			.fill(description)
			.join(" ");
		expect(() =>
			socialCardSvg({ name: "Refract", description: long, address: "x" }),
		).toThrow(/fits \d+ lines/);
	});

	it("escapes text for SVG", () => {
		const svg = socialCardSvg({
			name: "A & B",
			description: 'Uses <tags> & "quotes".',
			address: "example.org/?a=1&b=2",
		});
		expect(svg).toContain(">A &amp; B</text>");
		expect(svg).toContain("Uses &lt;tags&gt; &amp; &quot;quotes&quot;.");
		expect(svg).toContain("example.org/?a=1&amp;b=2");
	});

	it("renders a 1200×630 PNG", () => {
		const png = renderSocialCard({
			name: "Refract",
			description,
			address: "zz-plant.github.io/refract",
		});
		expect(pngSize(Buffer.from(png))).toEqual({ width: 1200, height: 630 });
	});
});
