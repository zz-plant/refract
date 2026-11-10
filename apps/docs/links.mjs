// Links in the Markdown sources point at files (`cli.md`, `../index.md`), so
// they also work when the sources are read on GitHub. This module turns them
// into site URLs at build time.
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, CORE_GUIDES, PAGES_PATH, SOURCE_REPOSITORY } from "./site.mjs";

// GitHub Pages serves dist/<slug>/index.html at <slug>/ and 301-redirects the
// slash-less form, so the trailing-slash URL is the one to link.
function slugHref(slug) {
	return slug === "index" ? BASE : `${BASE}${slug}/`;
}

const hasScheme = (href) => /^[a-z][a-z\d+.-]*:/i.test(href);

// The core guide published from a repository path, if any.
const guideAt = (repoPath) =>
	Object.keys(CORE_GUIDES).find((slug) => CORE_GUIDES[slug] === repoPath);

// Resolves a link in a docs page against the page's directory. A link to a
// page (`cli.md`, `cli`, `./cli/`, `../index.md`) becomes the page's
// trailing-slash URL, so it never redirects; so does a relative link to a core
// guide's file in the repository's docs/. A path whose last segment has a file
// extension (`.svg`, `.png`, `.ipynb`) is a file in public/ and keeps its form.
export function rewriteLink(href, sourceDir = "") {
	if (!href || hasScheme(href) || href.startsWith("#")) return href;

	const [, rawPath = "", suffix = ""] = href.match(/^([^?#]*)([?#].*)?$/) ?? [];
	if (!rawPath) return href;

	if (!rawPath.startsWith("/")) {
		const guide = guideAt(
			posix.normalize(posix.join(PAGES_PATH, sourceDir, rawPath)),
		);
		if (guide) return `${slugHref(guide)}${suffix}`;
	}

	const path = posix
		.normalize(
			rawPath.startsWith("/") ? rawPath : posix.join("/", sourceDir, rawPath),
		)
		.replace(/^\/+|\/+$/g, "");
	if (posix.extname(path) && !path.endsWith(".md")) {
		return `${BASE}${path}${suffix}`;
	}
	const slug = path.replace(/\.md$/, "").replace(/(^|\/)index$/, "");
	return `${slugHref(slug || "index")}${suffix}`;
}

// Core guides keep their repository-relative links. A link to another
// published guide becomes its site route; any other file keeps its repository
// address.
export function rewriteCanonicalLink(href, sourcePath) {
	if (!href || hasScheme(href) || href.startsWith("#") || href.startsWith("/"))
		return href;
	const [, path = "", suffix = ""] = href.match(/^([^?#]*)([?#].*)?$/) ?? [];
	if (!path) return href;
	const target = posix.normalize(posix.join(posix.dirname(sourcePath), path));
	const slug = guideAt(target);
	return slug
		? `${slugHref(slug)}${suffix}`
		: `${SOURCE_REPOSITORY}/blob/main/${target}${suffix}`;
}

// An image in a core guide is served from the repository, as raw bytes.
function rewriteCanonicalImage(href, sourcePath) {
	return rewriteCanonicalLink(href, sourcePath).replace(
		`${SOURCE_REPOSITORY}/blob/`,
		"https://raw.githubusercontent.com/refract-org/refract/",
	);
}

const DESCRIPTION_LENGTH = 155;

function truncateAtWord(text, max) {
	if (text.length <= max) return text;
	const cut = text.slice(0, max + 1);
	const end = cut.lastIndexOf(" ");
	return `${cut.slice(0, end > 0 ? end : max).replace(/[\s,;:—–-]+$/, "")}…`;
}

// A paragraph can stand in for the page when it is prose that ends a sentence.
// That rules out lead-ins to the next block ("Use environment variables
// instead:"), bold-label callouts ("**Note**: …"), parenthetical asides and
// "See [page]" pointers.
function isSummaryParagraph(node, text, ctx) {
	if (!/[.!?]["'”’)]*$/.test(text)) return false;
	if (/^\(.*\)$/.test(text)) return false;
	const [first, second] = node.children;
	if (
		first?.type === "strong" &&
		second &&
		(/:$/.test(ctx.textContent(first)) ||
			/^\s*[:—–]|^\s+-\s/.test(second.value ?? ""))
	) {
		return false;
	}
	return !(/^See\s/.test(text) && node.children.some((c) => c.type === "link"));
}

// Docs pages carry their title and description in frontmatter. A core guide
// has neither, so its H1 becomes the title (Starlight prints the title as the
// page heading) and its first prose paragraph becomes the description.
function takeTitleAndDescription(root, ctx) {
	const frontmatter = ctx.data.astro?.frontmatter;
	if (!frontmatter) return;
	const text = (node) =>
		ctx
			.textContent(node, { includeImageAlt: false, includeHtml: false })
			.replace(/\s+/g, " ")
			.trim();
	const children = [...root.children];
	const h1 = children.findIndex(
		(node) => node.type === "heading" && node.depth === 1,
	);
	if (h1 === -1) return;
	frontmatter.title = text(children[h1]);
	for (const node of children.slice(h1 + 1)) {
		if (node.type !== "paragraph") continue;
		const paragraph = text(node);
		if (isSummaryParagraph(node, paragraph, ctx)) {
			frontmatter.description = truncateAtWord(paragraph, DESCRIPTION_LENGTH);
			break;
		}
	}
	ctx.removeNode(children[h1]);
}

// A Sätteri mdast plugin that rewrites links and images in the docs pages and
// in the core guides, and lifts each core guide's H1 into its frontmatter.
export function siteLinks({ docsDir, repoDir }) {
	const sources = new Map();
	function sourceOf(ctx) {
		const key = ctx.fileURL?.href;
		if (!key) return undefined;
		if (!sources.has(key)) {
			const path = fileURLToPath(ctx.fileURL);
			let source;
			if (path.startsWith(docsDir + sep)) {
				const dir = dirname(relative(docsDir, path)).split(sep).join("/");
				source = { pageDir: dir === "." ? "" : dir };
			} else {
				const guide = Object.values(CORE_GUIDES).find(
					(file) => path === join(repoDir, file),
				);
				if (guide) source = { guide };
			}
			sources.set(key, source);
		}
		return sources.get(key);
	}
	function link(node, ctx) {
		const source = sourceOf(ctx);
		if (!source) return;
		const url = source.guide
			? rewriteCanonicalLink(node.url, source.guide)
			: rewriteLink(node.url, source.pageDir);
		if (url !== node.url) ctx.setField(node, "url", url);
	}
	return {
		name: "refract-site-links",
		before(root, ctx) {
			if (sourceOf(ctx)?.guide) takeTitleAndDescription(root, ctx);
		},
		link,
		definition: link,
		image(node, ctx) {
			const source = sourceOf(ctx);
			if (!source) return;
			const url = source.guide
				? rewriteCanonicalImage(node.url, source.guide)
				: rewriteLink(node.url, source.pageDir);
			if (url !== node.url) ctx.setField(node, "url", url);
		},
	};
}
