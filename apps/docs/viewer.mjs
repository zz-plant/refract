// Builds the browser-only viewer in apps/ui into the site's viewer/ directory,
// so the published site serves it at <SITE_URL>viewer/. The viewer's own Vite
// config sets that base path; this only chooses where the output lands.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const VIEWER_DIR = "viewer";

const uiDir = fileURLToPath(new URL("../ui/", import.meta.url));
const vite = fileURLToPath(
	new URL("../ui/node_modules/vite/bin/vite.js", import.meta.url),
);

export function viewer() {
	return {
		name: "refract-viewer",
		hooks: {
			"astro:build:done": ({ dir, logger }) => {
				const outDir = fileURLToPath(new URL(`${VIEWER_DIR}/`, dir));
				execFileSync(
					process.execPath,
					[
						vite,
						"build",
						"--outDir",
						outDir,
						"--emptyOutDir",
						"--logLevel",
						"warn",
					],
					{ cwd: uiDir, stdio: "inherit" },
				);
				logger.info(`viewer built into ${outDir}`);
			},
		},
	};
}
