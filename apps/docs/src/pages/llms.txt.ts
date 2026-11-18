// llms.txt (https://llmstxt.org/): the pages an agent needs, by section.
import { llmsIndex } from "../../llms.mjs";
import { sitePages } from "../llms";

export async function GET() {
	const titles = new Map(
		(await sitePages()).map(({ slug, title }) => [slug, title]),
	);
	return new Response(llmsIndex(titles), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
