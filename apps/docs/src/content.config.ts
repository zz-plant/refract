import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { CORE_GUIDES } from "../site.mjs";

const guideSlug = (file: string) =>
	Object.keys(CORE_GUIDES).find(
		(slug) => CORE_GUIDES[slug as keyof typeof CORE_GUIDES] === `docs/${file}`,
	) ?? file;

export const collections = {
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
	// The repository's own guides in docs/, published as they are. They have no
	// frontmatter; the site-links Markdown plugin takes each title from its H1.
	guides: defineCollection({
		loader: glob({
			base: "../../docs",
			pattern: Object.values(CORE_GUIDES).map((path) =>
				path.replace(/^docs\//, ""),
			),
			generateId: ({ entry }) => guideSlug(entry),
		}),
	}),
};
