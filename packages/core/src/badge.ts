import { BRAND_SYMBOL_COLOR, BRAND_SYMBOL_PATH } from "./brand.js";

// The badge of an address, for the README of its repository: the symbol and the name of the
// service on the pages' own ground, and a short fact beside them in the symbol's blue, as an SVG
// the server answers under `BADGE_ROUTE`. Drawn as text, so that it is tiny and sharp at any size.

const HEIGHT = 20;
const FONT_SIZE = 11;
const PADDING = 5;
const SYMBOL_SIZE = 14;
const SYMBOL_GAP = 3;
const LABEL = "SkillCDN";
const GROUND = "#0b1019";
const INK = "#fff";
/** More than any fact a badge states; what is longer is cut, so that the picture stays a badge. */
const MAX_VALUE_LENGTH = 40;

/**
 * The widths of the printable ASCII characters in Verdana at 11 pixels, in tenths of a pixel,
 * from the space on: the face badges are set in. The text is told its length, so a viewer whose
 * face differs fits it into the same room.
 */
const WIDTHS = [
  39, 43, 50, 90, 70, 118, 80, 30, 50, 50, 70, 90, 40, 50, 40, 50, 70, 70, 70, 70, 70, 70, 70, 70,
  70, 70, 50, 50, 90, 90, 90, 60, 110, 75, 75, 77, 85, 70, 63, 85, 83, 46, 50, 76, 61, 93, 82, 87,
  66, 87, 76, 75, 68, 81, 75, 109, 75, 68, 75, 50, 50, 50, 90, 70, 70, 66, 69, 57, 69, 66, 39, 69,
  70, 30, 38, 65, 30, 107, 70, 67, 69, 69, 47, 57, 43, 70, 65, 90, 65, 65, 58, 70, 50, 70, 90,
] as const;
/** What any other character is taken to be as wide as: a wide one. */
const OTHER_WIDTH = 110;

function textWidth(text: string): number {
  let tenths = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    tenths += code >= 0x20 && code <= 0x7e ? (WIDTHS[code - 0x20] ?? OTHER_WIDTH) : OTHER_WIDTH;
  }
  return tenths / 10;
}

const px = (value: number): string => String(Math.round(value * 10) / 10);

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The badge that says `value` of an address (`12 skills`), as an SVG document: the symbol and
 * `SkillCDN` on the dark ground, the value on the blue, 20 pixels tall, as wide as its words.
 */
export function renderBrandBadge(value: string): string {
  const fact = value.replaceAll(/\s+/g, " ").trim().slice(0, MAX_VALUE_LENGTH);
  const labelWidth = textWidth(LABEL);
  const valueWidth = textWidth(fact);
  const left = PADDING + SYMBOL_SIZE + SYMBOL_GAP + labelWidth + PADDING;
  const right = PADDING + valueWidth + PADDING;
  const width = left + right;
  const baseline = 14;
  const title = escapeXml(`${LABEL}: ${fact}`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px(width)}" height="${HEIGHT}" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<clipPath id="r"><rect width="${px(width)}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${px(left)}" height="${HEIGHT}" fill="${GROUND}"/>`,
    `<rect x="${px(left)}" width="${px(right)}" height="${HEIGHT}" fill="${BRAND_SYMBOL_COLOR}"/>`,
    "</g>",
    `<path transform="translate(${PADDING},${(HEIGHT - SYMBOL_SIZE) / 2}) scale(${SYMBOL_SIZE / 100})" fill="${BRAND_SYMBOL_COLOR}" d="${BRAND_SYMBOL_PATH}"/>`,
    `<g fill="${INK}" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${FONT_SIZE}" text-rendering="geometricPrecision">`,
    `<text x="${px(PADDING + SYMBOL_SIZE + SYMBOL_GAP)}" y="${baseline}" textLength="${px(labelWidth)}">${LABEL}</text>`,
    `<text x="${px(left + PADDING)}" y="${baseline}" textLength="${px(valueWidth)}">${escapeXml(fact)}</text>`,
    "</g>",
    "</svg>",
    "",
  ].join("\n");
}
