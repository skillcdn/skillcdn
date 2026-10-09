import { describe, expect, it } from "vitest";
import { renderBrandBadge } from "./badge.js";
import { BRAND_SYMBOL_COLOR, BRAND_SYMBOL_PATH } from "./brand.js";

const widthOf = (svg: string): number => Number(/<svg [^>]*width="([\d.]+)"/.exec(svg)?.[1]);

describe("renderBrandBadge", () => {
  it("draws the symbol, the name of the service and the fact, and names them for a reader", () => {
    const svg = renderBrandBadge("12 skills");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`fill="${BRAND_SYMBOL_COLOR}" d="${BRAND_SYMBOL_PATH}"`);
    expect(svg).toContain(">SkillCDN</text>");
    expect(svg).toContain(">12 skills</text>");
    expect(svg).toContain('aria-label="SkillCDN: 12 skills"');
    expect(svg).toContain("<title>SkillCDN: 12 skills</title>");
    expect(svg).toContain('height="20"');
  });

  it("is as wide as its words", () => {
    const short = renderBrandBadge("1 skill");
    const long = renderBrandBadge("1234 skills and counting");
    expect(widthOf(short)).toBeGreaterThan(80);
    expect(widthOf(long)).toBeGreaterThan(widthOf(short) + 60);
    // The text is told its length, so that a viewer without the face fits it into the same room.
    expect(short).toMatch(/<text [^>]*textLength="[\d.]+">1 skill<\/text>/);
  });

  it("keeps the fact to a badge, as text", () => {
    const svg = renderBrandBadge('  <b>x</b> & "y"  ');
    expect(svg).toContain(">&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;</text>");
    expect(svg).not.toContain("<b>");
    const cut = renderBrandBadge("x".repeat(200));
    expect(cut).toContain(`>${"x".repeat(40)}</text>`);
    expect(widthOf(cut)).toBeLessThan(400);
  });
});
