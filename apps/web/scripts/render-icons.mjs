// Draws the icon files under public/ from the path data in core, so that they show the same
// symbol as the pages and can be made again after the symbol changes:
//
//   pnpm --filter @skillcdn/web run generate:icons     (build core first)
//
// The icons a platform shows in its own chrome (the home screen, an app list, a launcher) are the
// symbol on a white tile: some of those platforms cannot show a transparent icon and paint one on
// black. The brand symbol, the lockups and the favicon stay transparent, with the ground they
// are meant for stored under their transparent pixels (white, or black under the white lockup),
// so that a reader which drops the alpha channel shows them on that ground.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import {
  BRAND_LOCKUP_WIDTH,
  BRAND_SYMBOL_COLOR,
  BRAND_SYMBOL_PATH,
  BRAND_WORDMARK_PATH,
} from "@skillcdn/core";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

/** How much of a tile's height the symbol takes: inside the safe zone of a maskable icon. */
const TILE_SYMBOL_HEIGHT = 0.58;

/** The symbol, centred, `size` tall, in a `width` by `width` canvas, on `ground` or on nothing. */
function draw(width, size, ground) {
  const canvas = createCanvas(width, width);
  const ctx = canvas.getContext("2d");
  if (ground !== undefined) {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, width, width);
  }
  const scale = size / 100;
  ctx.translate((width - size) / 2, (width - size) / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = BRAND_SYMBOL_COLOR;
  ctx.fill(new Path2D(BRAND_SYMBOL_PATH));
  return canvas;
}

/** The lockup, `width` wide, the wordmark in `ink`, on nothing. */
function drawLockup(width, ink) {
  const scale = width / BRAND_LOCKUP_WIDTH;
  const canvas = createCanvas(width, Math.round(100 * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = BRAND_SYMBOL_COLOR;
  ctx.fill(new Path2D(BRAND_SYMBOL_PATH));
  ctx.fillStyle = ink;
  ctx.fill(new Path2D(BRAND_WORDMARK_PATH));
  return canvas;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * A transparent PNG written from straight RGBA pixels, with `ground` (r, g, b) under every
 * transparent pixel. A canvas cannot keep a colour under alpha zero, so the file is written here
 * rather than by it.
 */
function transparentPng(canvas, ground) {
  const { width, height } = canvas;
  const { data } = canvas.getContext("2d").getImageData(0, 0, width, height);
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const from = y * stride + x * 4;
      const to = y * (stride + 1) + 1 + x * 4;
      const alpha = data[from + 3];
      raw[to] = alpha === 0 ? ground[0] : data[from];
      raw[to + 1] = alpha === 0 ? ground[1] : data[from + 1];
      raw[to + 2] = alpha === 0 ? ground[2] : data[from + 2];
      raw[to + 3] = alpha;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An ICO that carries PNG-compressed frames, which every current browser reads. */
function ico(frames) {
  const directory = Buffer.alloc(6 + 16 * frames.length);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2); // icon
  directory.writeUInt16LE(frames.length, 4);
  let offset = directory.length;
  frames.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size === 256 ? 0 : size;
    directory[entry + 1] = size === 256 ? 0 : size;
    directory[entry + 2] = 0; // colours in palette
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([directory, ...frames.map(({ png }) => png)]);
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const tile = (width) => draw(width, width * TILE_SYMBOL_HEIGHT, "#ffffff").toBuffer("image/png");
const transparent = (width) => transparentPng(draw(width, width), WHITE);

const files = {
  "apple-touch-icon.png": tile(180),
  "icon-192.png": tile(192),
  "icon-512.png": tile(512),
  "favicon.ico": ico([16, 32, 48].map((size) => ({ size, png: transparent(size) }))),
  "brand/symbol.png": transparent(512),
  "brand/logo-black.png": transparentPng(drawLockup(1200, "#000000"), WHITE),
  "brand/logo-white.png": transparentPng(drawLockup(1200, "#ffffff"), BLACK),
};
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(join(publicDir, name), bytes);
}
