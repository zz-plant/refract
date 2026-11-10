import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const bytes = (path: string) => readFileSync(join(ROOT, path));
const text = (path: string) => bytes(path).toString("utf8");

const SITES = ["apps/ui/public", "apps/docs/public"];
const RENDERED = ["favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];
const REGENERATE = "out of date: run `bun run assets:brand`";

const pathData = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((match) => match[1] as string);
const MARK = text("assets/brand/refract-mark.svg");
const LOGO = text("assets/brand/refract-logo.svg");

describe("brand assets", () => {
  it.each(SITES)("%s serves the current mark", (site) => {
    expect(text(`${site}/favicon.svg`), REGENERATE).toBe(MARK);
  });

  it.each(RENDERED)("every site serves the same %s", (name) => {
    const [first, second] = SITES.map((site) => bytes(`${site}/${name}`));
    expect(first?.equals(second as Buffer), REGENERATE).toBe(true);
  });

  it.each([
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
  ] as const)("%s is %ipx and opaque", (name, size) => {
    const png = bytes(`apps/ui/public/${name}`);
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    // Color type 2 is RGB with no alpha. iOS draws transparency as black.
    expect(png.readUInt8(25)).toBe(2);
  });

  it("favicon.ico holds the 16px and 32px renderings", () => {
    const ico = bytes("apps/ui/public/favicon.ico");
    expect(ico.readUInt16LE(4)).toBe(2);
    expect([ico.readUInt8(6), ico.readUInt8(22)]).toEqual([16, 32]);
  });

  it.each(SITES)("%s's manifest lists icons that exist", (site) => {
    const manifest = JSON.parse(text(`${site}/site.webmanifest`)) as { icons: { src: string; sizes: string }[] };
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
    for (const icon of manifest.icons) expect(bytes(`${site}/${icon.src}`).length).toBeGreaterThan(0);
  });

  const ICON_LINKS = ["favicon.ico", "favicon.svg", "apple-touch-icon.png", "site.webmanifest"];

  it("apps/ui/index.html links the icon set and draws the current mark", () => {
    const source = text("apps/ui/index.html");
    for (const name of ICON_LINKS) expect(source).toContain(`${name}"`);
    for (const data of pathData(MARK)) expect(source).toContain(data);
  });

  it("the docs site links the icon set and shows the mark itself as its logo", () => {
    const config = text("apps/docs/astro.config.mjs");
    for (const name of ICON_LINKS) expect(config).toMatch(new RegExp(`${name.replace(".", "\\.")}["\`]`));
    expect(config).toContain('logo: { src: "../../assets/brand/refract-mark.svg" }');
  });

  it("the social card draws the current logo", () => {
    const card = text("apps/docs/social-card.mjs");
    for (const data of pathData(LOGO)) expect(card).toContain(data);
  });
});
