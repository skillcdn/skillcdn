import { BRAND_SYMBOL_COLOR, BRAND_SYMBOL_PATH, BRAND_WORDMARK_PATH } from "@skillcdn/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLogo, BrandSymbol } from "./brand.js";

describe("the brand components", () => {
  it("draw the symbol in its own colour and the wordmark in the text colour", () => {
    const symbol = renderToStaticMarkup(<BrandSymbol />);
    expect(symbol).toContain(`fill="${BRAND_SYMBOL_COLOR}"`);
    expect(symbol).toContain('aria-hidden="true"');
    const logo = renderToStaticMarkup(<BrandLogo />);
    expect(logo).toContain(`d="${BRAND_SYMBOL_PATH}"`);
    expect(logo).toContain(`fill="currentColor" d="${BRAND_WORDMARK_PATH}"`);
    expect(logo).toContain('aria-hidden="true"');
  });

  it("name the site when asked to, and are decorative otherwise", () => {
    const named = renderToStaticMarkup(<BrandLogo title="SkillCDN" />);
    expect(named).toContain('role="img"');
    expect(named).toContain("<title>SkillCDN</title>");
    expect(named).not.toContain("aria-hidden");
  });
});
