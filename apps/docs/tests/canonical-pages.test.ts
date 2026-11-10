import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteCanonicalLink, rewriteLink } from "../links.mjs";
import { DIST_DIR, REPO_DIR } from "./site";

describe("canonical core guides", () => {
	it("publishes the review contract and its coverage limits from core", () => {
		const html = readFileSync(join(DIST_DIR, "review/index.html"), "utf8");
		expect(html).toContain("Review the sources you rely on");
		expect(html).toContain("Understand coverage and recovery");
		expect(html).toContain("An incomplete report cannot be acknowledged.");
		expect(html).toContain(
			"https://github.com/refract-org/refract/blob/main/docs/examples/review.json",
		);
		expect(html).toContain(
			"<title>Review the sources you rely on — Refract</title>",
		);
		expect(html).toContain(
			'href="https://github.com/refract-org/refract/edit/main/docs/review.md"',
		);
		expect(readFileSync(join(DIST_DIR, "core-onboarding.svg"))).toEqual(
			readFileSync(join(REPO_DIR, "docs/examples/onboarding.svg")),
		);
	});

	it("routes mapped guides locally and other source files to the repository", () => {
		expect(
			rewriteCanonicalLink(
				"./review.md#understand-coverage-and-recovery",
				"docs/usage.md",
			),
		).toBe("/refract/review/#understand-coverage-and-recovery");
		expect(
			rewriteCanonicalLink(
				"../packages/evidence-graph/src/schemas/revision.ts",
				"docs/usage.md",
			),
		).toBe(
			"https://github.com/refract-org/refract/blob/main/packages/evidence-graph/src/schemas/revision.ts",
		);
		expect(rewriteCanonicalLink("#local", "docs/review.md")).toBe("#local");
		expect(
			rewriteCanonicalLink("https://example.org/page", "docs/review.md"),
		).toBe("https://example.org/page");
	});

	it("routes a docs page's link to a guide's repository file to the guide's page", () => {
		expect(rewriteLink("../../../../../docs/review.md", "")).toBe(
			"/refract/review/",
		);
		expect(
			rewriteLink(
				"../../../../../../docs/usage.md#which-command-keeps-checking-a-source",
				"tutorials",
			),
		).toBe("/refract/usage/#which-command-keeps-checking-a-source");
	});
});
