// Regenerate the toolbar/extension PNG icons from their SVG sources.
//
// Source of truth: assets/icon.svg (online) and assets/icon-offline.svg.
// Output: public/icons/icon-{size}.png and icon-offline-{size}.png, which WXT
// copies to the build root and the manifest references.
//
// Rasterizer: macOS `sips` (always present on the dev machines this ships from).
// On other platforms, install librsvg (`rsvg-convert`) or ImageMagick and adapt
// the RASTERIZERS list below — the PNGs are committed, so regen is only needed
// when the SVGs change.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "assets");
const OUT = path.join(ROOT, "public", "icons");
const SIZES = [16, 32, 48, 128];
const VARIANTS = [
  { svg: "icon.svg", prefix: "icon" },
  { svg: "icon-offline.svg", prefix: "icon-offline" },
];

function rasterize(svgPath, pngPath, size) {
  // sips reads SVG and writes a square PNG at the requested pixel size.
  execFileSync("sips", [
    "-s", "format", "png",
    "-z", String(size), String(size),
    svgPath,
    "--out", pngPath,
  ], { stdio: "ignore" });
}

mkdirSync(OUT, { recursive: true });
for (const { svg, prefix } of VARIANTS) {
  const svgPath = path.join(ASSETS, svg);
  if (!existsSync(svgPath)) {
    console.error(`missing source SVG: ${svgPath}`);
    process.exit(1);
  }
  for (const size of SIZES) {
    const pngPath = path.join(OUT, `${prefix}-${size}.png`);
    rasterize(svgPath, pngPath, size);
    console.log(`wrote ${path.relative(ROOT, pngPath)}`);
  }
}
