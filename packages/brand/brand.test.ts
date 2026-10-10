import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  BRAND_LOCKUP_WIDTH,
  BRAND_SYMBOL_COLOR,
  BRAND_SYMBOL_PATH,
  BRAND_WORDMARK_BOX,
  BRAND_WORDMARK_PATH,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";

const packageFile = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const read = (name: string) => readFileSync(packageFile(name), "utf8");
const bytesOf = (name: string) => readFileSync(packageFile(name));

type Pixel = readonly [number, number, number, number];

const SYMBOL_BLUE: Pixel = [0x3a, 0x6d, 0xd4, 255];
/**
 * The ground the tiles and the banner stand on (scripts/render.mjs): the colour SkillCDN's pages
 * open on. The web UI's own test keeps its manifest equal to what the tiles show.
 */
const GROUND = "#0b1019";
/** An opaque pixel of the colour a CSS hex value names. */
const opaque = (hex: string): Pixel => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
  255,
];
const near = (pixel: Pixel, colour: Pixel) =>
  pixel.every((channel, index) => Math.abs(channel - (colour[index] ?? 0)) <= 8);

/** The picture a PNG shows, pixel by pixel, as straight RGBA. */
async function picture(bytes: Uint8Array) {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  const at = (x: number, y: number): Pixel => {
    const offset = (y * image.width + x) * 4;
    return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0];
  };
  let symbol = 0;
  let transparent = 0;
  let other = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const pixel = at(x, y);
      if (pixel[3] === 0) transparent++;
      else if (near(pixel, SYMBOL_BLUE)) symbol++;
      else if (pixel[3] === 255) other++;
    }
  }
  const area = image.width * image.height;
  // `symbol` is the share of the picture in the symbol's blue; `other` counts the opaque pixels
  // of any other colour, which a transparent picture of the symbol must not have.
  return {
    width: image.width,
    height: image.height,
    at,
    symbol: symbol / area,
    transparent,
    other,
  };
}

/**
 * The colour a PNG stores under its first pixel, alpha included: what a reader that drops the
 * alpha channel would show there. Every file is written row by row without filtering
 * (`scripts/render.mjs`), so the first pixel follows the first row's filter byte.
 */
function storedFirstPixel(bytes: Uint8Array): Pixel {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

/** The frames of an icon file: their declared size and their PNG bytes. */
function icoFrames(
  bytes: Uint8Array,
): readonly { readonly size: number; readonly png: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint16(2, true), "an icon, not a cursor").toBe(1);
  const count = view.getUint16(4, true);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const length = view.getUint32(entry + 8, true);
    const offset = view.getUint32(entry + 12, true);
    return { size: bytes[entry] || 256, png: bytes.subarray(offset, offset + length) };
  });
}

type Manifest = {
  readonly license: string;
  readonly exports: Readonly<Record<string, string>>;
  readonly files: readonly string[];
};
const manifest = JSON.parse(read("package.json")) as Manifest;
/** What the package exports, as file names. */
const exported = Object.keys(manifest.exports)
  .filter((entry) => entry !== "./package.json")
  .map((entry) => entry.slice("./".length));

