import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../../site.mjs";
import { renderSocialCard } from "../../social-card.mjs";

export function GET() {
	const png = renderSocialCard({
		name: SITE_NAME,
		description: SITE_DESCRIPTION,
		address: SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, ""),
	});
	return new Response(png, { headers: { "Content-Type": "image/png" } });
}
