import { describe, expect, it } from "vitest";
import {
  LANDING_SECTIONS,
  MAX_SEARCH_TERM_LENGTH,
  normalizeSearchTerm,
  parseLandingSections,
  SEARCH_PAGE_PATH,
  searchPagePath,
  searchTermOfPath,
} from "./pages.js";

// The page of a search term (ADR-0075): one spelling of a term, one path for it, read back.

describe("a search term", () => {
  it("is written one way, whatever whitespace and control characters it came with", () => {
    expect(normalizeSearchTerm("  card   news\t")).toBe("card news");
    expect(normalizeSearchTerm("카드\u0000뉴스\n만들기")).toBe("카드 뉴스 만들기");
    expect(normalizeSearchTerm("   ")).toBe("");
    // Case is kept: the search reads words without it, and the page shows what was typed.
    expect(normalizeSearchTerm("GPT 6.1")).toBe("GPT 6.1");
    expect(normalizeSearchTerm(`${"a".repeat(MAX_SEARCH_TERM_LENGTH)} b`)).toHaveLength(
      MAX_SEARCH_TERM_LENGTH,
    );
  });

  it("has one path, and is read back from it", () => {
    expect(searchPagePath("")).toBe(SEARCH_PAGE_PATH);
    expect(searchPagePath("  ")).toBe(SEARCH_PAGE_PATH);
    expect(searchPagePath("card news")).toBe("/search/card%20news");
    expect(searchPagePath("인스타 카드뉴스")).toBe(
      "/search/%EC%9D%B8%EC%8A%A4%ED%83%80%20%EC%B9%B4%EB%93%9C%EB%89%B4%EC%8A%A4",
    );
    expect(searchPagePath("a/b?c")).toBe("/search/a%2Fb%3Fc");
    expect(searchTermOfPath(searchPagePath("a/b?c"))).toBe("a/b?c");
    expect(searchTermOfPath(searchPagePath("인스타 카드뉴스"))).toBe("인스타 카드뉴스");
    expect(searchTermOfPath("/search")).toBe("");
    // What is read back is as written: the server compares it with the normalized spelling.
    expect(searchTermOfPath("/search/card%20%20news")).toBe("card  news");
  });

  it("is no term where the path is something else or cannot be decoded", () => {
    expect(searchTermOfPath("/searching")).toBeUndefined();
    expect(searchTermOfPath("/search/")).toBeUndefined();
    expect(searchTermOfPath("/search/a/b")).toBeUndefined();
    expect(searchTermOfPath("/search/%E0%A4%A")).toBeUndefined();
    expect(searchTermOfPath("/explore")).toBeUndefined();
  });
});

describe("the sections of the front page", () => {
  it("are listed by name, in the page's order, each once", () => {
    expect(parseLandingSections("")).toEqual([]);
    expect(parseLandingSections("faq, packs,packs")).toEqual(["packs", "faq"]);
    expect(parseLandingSections(LANDING_SECTIONS.join(","))).toEqual([...LANDING_SECTIONS]);
    expect(parseLandingSections("packs,hero")).toBeUndefined();
    expect(parseLandingSections("all")).toBeUndefined();
  });
});
