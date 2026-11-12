import { defineConfig } from "vite";

// The docs site publishes the viewer at https://zz-plant.github.io/refract/viewer/
// (apps/docs/viewer.mjs builds it into the site). The dev server stays at
// http://localhost:5173/.
const PUBLISHED_BASE = "/refract/viewer/";

export default defineConfig(({ command }) => ({
	root: ".",
	base: command === "build" ? PUBLISHED_BASE : "/",
	build: {
		outDir: "dist",
		// The bundle is one module with nothing to preload. Without the polyfill
		// its only request is for the sample data (apps/docs/tests/viewer.test.ts).
		modulePreload: { polyfill: false },
	},
}));