// The pictures are files, so nothing imports the path data into them: these tests are what keeps
// them equal to what the pages and the server draw.
describe("the brand files", () => {
  it("draw the symbol the pages draw, in its own blue", () => {
    for (const file of ["symbol.svg", "favicon.svg"]) {
      const svg = read(file);
      expect(svg, file).toContain(`fill="${BRAND_SYMBOL_COLOR}" d="${BRAND_SYMBOL_PATH}"`);
      expect(svg, file).toContain('viewBox="0 0 100 100"');
      expect(svg, file).toContain("<title>SkillCDN</title>");
    }
  });

  it("draw the lockup in black and in white, and the wordmark alone in each", () => {
    for (const [colour, fill] of [
      ["black", "#000"],
      ["white", "#fff"],
    ] as const) {
      const logo = read(`logo-${colour}.svg`);
      expect(logo).toContain(`viewBox="0 0 ${BRAND_LOCKUP_WIDTH} 100"`);
      expect(logo).toContain(`fill="${BRAND_SYMBOL_COLOR}" d="${BRAND_SYMBOL_PATH}"`);
      expect(logo).toContain(`fill="${fill}" d="${BRAND_WORDMARK_PATH}"`);
      const wordmark = read(`wordmark-${colour}.svg`);
      const { x, y, width, height } = BRAND_WORDMARK_BOX;
      expect(wordmark).toContain(`viewBox="${x} ${y} ${width} ${height}"`);
      expect(wordmark).toContain(`fill="${fill}" d="${BRAND_WORDMARK_PATH}"`);
      expect(wordmark).not.toContain(BRAND_SYMBOL_PATH);
    }
  });

  it("ship the symbol as a picture, transparent around it and white underneath", async () => {
    const bytes = bytesOf("symbol.png");
    const symbol = await picture(bytes);
    expect([symbol.width, symbol.height]).toEqual([512, 512]);
    expect(symbol.at(0, 0)[3], "transparent at the corner").toBe(0);
    expect(symbol.symbol, "the share of the picture that is the symbol").toBeGreaterThan(0.5);
    expect(symbol.other, "no colour but the symbol's blue").toBe(0);
    expect(storedFirstPixel(bytes)).toEqual([255, 255, 255, 0]);
  });

  it("ship the symbol with room around it as an account picture, transparent, white underneath", async () => {
    const bytes = bytesOf("avatar.png");
    const avatar = await picture(bytes);
    expect([avatar.width, avatar.height]).toEqual([1024, 1024]);
    expect(avatar.at(0, 0)[3], "transparent at the corner").toBe(0);
    expect(avatar.at(512, 0)[3], "room above the symbol").toBe(0);
    expect(avatar.symbol, "the share of the picture that is the symbol").toBeGreaterThan(0.15);
    expect(avatar.symbol, "the symbol keeps its room").toBeLessThan(0.35);
    expect(storedFirstPixel(bytes)).toEqual([255, 255, 255, 0]);
    expect(avatar.other, "no colour but the symbol's blue").toBe(0);
  });

  it("ship the lockup as pictures, each with the ground it is meant for underneath", async () => {
    for (const [colour, ground] of [
      ["black", [255, 255, 255, 0]],
      ["white", [0, 0, 0, 0]],
    ] as const) {
      const bytes = bytesOf(`logo-${colour}.png`);
      const logo = await picture(bytes);
      expect([logo.width, logo.height], colour).toEqual([1200, 199]);
      expect(logo.at(0, 0)[3], `${colour}: transparent at the corner`).toBe(0);
      expect(logo.symbol, `${colour}: the symbol is there`).toBeGreaterThan(0.05);
      expect(storedFirstPixel(bytes), colour).toEqual(ground);
    }
  });

  it("show the symbol on the pages' own ground where a platform needs an opaque icon", async () => {
    const ground = opaque(GROUND);
    for (const [file, size] of [
      ["apple-touch-icon.png", 180],
      ["icon-192.png", 192],
      ["icon-512.png", 512],
    ] as const) {
      const bytes = bytesOf(file);
      const icon = await picture(bytes);
      expect([icon.width, icon.height], file).toEqual([size, size]);
      expect(icon.transparent, `${file}: opaque throughout`).toBe(0);
      expect(storedFirstPixel(bytes), file).toEqual(ground);
      for (const [x, y] of [
        [0, 0],
        [size - 1, 0],
        [0, size - 1],
        [size - 1, size - 1],
        [size >> 1, 0],
        [0, size >> 1],
      ] as const) {
        expect(icon.at(x, y), `${file} at ${x},${y}`).toEqual(ground);
      }
      // Inside the safe zone of a maskable icon: the symbol's box is 0.58 of the tile each way,
      // and the symbol fills about two thirds of its box.
      expect(icon.symbol, `${file}: the share of the tile that is the symbol`).toBeGreaterThan(
        0.15,
      );
      expect(icon.symbol, `${file}: the symbol keeps its margin`).toBeLessThan(0.3);
    }
  });

  it("ship the lockup on the pages' own ground at two to one, as a banner", async () => {
    const bytes = bytesOf("banner.png");
    const banner = await picture(bytes);
    expect([banner.width, banner.height]).toEqual([1200, 600]);
    expect(banner.transparent, "opaque throughout").toBe(0);
    expect(banner.at(0, 0)).toEqual(opaque(GROUND));
    expect(banner.at(1199, 599)).toEqual(opaque(GROUND));
    expect(storedFirstPixel(bytes)).toEqual(opaque(GROUND));
    expect(banner.symbol, "the symbol is there").toBeGreaterThan(0.01);
    expect(banner.at(600, 300)[3], "the wordmark is there, in white").toBe(255);
  });

  it("keep the favicon transparent, white underneath, in the sizes a browser asks for", () => {
    const frames = icoFrames(bytesOf("favicon.ico"));
    expect(frames.map((frame) => frame.size)).toEqual([16, 32, 48]);
    for (const frame of frames) {
      expect(storedFirstPixel(frame.png), `${frame.size}`).toEqual([255, 255, 255, 0]);
    }
  });
});

describe("the package", () => {
  it("exports every picture by its path, and ships each one", () => {
    const pictures = readdirSync(packageFile("."))
      .filter((name) => /\.(?:svg|png|ico)$/.test(name))
      .sort();
    expect([...exported].sort(), "every picture in the directory is exported").toEqual(pictures);
    for (const file of exported) {
      expect(manifest.exports[`./${file}`], file).toBe(`./${file}`);
      expect(manifest.files, `${file} is packed`).toContain(file);
      expect(bytesOf(file).byteLength, `${file} has content`).toBeGreaterThan(0);
    }
    expect(manifest.exports["./package.json"]).toBe("./package.json");
  });

  it("is licensed under the trademark policy, which ships with it", () => {
    expect(manifest.license).toBe("SEE LICENSE IN LICENSE.md");
    const license = read("LICENSE.md");
    expect(license).toContain("SkillCDN Trademark Policy");
    expect(license).toContain("`TRADEMARKS.md`");
    expect(manifest.files, "the policy is packed").toContain("TRADEMARKS.md");
    // The policy is copied from the repository's root at pack time, so that its text has one
    // source; what is packed is what the repository says.
    expect(read("../../TRADEMARKS.md")).toContain("# SkillCDN Trademark Policy");
  });
});
