#!/usr/bin/env bun
/**
 * Renders assets/brand/refract-mark.svg into the icon set each site serves.
 * Requires rsvg-convert and ImageMagick. Run after changing the mark:
 *   bun run assets:brand
 * tests/brand-assets.test.ts fails when a site's copy falls behind the source.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MARK = join(ROOT, "assets/brand/refract-mark.svg");
const SITES = [join(ROOT, "apps/ui/public"), join(ROOT, "apps/docs/public")];
const TILE = "#0c0f1a";

// The source's default colors are for light backgrounds, which is what a
// renderer without media query support draws. These swap in its dark palette.
const DARK_PALETTE = [
  ["#5b68e0", "#7c8aff"],
  ["#ea580c", "#fb923c"],
] as const;

function darkMarkOnTile(mark: string): string {
  let body = mark
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  for (const [light, dark] of DARK_PALETTE) body = body.replaceAll(light, dark);
  // 20% padding keeps the mark inside the circle Android masks a launcher icon to.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 26 26"><rect x="-5" y="-5" width="26" height="26" fill="${TILE}"/>${body}</svg>`;
}

const work = mkdtempSync(join(tmpdir(), "refract-brand-"));
try {
  const mark = readFileSync(MARK, "utf8");
  const tileSvg = join(work, "tile.svg");
  writeFileSync(tileSvg, darkMarkOnTile(mark));

  const render = (source: string, size: number, out: string) =>
    execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", out, source]);

  const tiled: Record<string, number> = {
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
  };
  for (const [name, size] of Object.entries(tiled)) {
    const out = join(work, name);
    render(tileSvg, size, out);
    // A touch icon with an alpha channel renders as a black square on iOS.
    execFileSync("magick", [out, "-alpha", "remove", "-alpha", "off", out]);
  }

  const small = [16, 32].map((size) => {
    const out = join(work, `mark-${size}.png`);
    render(MARK, size, out);
    return out;
  });
  execFileSync("magick", [...small, join(work, "favicon.ico")]);

  for (const site of SITES) {
    copyFileSync(MARK, join(site, "favicon.svg"));
    for (const name of [...Object.keys(tiled), "favicon.ico"]) {
      copyFileSync(join(work, name), join(site, name));
    }
    console.log(`Wrote the icon set to ${site}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
