// The build publishes the browser-only viewer from apps/ui at viewer/.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE } from "../site.mjs";
import { VIEWER_DIR } from "../viewer.mjs";
import { DIST_DIR, findFiles } from "./site";

const VIEWER_BASE = `${BASE}${VIEWER_DIR}/`;
const viewerDist = join(DIST_DIR, VIEWER_DIR);

describe("Viewer", () => {
	it("is built into the site at viewer/", () => {
		expect(existsSync(join(viewerDist, "index.html"))).toBe(true);
		expect(existsSync(join(viewerDist, "sample-data.jsonl"))).toBe(true);
	});

	it("references only its own files, under its published base", async () => {
		const html = await readFile(join(viewerDist, "index.html"), "utf-8");
		const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(
			([, ref]) => ref,
		);
		expect(refs.some((ref) => ref.endsWith(".js"))).toBe(true);
		for (const ref of refs) {
			expect(ref.startsWith(VIEWER_BASE), ref).toBe(true);
			expect(
				existsSync(join(viewerDist, ref.slice(VIEWER_BASE.length))),
				ref,
			).toBe(true);
		}
	});

	// Uploaded files are parsed in the tab; the only request the script makes
	// is for the sample data published beside it.
	it("fetches nothing but its own sample data", async () => {
		const scripts = await findFiles(join(viewerDist, "assets"), ".js");
		const code = (
			await Promise.all(scripts.map((file) => readFile(file, "utf-8")))
		).join("\n");
		expect(code).toContain(`${VIEWER_BASE}sample-data.jsonl`);
		expect(code).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket/);
		expect(code.match(/\bfetch\(/g)).toHaveLength(1);
	});
});
