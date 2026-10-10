import { describe, expect, it } from "vitest";
import { createSlugger, headingText } from "./slug.js";

describe("createSlugger", () => {
  it("makes the id the git host makes for the same heading", () => {
    const slug = createSlugger();
    expect(slug("Licenses")).toBe("licenses");
    expect(slug("The repository manifest: SKILLCDN.md")).toBe("the-repository-manifest-skillcdnmd");
    expect(slug("GET /api/v1/owners/gh/<owner>?page=")).toBe("get-apiv1ownersghownerpage");
    expect(slug("Where the ref ends")).toBe("where-the-ref-ends");
    expect(slug("One segment short: the page of an account")).toBe(
      "one-segment-short-the-page-of-an-account",
    );
    expect(slug("snake_case and hy-phens")).toBe("snake_case-and-hy-phens");
    expect(slug("한국어 제목")).toBe("한국어-제목");
  });

  it("counts a repeated heading, as the host does", () => {
    const slug = createSlugger();
    expect(slug("Open questions")).toBe("open-questions");
    expect(slug("Open questions")).toBe("open-questions-1");
    expect(slug("Open Questions")).toBe("open-questions-2");
    expect(slug("Other")).toBe("other");
  });
});

describe("headingText", () => {
  it("reads the text and the code of a heading and nothing else", () => {
    const heading = {
      type: "heading",
      depth: 2,
      children: [
        { type: "text", value: "The " },
        { type: "emphasis", children: [{ type: "text", value: "repository" }] },
        { type: "text", value: " manifest: " },
        { type: "inlineCode", value: "SKILLCDN.md" },
        { type: "html", value: "<b>" },
        { type: "link", url: "x", children: [{ type: "text", value: " link" }] },
      ],
    };
    expect(headingText(heading)).toBe("The repository manifest: SKILLCDN.md link");
    expect(headingText(null)).toBe("");
    expect(headingText({ type: "text" })).toBe("");
  });
});
