import { fileURLToPath } from "node:url";
import { satteri } from "@astrojs/markdown-satteri";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { siteLinks } from "./links.mjs";
import {
	BASE,
	SITE_DESCRIPTION,
	SITE_NAME,
	SITE_URL,
	SOCIAL_CARD,
	SOURCE_REPOSITORY,
} from "./site.mjs";
import { CARD_HEIGHT, CARD_WIDTH } from "./social-card.mjs";
import { viewer } from "./viewer.mjs";

const docsDir = fileURLToPath(new URL("./src/content/docs", import.meta.url));
const repoDir = fileURLToPath(new URL("../..", import.meta.url));

const page = (label, slug) => ({ label, slug });
// The core guides are rendered by src/pages/[guide].astro, not the docs
// collection, so the sidebar links to their routes.
const guide = (label, slug) => ({ label, link: `/${slug}/` });

export default defineConfig({
	site: new URL(SITE_URL).origin,
	base: BASE,
	trailingSlash: "always",
	markdown: {
		processor: satteri({
			// Straight quotes stay straight: the pages quote commands, flags and
			// event text that readers copy.
			features: { smartPunctuation: false },
			mdastPlugins: [siteLinks({ docsDir, repoDir })],
		}),
	},
	integrations: [
		// The browser-only viewer from apps/ui, published at viewer/.
		viewer(),
		starlight({
			title: SITE_NAME,
			description: SITE_DESCRIPTION,
			titleDelimiter: "—",
			logo: { src: "../../assets/brand/refract-mark.svg" },
			favicon: "/favicon.svg",
			head: [
				{
					tag: "link",
					attrs: { rel: "icon", href: `${BASE}favicon.ico`, sizes: "32x32" },
				},
				{
					tag: "link",
					attrs: {
						rel: "apple-touch-icon",
						href: `${BASE}apple-touch-icon.png`,
					},
				},
				{
					tag: "link",
					attrs: { rel: "manifest", href: `${BASE}site.webmanifest` },
				},
				{
					tag: "meta",
					attrs: {
						property: "og:image",
						content: `${SITE_URL}${SOCIAL_CARD.file}`,
					},
				},
				{
					tag: "meta",
					attrs: { property: "og:image:width", content: String(CARD_WIDTH) },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:height", content: String(CARD_HEIGHT) },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:alt", content: SOCIAL_CARD.alt },
				},
			],
			social: [
				{ icon: "github", label: "GitHub", href: SOURCE_REPOSITORY },
				{
					icon: "npm",
					label: "npm packages",
					href: "https://www.npmjs.com/org/refract-org",
				},
			],
			editLink: { baseUrl: `${SOURCE_REPOSITORY}/edit/main/apps/docs/` },
			customCss: ["./src/styles/custom.css"],
			routeMiddleware: "./src/route-data.ts",
			sidebar: [
				{
					label: "Getting started",
					items: [
						page("Why Refract", "why-refract"),
						page("Compare to alternatives", "compare"),
						page("Demo", "demo"),
						page("Quick start", "quickstart"),
						guide("Review your sources", "review"),
						guide("History ranges and output", "usage"),
						page("Common events", "quickstart-events"),
						page("Complete workflow", "complete-workflow"),
						page("Install", "install"),
						page("Concepts", "concepts"),
					],
				},
				{
					label: "Reference",
					items: [
						page("CLI", "cli"),
						page("SDK / packages", "sdk"),
						page("Event schema", "schema"),
						page("Event taxonomy", "events"),
						page("Temporal model", "temporal-model"),
						page("Depth levels", "depth"),
						page("Bundles & manifests", "bundle-manifest"),
						page("Evaluation", "eval"),
						page("Architecture decisions", "architecture-decisions"),
					],
				},
				{
					label: "Integration",
					items: [
						page("Integrations overview", "integrations"),
						page("Downstream integration", "downstream"),
						page("MCP / AI agents", "mcp"),
						page("Python SDK", "python-sdk"),
						page("Refract UI", "visualizer"),
						page("Analytics with DuckDB", "analytics"),
						page("Notebooks", "notebooks"),
						page("Cron monitoring", "cron"),
					],
				},
				{
					label: "Tutorials",
					collapsed: true,
					items: [
						page("Wikipedia history", "tutorials/wikipedia-history"),
						page("Fandom canon", "tutorials/fandom-canon"),
						page("Citation churn", "tutorials/citation-churn"),
						page("Dispute timeline", "tutorials/dispute-timeline"),
						page("Cross-wiki diff", "tutorials/cross-wiki-diff"),
						page("Refract UI", "tutorials/refract-ui"),
						page("Combat revisionism", "tutorials/combating-revisionism"),
						page("RAG provenance", "tutorials/rag-provenance"),
						page("MCP agent", "tutorials/mcp-agent"),
						page("Scheduled monitoring", "tutorials/scheduled-monitoring"),
						page("Python SDK notebook", "tutorials/python-sdk"),
						page("BYO-inference", "tutorials/byo-inference"),
						page("Custom analyzer", "tutorials/custom-analyzer"),
						page("Custom eval labels", "tutorials/custom-eval"),
						page("Private wikis", "tutorials/private-wiki"),
						page("Non-English wikis", "tutorials/non-english"),
						page("Summarization", "tutorials/summarization"),
						page("Custom adapter", "tutorials/custom-adapter"),
						page("Model evaluation", "tutorials/model-evaluation"),
					],
				},
				{
					label: "Appendix",
					items: [
						page("Glossary", "glossary"),
						page("FAQ", "faq"),
						page("Interpreting output", "interpretation"),
						page("Security", "security"),
						page("Boundary", "boundary"),
						page("Naming", "naming"),
						page("Frontier use cases", "frontier-use-cases"),
						page("Contributing to docs", "contributing-docs"),
					],
				},
			],
		}),
	],
});
