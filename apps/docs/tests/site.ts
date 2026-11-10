// Where the tests find the sources and the built site, and which pages the
// build should have produced from them.
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CORE_GUIDES } from "../site.mjs";

export const ROOT_DIR = resolve(import.meta.dirname, "..");
export const DOCS_DIR = join(ROOT_DIR, "src/content/docs");
export const PUBLIC_DIR = join(ROOT_DIR, "public");
export const DIST_DIR = join(ROOT_DIR, "dist");
export const REPO_DIR = resolve(ROOT_DIR, "../..");

export async function findFiles(dir: string, ext: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await findFiles(path, ext)));
		else if (entry.name.endsWith(ext)) files.push(path);
	}
	return files;
}

export const findMarkdownFiles = (dir = DOCS_DIR) => findFiles(dir, ".md");

export function slugForDoc(filePath: string): string {
	return filePath
		.slice(DOCS_DIR.length + 1)
		.replaceAll("\\", "/")
		.replace(/\.md$/, "");
}

export function renderedPathForSlug(slug: string): string {
	return slug === "index"
		? join(DIST_DIR, "index.html")
		: join(DIST_DIR, slug, "index.html");
}

// Every page the site publishes: one per docs source, plus the core guides.
export async function pageSlugs(): Promise<string[]> {
	const docs = (await findMarkdownFiles()).map(slugForDoc);
	return [...docs, ...Object.keys(CORE_GUIDES)].sort();
}
