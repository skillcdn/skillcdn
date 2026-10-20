import { describe, expect, it } from "vitest";
import { headingPaths, MAX_OUTLINE_HEADINGS, outlineMarkdown } from "./outline.js";

const DOCUMENT = [
  "---",
  "title: The Guide",
  "---",
  "# The Guide",
  "",
  "An introduction.",
  "",
  "## Install",
  "",
  "Run the installer.",
  "",
  "### Windows",
  "",
  "Use the installer for Windows.",
  "",
  "## Use",
  "",
  "Open the app.",
  "",
].join("\n");

describe("outlineMarkdown", () => {
  it("lists the headings with the offset of each line and the length to the next heading", () => {
    const outline = outlineMarkdown(DOCUMENT);
    expect(outline.bodyOffset).toBe(DOCUMENT.indexOf("# The Guide"));
    expect(outline.totalLength).toBe(DOCUMENT.length);
    expect(outline.truncated).toBe(false);
    expect(outline.headings.map((heading) => [heading.level, heading.text])).toEqual([
      [1, "The Guide"],
      [2, "Install"],
      [3, "Windows"],
      [2, "Use"],
    ]);
    for (const [index, heading] of outline.headings.entries()) {
      expect(DOCUMENT.slice(heading.offset)).toMatch(/^#/);
      const next = outline.headings[index + 1];
      expect(heading.offset + heading.length).toBe(next?.offset ?? DOCUMENT.length);
    }
    // A section is read as `read_repo_file` reads it: by its offset and its length.
    const install = outline.headings[1];
    expect(DOCUMENT.slice(install?.offset, (install?.offset ?? 0) + (install?.length ?? 0))).toBe(
      "## Install\n\nRun the installer.\n\n",
    );
  });

  it("reads setext headings, and leaves a thematic break and a list alone", () => {
    const text = "Title\n=====\n\nIntro.\n\nSecond\n---\n\n- item\n---\n\n***\n";
    const outline = outlineMarkdown(text);
    expect(
      outline.headings.map((heading) => [heading.level, heading.text, heading.offset]),
    ).toEqual([
      [1, "Title", 0],
      [2, "Second", text.indexOf("Second")],
    ]);
  });

  it("ignores headings inside fenced code and HTML blocks, and strips markup from the text", () => {
    const text = [
      "```md",
      "# not a heading",
      "```",
      "<div>",
      "# not one either",
      "</div>",
      "",
      "## A `code` [link](x.md) *em* ##",
      "#",
      "####### seven is text",
    ].join("\n");
    const outline = outlineMarkdown(text);
    expect(outline.headings.map((heading) => [heading.level, heading.text])).toEqual([
      [2, "A code link em"],
      [1, ""],
    ]);
  });

  it("answers an empty outline for text without headings, and bounds a hostile one", () => {
    expect(outlineMarkdown("Just prose.\n").headings).toEqual([]);
    expect(outlineMarkdown("").totalLength).toBe(0);
    const many = outlineMarkdown("# h\n".repeat(MAX_OUTLINE_HEADINGS + 5));
    expect(many.headings).toHaveLength(MAX_OUTLINE_HEADINGS);
    expect(many.truncated).toBe(true);
    const lastKept = many.headings[MAX_OUTLINE_HEADINGS - 1];
    expect(lastKept?.length).toBe(4);
    const invisible = `# Title${String.fromCodePoint(0x200b)}\n`;
    expect(outlineMarkdown(invisible).headings[0]?.text).toBe("");
    expect(outlineMarkdown(`# ${"x".repeat(5000)}\n`).headings).toEqual([]);
  });
});

describe("headingPaths", () => {
  it("gives every heading the chain of its ancestors, skipping a heading without text", () => {
    const outline = outlineMarkdown("# A\n## B\n### C\n## \n### D\n# E\n");
    expect(headingPaths(outline.headings)).toEqual([
      ["A"],
      ["A", "B"],
      ["A", "B", "C"],
      ["A"],
      ["A", "D"],
      ["E"],
    ]);
  });
});
