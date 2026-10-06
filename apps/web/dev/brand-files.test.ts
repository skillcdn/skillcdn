import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BRAND_LOCKUP_WIDTH,
  BRAND_SYMBOL_COLOR,
  BRAND_SYMBOL_PATH,
  BRAND_WORDMARK_BOX,
  BRAND_WORDMARK_PATH,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";

const publicFile = (path: string) => fileURLToPath(new URL(`../public/${path}`, import.meta.url));
const read = (path: string) => readFileSync(publicFile(path), "utf8");
const exists = (path: string) => readFileSync(publicFile(path)).byteLength > 0;

// The pictures under public/ are files, so nothing imports the path data into them: these tests
// are what keeps them equal to what the pages and the server draw.
describe("the brand files", () => {
  it("draw the symbol the pages draw, in its own blue", () => {
    for (const file of ["brand/symbol.svg", "favicon.svg"]) {
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
      const logo = read(`brand/logo-${colour}.svg`);
      expect(logo).toContain(`viewBox="0 0 ${BRAND_LOCKUP_WIDTH} 100"`);
      expect(logo).toContain(`fill="${BRAND_SYMBOL_COLOR}" d="${BRAND_SYMBOL_PATH}"`);
      expect(logo).toContain(`fill="${fill}" d="${BRAND_WORDMARK_PATH}"`);
      const wordmark = read(`brand/wordmark-${colour}.svg`);
      const { x, y, width, height } = BRAND_WORDMARK_BOX;
      expect(wordmark).toContain(`viewBox="${x} ${y} ${width} ${height}"`);
      expect(wordmark).toContain(`fill="${fill}" d="${BRAND_WORDMARK_PATH}"`);
      expect(wordmark).not.toContain(BRAND_SYMBOL_PATH);
    }
  });

  it("ship as pictures as well, for whoever cannot take a vector", () => {
    for (const file of ["brand/symbol.png", "brand/logo-black.png", "brand/logo-white.png"]) {
      expect(exists(file), file).toBe(true);
    }
  });

  it("are the icons the page links to", () => {
    const page = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
    const links = [
      ["icon", "/favicon.ico"],
      ["icon", "/favicon.svg"],
      ["apple-touch-icon", "/apple-touch-icon.png"],
      ["manifest", "/manifest.webmanifest"],
    ] as const;
    for (const [rel, href] of links) {
      expect(page).toMatch(new RegExp(`<link rel="${rel}" href="${href}"`));
      expect(exists(href.slice(1)), href).toBe(true);
    }
    const manifest = JSON.parse(read("manifest.webmanifest")) as {
      readonly icons: readonly { readonly src: string }[];
    };
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(exists(icon.src.slice(1)), icon.src).toBe(true);
    }
  });
});
