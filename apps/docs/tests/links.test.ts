import { existsSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { marked } from "marked";
import { describe, expect, it } from "vitest";
import { rewriteLink } from "../links.mjs";
import { rewriteLinks } from "../llms.mjs";
import { BASE, CORE_ASSETS, CORE_GUIDES } from "../site.mjs";
import {
	DIST_DIR,
	DOCS_DIR,
	findFiles,
	findMarkdownFiles,
	PUBLIC_DIR,
	pageSlugs,
	ROOT_DIR,
} from "./site";

const SITE_BASE = BASE.replace(/\/$/, "");
const SITE_URL = `https://zz-plant.github.io${BASE}`;

// Every link and image in a Markdown file or an HTML page.
function extractLinks(content: string): string[] {
	const links: string[] = [];
	const renderer = new marked.Renderer();
	renderer.link = ({ href }) => {
		if (href) links.push(href);
		return "";
	};
	renderer.image = ({ href }) => {
		if (href) links.push(href);
		return "";
	};
	marked.parse(content, { renderer });

	// HTML links and images, which the home page source and the built pages use.
	for (const [, href] of content.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
		links.push(href);
	}
	return Array.from(new Set(links));
}

function isExternalLink(href: string): boolean {
	return /^(https?:|mailto:|data:|javascript:)/.test(href);
}

// A link in a source file is valid when GitHub can follow it (it names a file
// in the repository) or the site can (the address the build gives it is a
// page or a published file).
function checkLink(
	sourceFile: string,
	href: string,
): { isValid: boolean; resolvedPath: string } {
	const [pathPart] = href.split(/[?#]/);
	if (isExternalLink(href) || !pathPart) {
		return { isValid: true, resolvedPath: href };
	}

	const onDisk = resolve(dirname(sourceFile), pathPart);
	if (
		!pathPart.startsWith("/") &&
		existsSync(onDisk) &&
		statSync(onDisk).isFile()
	) {
		return { isValid: true, resolvedPath: onDisk };
	}
	if (!sourceFile.startsWith(DOCS_DIR)) {
		return { isValid: false, resolvedPath: onDisk };
	}

	const pageDir = relative(DOCS_DIR, dirname(sourceFile)).replaceAll("\\", "/");
	const sitePath = rewriteLink(pathPart, pageDir).slice(BASE.length);
	if (sitePath === "" || sitePath.endsWith("/")) {
		const slug = sitePath.replace(/\/$/, "") || "index";
		const page = join(DOCS_DIR, `${slug}.md`);
		return {
			isValid: existsSync(page) || slug in CORE_GUIDES,
			resolvedPath: page,
		};
	}
	const file = join(PUBLIC_DIR, sitePath);
	return {
		isValid: existsSync(file) || sitePath in CORE_ASSETS,
		resolvedPath: file,
	};
}

function normalizeUrlPath(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			parts.pop();
		} else {
			parts.push(part);
		}
	}
	return `/${parts.join("/")}${path.endsWith("/") ? "/" : ""}`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The URL path a link in a built page points at ("/refract/cli/"), or
// null for an external link or a same-page anchor. Absolute links to the
// published site, such as the canonical URL, count as internal.
function sitePathOf(sourceFile: string, href: string): string | null {
	const local = href.startsWith(SITE_URL)
		? href.slice(SITE_URL.length - SITE_BASE.length - 1)
		: href;
	if (isExternalLink(local) || local.startsWith("#")) return null;

	const [pathPart] = local.split(/[?#]/);
	if (!pathPart) return null;

	const relativeDir = dirname(sourceFile)
		.replace(DIST_DIR, "")
		.replaceAll("\\", "/");
	const pagePath = `${SITE_BASE}${relativeDir === "/" ? "" : relativeDir}/`;
	return normalizeUrlPath(
		pathPart.startsWith("/") ? pathPart : `${pagePath}${pathPart}`,
	);
}

async function checkGeneratedLink(
	sourceFile: string,
	href: string,
): Promise<{ isValid: boolean; resolvedPath: string }> {
	const urlPath = sitePathOf(sourceFile, href);
	if (urlPath === null) {
		return { isValid: true, resolvedPath: href };
	}
	const hash = href.split("#")[1];

	if (!(urlPath === `${SITE_BASE}/` || urlPath.startsWith(`${SITE_BASE}/`))) {
		return { isValid: false, resolvedPath: urlPath };
	}

	const diskPath = urlPath.slice(SITE_BASE.length) || "/";
	let resolvedPath = diskPath.endsWith("/")
		? join(DIST_DIR, diskPath, "index.html")
		: join(DIST_DIR, diskPath);

	try {
		const pathStat = await stat(resolvedPath);
		if (pathStat.isDirectory()) {
			resolvedPath = join(resolvedPath, "index.html");
			await stat(resolvedPath);
		}
		if (hash) {
			const html = await readFile(resolvedPath, "utf-8");
			const decodedHash = decodeURIComponent(hash);
			const idPattern = new RegExp(`id=["']${escapeRegExp(decodedHash)}["']`);
			if (!idPattern.test(html)) {
				return {
					isValid: false,
					resolvedPath: `${resolvedPath}#${decodedHash}`,
				};
			}
		}
		return { isValid: true, resolvedPath };
	} catch {
		return { isValid: false, resolvedPath };
	}
}

describe("Documentation Links Validator", async () => {
	const mdFiles = await findMarkdownFiles();
	mdFiles.push(join(ROOT_DIR, "README.md"));

	for (const file of mdFiles) {
		const relativeFilePath = file.replace(`${ROOT_DIR}/`, "");

		it(`should have valid links in ${relativeFilePath}`, async () => {
			const content = await readFile(file, "utf-8");
			const invalidLinks: string[] = [];

			for (const href of extractLinks(content)) {
				const { isValid, resolvedPath } = checkLink(file, href);
				if (!isValid) {
					invalidLinks.push(`${href} (resolved: ${resolvedPath})`);
				}
			}

			expect(
				invalidLinks,
				`Found broken links in ${relativeFilePath}:\n${invalidLinks.join("\n")}`,
			).toEqual([]);
		});
	}
});

describe("Generated site links", () => {
	it("should have valid internal links after build", async () => {
		const invalidLinks: string[] = [];

		for (const file of await findFiles(DIST_DIR, ".html")) {
			const relativeFilePath = file.replace(`${DIST_DIR}/`, "");
			const html = await readFile(file, "utf-8");

			for (const href of extractLinks(html)) {
				const { isValid, resolvedPath } = await checkGeneratedLink(file, href);
				if (!isValid) {
					invalidLinks.push(
						`${relativeFilePath}: ${href} (resolved: ${resolvedPath})`,
					);
				}
			}
		}

		expect(
			invalidLinks,
			`Found broken generated links:\n${invalidLinks.join("\n")}`,
		).toEqual([]);
	});

	// GitHub Pages serves dist/<slug>/index.html at <slug>/ and answers the
	// slash-less <slug> with a 301 redirect.
	it("links to pages at their trailing-slash URL, so no internal link redirects", async () => {
		const redirects: string[] = [];
		let checked = 0;

		for (const file of await findFiles(DIST_DIR, ".html")) {
			const html = await readFile(file, "utf-8");
			for (const href of extractLinks(html)) {
				const urlPath = sitePathOf(file, href);
				if (urlPath === null) continue;
				checked++;
				if (urlPath.endsWith("/")) continue;
				const diskPath = join(DIST_DIR, urlPath.slice(SITE_BASE.length));
				if (existsSync(diskPath) && statSync(diskPath).isDirectory()) {
					redirects.push(`${file.replace(`${DIST_DIR}/`, "")}: ${href}`);
				}
			}
		}

		expect(checked).toBeGreaterThan(100);
		expect(
			redirects,
			`These internal links redirect:\n${redirects.join("\n")}`,
		).toEqual([]);
	});
});

// llms.txt and llms-full.txt are read by agents, outside any page, so every
// link in them has to be an absolute URL that the published site answers.
describe("llms.txt and llms-full.txt", () => {
	// The pages an agent needs to use Refract.
	const AGENT_PAGES = [
		"quickstart",
		"install",
		"cli",
		"mcp",
		"tutorials/mcp-agent",
		"schema",
		"events",
		"review",
		"demo",
		"boundary",
	];

	it("publishes llms.txt as a title, a summary and sections of links", async () => {
		const text = await readFile(join(DIST_DIR, "llms.txt"), "utf-8");
		const [title, blank, summary] = text.split("\n");
		expect(title).toBe("# Refract");
		expect(blank).toBe("");
		expect(summary).toMatch(/^> \S/);
		expect(text.match(/^## \S/gm)?.length).toBeGreaterThan(1);
		expect(text, "llmstxt.org sections are H2").not.toMatch(/^#{3,} /m);

		const links = extractLinks(text);
		const missing = AGENT_PAGES.map((slug) => `${SITE_URL}${slug}/`).filter(
			(url) => !links.includes(url),
		);
		expect(missing, `llms.txt does not link:\n${missing.join("\n")}`).toEqual(
			[],
		);
		expect(links).toContain(`${SITE_URL}llms-full.txt`);
	});

	it.each(["llms.txt", "llms-full.txt"])(
		"links from %s only to absolute URLs that resolve",
		async (file) => {
			const path = join(DIST_DIR, file);
			const links = extractLinks(await readFile(path, "utf-8"));
			const relative = links.filter((href) => !isExternalLink(href));
			const broken: string[] = [];
			for (const href of links) {
				const { isValid, resolvedPath } = await checkGeneratedLink(path, href);
				if (!isValid) broken.push(`${href} (resolved: ${resolvedPath})`);
			}

			expect(links.length).toBeGreaterThan(10);
			expect(relative, `Relative links in ${file}`).toEqual([]);
			expect(broken, `Broken links in ${file}:\n${broken.join("\n")}`).toEqual(
				[],
			);
		},
	);

	it("gives llms-full.txt every page once, under its address", async () => {
		const text = await readFile(join(DIST_DIR, "llms-full.txt"), "utf-8");
		const urls = Array.from(text.matchAll(/^URL: (\S+)$/gm), ([, url]) => url);
		const expected = (await pageSlugs()).map((slug) =>
			slug === "index" ? SITE_URL : `${SITE_URL}${slug}/`,
		);
		expect(urls.sort()).toEqual(expected.sort());
		expect(urls[0]).toBe(SITE_URL);
	});
});

describe("rewriteLinks", () => {
	const resolve = (href: string) => `<${href}>`;

	it.each([
		["[CLI](cli.md)", "[CLI](<cli.md>)"],
		["![Flow](flow.svg)", "![Flow](<flow.svg>)"],
		["[a](a.md) and [b](b.md#x)", "[a](<a.md>) and [b](<b.md#x>)"],
		["[ref]: cli.md", "[ref]: <cli.md>"],
		['<a href="review/">Review</a>', '<a href="<review/>">Review</a>'],
		["[`refract review`](review.md)", "[`refract review`](<review.md>)"],
	])("rewrites %s", (markdown, expected) => {
		expect(rewriteLinks(markdown, resolve)).toBe(expected);
	});

	it.each([
		"Write `[CLI](cli.md)` for a link.",
		"Write ``[CLI](cli.md)`` for a link.",
		"```markdown\n[CLI](cli.md)\n```",
		"~~~\n[CLI](cli.md)\n~~~",
		"- Step:\n\n  ```markdown\n  [CLI](cli.md)\n  ```",
		"````markdown\n```\n[CLI](cli.md)\n```\n````",
	])("leaves code as it is: %s", (markdown) => {
		expect(rewriteLinks(markdown, resolve)).toBe(markdown);
	});

	it("rewrites links after a code block closes", () => {
		expect(rewriteLinks("```\n[a](a.md)\n```\n[b](b.md)", resolve)).toBe(
			"```\n[a](a.md)\n```\n[b](<b.md>)",
		);
	});
});

describe("rewriteLink", () => {
	it.each([
		["cli", "", "/refract/cli/"],
		["./cli", "", "/refract/cli/"],
		["cli/", "", "/refract/cli/"],
		["cli.md", "", "/refract/cli/"],
		[
			"schema#version-compatibility",
			"",
			"/refract/schema/#version-compatibility",
		],
		[
			"schema.md#version-compatibility",
			"",
			"/refract/schema/#version-compatibility",
		],
		["tutorials/refract-ui", "", "/refract/tutorials/refract-ui/"],
		["fandom-canon.md", "tutorials", "/refract/tutorials/fandom-canon/"],
		["../analytics.md", "tutorials", "/refract/analytics/"],
		["../index.md", "tutorials", "/refract/"],
		["index.md", "", "/refract/"],
		["./", "", "/refract/"],
		["/quickstart", "tutorials", "/refract/quickstart/"],
		["cli?x=1", "", "/refract/cli/?x=1"],
	])("links %s (from docs/%s) to the page URL %s", (href, dir, expected) => {
		expect(rewriteLink(href, dir)).toBe(expected);
	});

	it.each([
		["mcp-sequence.svg", "", "/refract/mcp-sequence.svg"],
		[
			"assets/refract-ui-screenshot.png",
			"",
			"/refract/assets/refract-ui-screenshot.png",
		],
		[
			"notebooks/model-evaluation.ipynb",
			"",
			"/refract/notebooks/model-evaluation.ipynb",
		],
		["../boundary.svg", "tutorials", "/refract/boundary.svg"],
	])(
		"leaves the asset link %s (from docs/%s) without a slash",
		(href, dir, expected) => {
			expect(rewriteLink(href, dir)).toBe(expected);
		},
	);

	it.each([
		"https://example.org/page",
		"http://example.org",
		"mailto:docs@example.org",
		"#anchor",
	])("leaves %s unchanged", (href) => {
		expect(rewriteLink(href)).toBe(href);
	});
});
