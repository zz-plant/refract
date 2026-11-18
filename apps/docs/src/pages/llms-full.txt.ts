// llms-full.txt: the Markdown source of every page, in one file.
import { fullTextOrder, llmsFull } from "../../llms.mjs";
import { sitePages } from "../llms";

export async function GET() {
	const pages = new Map((await sitePages()).map((page) => [page.slug, page]));
	const ordered = fullTextOrder(pages.keys()).map((slug) => pages.get(slug));
	return new Response(llmsFull(ordered), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
