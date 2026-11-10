// Head tags Starlight does not write: JSON-LD for each page, `og:type` of
// `website` on the home page, and titles that already lead with the site name.
import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import {
	SITE_DESCRIPTION,
	SITE_NAME,
	SITE_URL,
	SOURCE_REPOSITORY,
} from "../site.mjs";

type SidebarEntry =
	| { type: "link"; label: string; isCurrent: boolean }
	| { type: "group"; entries: SidebarEntry[] };

const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function currentLabel(entries: SidebarEntry[]): string | undefined {
	for (const entry of entries) {
		if (entry.type === "link" && entry.isCurrent) return entry.label;
		if (entry.type === "group") {
			const label = currentLabel(entry.entries);
			if (label) return label;
		}
	}
	return undefined;
}

function structuredData(
	title: string,
	description: string,
	url: string,
	label: string,
) {
	const website = {
		"@type": "WebSite",
		"@id": `${SITE_URL}#website`,
		name: SITE_NAME,
		url: SITE_URL,
	};
	if (url === SITE_URL) {
		return {
			"@context": "https://schema.org",
			"@graph": [
				{
					...website,
					description,
					inLanguage: "en",
					about: { "@id": `${SITE_URL}#source` },
				},
				{
					"@type": "SoftwareSourceCode",
					"@id": `${SITE_URL}#source`,
					name: SITE_NAME,
					codeRepository: SOURCE_REPOSITORY,
				},
			],
		};
	}
	return {
		"@context": "https://schema.org",
		"@graph": [
			{
				"@type": "TechArticle",
				"@id": `${url}#article`,
				headline: title,
				description,
				url,
				mainEntityOfPage: url,
				inLanguage: "en",
				isPartOf: website,
			},
			{
				"@type": "BreadcrumbList",
				itemListElement: [
					{ "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
					{ "@type": "ListItem", position: 2, name: label, item: url },
				],
			},
		],
	};
}

export const onRequest = defineRouteMiddleware(({ locals }) => {
	const { head, entry, id, sidebar } = locals.starlightRoute;
	const { title } = entry.data;
	const description = entry.data.description || SITE_DESCRIPTION;
	const find = (tag: string, key: string, value: string) =>
		head.find((item) => item.tag === tag && item.attrs?.[key] === value);

	// The not-found page is served at whatever address was missing, so it
	// names no URL of its own.
	if (id === "404") {
		for (const tag of [
			find("link", "rel", "canonical"),
			find("meta", "property", "og:url"),
		]) {
			if (tag) head.splice(head.indexOf(tag), 1);
		}
	}
	const url = String(find("link", "rel", "canonical")?.attrs?.href ?? "");
	if (!url) return;

	// Starlight writes the title element's content as raw HTML, so it is
	// escaped here. A title that already leads with the name doesn't repeat it.
	const element = head.find((item) => item.tag === "title");
	if (element) {
		element.content = escapeHtml(
			title.startsWith(SITE_NAME) ? title : `${title} — ${SITE_NAME}`,
		);
	}
	const ogType = find("meta", "property", "og:type");
	if (url === SITE_URL && ogType?.attrs) ogType.attrs.content = "website";

	const label = currentLabel(sidebar as SidebarEntry[]) ?? title;
	// "<" is escaped so no title can close the script element early.
	head.push({
		tag: "script",
		attrs: { type: "application/ld+json" },
		content: JSON.stringify(
			structuredData(title, description, url, label),
		).replace(/</g, "\\u003c"),
	});
});
