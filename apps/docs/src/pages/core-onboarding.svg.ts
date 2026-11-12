// The engine's captured onboarding diagram (CORE_ASSETS in site.mjs), served
// from the docs/examples copy that `bun run check:examples` keeps current.
import svg from "../../../../docs/examples/onboarding.svg?raw";

export function GET() {
	return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
}
