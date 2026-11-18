// The pages llms.txt and llms-full.txt are made from: every docs page and
// core guide, with its title and its Markdown, links resolved as the site
// resolves them and then made absolute.
import { getCollection } from "astro:content";
import { rewriteCanonicalLink, rewriteLink } from "../links.mjs";
import { absoluteUrl, pageUrl, rewriteLinks } from "../llms.mjs";
import { CORE_GUIDES } from "../site.mjs";

export type SitePage = { slug: string; title: string; markdown: string };

export async function sitePages(): Promise<SitePage[]> {
	const docs = (await getCollection("docs")).map((entry) => {
		const slug = entry.id;
		const dir = slug.includes("/") ? slug.slice(0, slug.lastIndexOf("/")) : "";
		const markdown = rewriteLinks(entry.body ?? "", (href) =>
			absoluteUrl(rewriteLink(href, dir), pageUrl(slug)),
		);
		return { slug, title: entry.data.title, markdown };
	});

	// A core guide has no frontmatter; its H1 is its title, as on the site.
	const guides = (await getCollection("guides")).map((entry) => {
		const slug = entry.id;
		const source = CORE_GUIDES[slug as keyof typeof CORE_GUIDES];
		const body = entry.body ?? "";
		const h1 = body.match(/^# (.+)$/m);
		if (!h1) throw new Error(`${source} has no H1 to title it`);
		const markdown = rewriteLinks(body.replace(h1[0], ""), (href) =>
			absoluteUrl(rewriteCanonicalLink(href, source), pageUrl(slug)),
		);
		return { slug, title: h1[1].trim(), markdown };
	});

	return [...docs, ...guides];
}
