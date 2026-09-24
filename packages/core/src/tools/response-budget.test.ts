import { describe, expect, it } from "vitest";
import { compactSummary, serializedResultBytes } from "./response-budget.js";

describe("MCP response budgets", () => {
  it("counts JSON escaping and both output representations", () => {
    const value = {
      content: [{ type: "text", text: 'a\n"b' }],
      structuredContent: { body: 'a\n"b' },
    };
    expect(serializedResultBytes(value)).toBe(JSON.stringify(value).length);
    expect(serializedResultBytes(value)).toBeGreaterThan(
      serializedResultBytes(value.structuredContent),
    );
  });

  it("counts multilingual and astral characters as UTF-8, including escaped lone surrogates", () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(serializedResultBytes({ text: `aé한${emoji}` })).toBe(21);
    expect(serializedResultBytes({ text: String.fromCharCode(0xd800) })).toBe(17);
  });

  it("flattens summaries without splitting an astral character or mutating source text", () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(compactSummary("  a\n b\t c  ", 20)).toBe("a b c");
    expect(compactSummary(`a${emoji}bc`, 3)).toBe("a…");
    expect(compactSummary(`a${emoji}bc`, 4)).toBe(`a${emoji}…`);
    expect(compactSummary("abc", 0)).toBe("");
    expect(compactSummary("abc", 1)).toBe("…");
  });
});
