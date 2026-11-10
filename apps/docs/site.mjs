// Facts about the published site, shared by the Astro config, the routes that
// render engine files, and the tests.

export const SITE_URL = "https://refract-org.github.io/refract/";
// GitHub Pages serves this repository's site under /refract/.
export const BASE = "/refract/";
export const SITE_NAME = "Refract";
export const SITE_DESCRIPTION =
	"A git log for Wikipedia: see how a page's sentences, citations, and structure changed, revision by revision, as data you can check.";
export const SOURCE_REPOSITORY = "https://github.com/refract-org/refract";
// Where the docs pages live in the repository.
export const PAGES_PATH = "apps/docs/src/content/docs";

// Guides kept with the engine in the repository's docs/ and published here as
// they are, keyed by the page slug they appear at.
export const CORE_GUIDES = {
	review: "docs/review.md",
	usage: "docs/usage.md",
};

// Engine output published at the site root, keyed by its file name there.
export const CORE_ASSETS = {
	"core-onboarding.svg": "docs/examples/onboarding.svg",
};

// One Open Graph card for every page, rendered at build time from the name
// and description above.
export const SOCIAL_CARD = {
	file: "social-card.png",
	alt: `${SITE_NAME}. ${SITE_DESCRIPTION}`,
};
