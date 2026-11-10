// Builds the site once before the tests that read dist/.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Vitest copies its own import.meta.env (BASE_URL "/", MODE "test") into
// process.env. Passed on, they would override the site's base in the build.
const VITEST_ENV = ["BASE_URL", "MODE", "DEV", "PROD", "SSR", "NODE_ENV"];

export default function setup() {
	const root = resolve(import.meta.dirname, "..");
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !VITEST_ENV.includes(key)),
	);
	execFileSync(
		resolve(root, "node_modules/.bin/astro"),
		["build", "--silent"],
		{
			cwd: root,
			env,
			stdio: "inherit",
		},
	);
}
