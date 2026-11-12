// Starlight writes the sitemap as sitemap-index.xml and sitemap-0.xml. The
// site published sitemap.xml before it moved to Starlight, so that address
// stays, as an index of the same sitemap.
import { SITE_URL } from "../../site.mjs";

export function GET() {
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${SITE_URL}sitemap-0.xml</loc></sitemap>
</sitemapindex>
`;
	return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
