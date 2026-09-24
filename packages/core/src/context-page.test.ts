import { describe, expect, it } from "vitest";
import { contextPage } from "./context-page.js";

describe("contextPage", () => {
  it("bounds mixed-language text by bytes without splitting characters", () => {
    const text = `ab${String.fromCodePoint(0xac00)}${String.fromCodePoint(0x1f642)}z`;
    expect(contextPage(text, 0, 5)).toEqual({ content: text.slice(0, 3), bytes: 5, more: true });
    expect(contextPage(text, 3, 3)).toEqual({ content: "", bytes: 0, more: true });
    expect(contextPage(text, 3, 5)).toEqual({ content: text.slice(3), bytes: 5, more: false });
  });

  it("uses replacement-character byte size for isolated surrogates", () => {
    const text = String.fromCharCode(0xd800);
    expect(contextPage(text, 0, 2)).toEqual({ content: "", bytes: 0, more: true });
    expect(contextPage(text, 0, 3)).toEqual({ content: text, bytes: 3, more: false });
  });
});
