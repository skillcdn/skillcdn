import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BRAND_FILES } from "./brand-files.js";

const webFile = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path: string) => readFileSync(webFile(path), "utf8");

type Pixel = readonly [number, number, number, number];

/** An opaque pixel of the colour a CSS hex value names. */
const opaque = (hex: string): Pixel => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
  255,
];

/**
 * The colour a PNG of the brand package stores under its first pixel. The package writes its
 * files row by row without filtering, so the first pixel follows the first row's filter byte.
 */
function storedFirstPixel(bytes: Uint8Array): Pixel {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data: Uint8Array[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  expect(raw[0], "the filter of the first row").toBe(0);
  return [raw[1] ?? 0, raw[2] ?? 0, raw[3] ?? 0, raw[4] ?? 0];
}

const served = (path: string): string => {
  const file = BRAND_FILES.get(path);
  if (file === undefined) throw new Error(`${path} is not a file of the brand package`);
  return file;
};

type Manifest = {
  readonly icons: readonly { readonly src: string }[];
  readonly background_color: string;
  readonly theme_color: string;
};
const manifest = JSON.parse(read("public/manifest.webmanifest")) as Manifest;

// The pictures of the brand are the files of @skillcdn/brand, served by the pages at the paths
// the page and the manifest name (dev/brand-files.ts).
describe("the brand files on the pages", () => {
  it("are the icons the page and the manifest link to", () => {
    const page = read("index.html");
    for (const [rel, href] of [
      ["icon", "/favicon.ico"],
      ["icon", "/favicon.svg"],
      ["apple-touch-icon", "/apple-touch-icon.png"],
    ] as const) {
      expect(page).toMatch(new RegExp(`<link rel="${rel}" href="${href}"`));
      expect(BRAND_FILES.has(href), href).toBe(true);
    }
    expect(page).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(BRAND_FILES.has(icon.src), icon.src).toBe(true);
    }
    // The logo the structured data names (src/seo/head.ts).
    expect(BRAND_FILES.has("/brand/logo-black.png")).toBe(true);
  });

  it("are served from files that exist", () => {
    expect(BRAND_FILES.size).toBeGreaterThan(0);
    for (const [path, file] of BRAND_FILES) {
      expect(readFileSync(file).byteLength, path).toBeGreaterThan(0);
    }
  });

  it("stand the tiles on the ground the manifest declares, which the page opens on", () => {
    const ground = opaque(manifest.background_color);
    for (const path of ["/apple-touch-icon.png", "/icon-192.png", "/icon-512.png"]) {
      expect(storedFirstPixel(readFileSync(served(path))), path).toEqual(ground);
    }
    expect(manifest.theme_color).toBe(manifest.background_color);
    expect(read("index.html")).toContain(
      `<meta name="theme-color" content="${manifest.theme_color}" />`,
    );
  });
});
