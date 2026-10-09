import { describe, expect, it } from "vitest";
import { summarizeMarkdown } from "./markdown.js";

describe("summarizeMarkdown", () => {
  it("uses the first level-one heading as the title", () => {
    expect(summarizeMarkdown("Intro line\n\n# Getting started #\n\n## Install\n")).toEqual({
      title: "Getting started",
      description: undefined,
      body: "Intro line\n\n# Getting started #\n\n## Install\n",
    });
  });

  it("prefers the front-matter title and description", () => {
    const text = [
      "---",
      "title: The Guide",
      "description: >",
      "  How to get",
      "  started.",
      "---",
      "# Another heading",
      "",
    ].join("\n");
    expect(summarizeMarkdown(text)).toEqual({
      title: "The Guide",
      description: "How to get started.",
      body: "# Another heading\n",
    });
  });

  it("falls back to the heading when the front-matter is unusable", () => {
    expect(summarizeMarkdown('---\ntitle: "unclosed\n---\n# Real title\n').title).toBe(
      "Real title",
    );
    expect(summarizeMarkdown("---\ntitle: [a, b]\n---\n# Real title\n").title).toBe("Real title");
  });

  it("ignores headings inside fenced code blocks", () => {
    const text = [
      "```sh",
      "# not a heading",
      "```",
      "~~~~",
      "# still not",
      "~~~",
      "~~~~",
      "# Title",
    ].join("\n");
    expect(summarizeMarkdown(text).title).toBe("Title");
  });

  it("returns no title when there is none to find", () => {
    expect(summarizeMarkdown("").title).toBeUndefined();
    expect(summarizeMarkdown("## Only a subsection\n#hashtag\n").title).toBeUndefined();
    expect(summarizeMarkdown("#\n").title).toBeUndefined();
  });

  it("treats unterminated front-matter as plain text", () => {
    const text = "---\ntitle: x\n# Heading\n";
    expect(summarizeMarkdown(text)).toEqual({
      title: "Heading",
      description: undefined,
      body: text,
    });
  });

  it("describes a document by the paragraph after its title", () => {
    const text = [
      "Something above the title.",
      "",
      "# Releasing",
      "",
      "How we cut a release,",
      "every week.",
      "",
      "Second paragraph.",
    ].join("\n");
    expect(summarizeMarkdown(text).description).toBe("How we cut a release, every week.");
  });

  it("describes a document without a title by its first paragraph", () => {
    expect(summarizeMarkdown("Just text here.\n\n## A subsection\n").description).toBe(
      "Just text here.",
    );
    expect(summarizeMarkdown("## Only subsections\n\nUnder one.\n").description).toBe("Under one.");
  });

  it("skips markup on the way to the first paragraph and reads links as their text", () => {
    const text = [
      "# Title",
      "",
      "[![CI](https://ci.example/badge.svg)](https://ci.example)",
      "![logo](logo.png)",
      "",
      "> A quote is not the introduction.",
      "",
      "- a list is not either",
      "1. nor a numbered one",
      "",
      "| a table | no |",
      "",
      "<!-- html is skipped -->",
      "",
      "---",
      "",
      "```",
      "# code is skipped",
      "```",
      "",
      "See **the [guide](docs/guide.md)** for `details`, _really_.",
      "",
      "Not this one.",
    ].join("\n");
    expect(summarizeMarkdown(text).description).toBe("See the guide for details, really.");
  });

  it("skips an HTML block to the blank line that ends it, however its lines are indented", () => {
    const text = [
      '<div align="center">',
      '  <a href="https://example.com/">',
      "    <picture>",
      '      <source media="(prefers-color-scheme: dark)" srcset="dark.svg">',
      '      <img alt="Example" src="light.svg" width="360">',
      "    </picture>",
      "  </a>",
      "  <p><strong>One line of promise.</strong></p>",
      "</div>",
      "",
      "> **Status: early.** Not a promise.",
      "",
      "Point an agent at an address and it gets the skills.",
      "",
    ].join("\n");
    expect(summarizeMarkdown(text)).toEqual({
      title: undefined,
      description: "Point an agent at an address and it gets the skills.",
      body: text,
    });
  });

  it("skips a comment and a raw-text element to their closing marker, blank lines included", () => {
    const comment = [
      "<!--",
      "a note",
      "",
      "# not a title",
      "-->",
      "",
      "# Title",
      "",
      "The intro.",
      "",
    ].join("\n");
    expect(summarizeMarkdown(comment)).toMatchObject({ title: "Title", description: "The intro." });
    const pre = ["<pre>", "", "# not a title", "</pre>", "", "The intro.", ""].join("\n");
    expect(summarizeMarkdown(pre).description).toBe("The intro.");
    const script = ["<script>", "", "let x = 1;", "</script>", "", "The intro.", ""].join("\n");
    expect(summarizeMarkdown(script).description).toBe("The intro.");
    const closed = ["<!-- one line -->", "<pre>x</pre>", "The intro.", ""].join("\n");
    expect(summarizeMarkdown(closed).description).toBe("The intro.");
  });

  it("does not take a tag's name for a raw-text element's", () => {
    // `<preview>` is not `<pre>`: the block ends at the blank line, not at a closing tag that never comes.
    const text = ["<preview>", "  <b>x</b>", "</preview>", "", "The intro.", ""].join("\n");
    expect(summarizeMarkdown(text).description).toBe("The intro.");
  });

  it("keeps the front-matter description over the body", () => {
    const text = "---\ndescription: From the front-matter.\n---\n# T\n\nFrom the body.\n";
    expect(summarizeMarkdown(text).description).toBe("From the front-matter.");
  });

  it("shortens a long first paragraph", () => {
    const summary = summarizeMarkdown(`# T\n\n${"word ".repeat(100)}\n`).description;
    expect(summary).toHaveLength(200);
    expect(summary?.endsWith(String.fromCodePoint(0x2026))).toBe(true);
    expect(summary).not.toContain("  ");
  });

  it("has no description for a document that is only headings and code", () => {
    expect(summarizeMarkdown("# T\n\n## U\n\n```\ncode\n```\n").description).toBeUndefined();
  });
});

describe("summarizeMarkdown with hostile input", () => {
  it("refuses titles that carry invisible or control characters", () => {
    expect(summarizeMarkdown(`# Safe${String.fromCodePoint(0x202e)}title\n`).title).toBeUndefined();
    expect(summarizeMarkdown(`# Bell${String.fromCodePoint(7)}\n`).title).toBeUndefined();
  });

  it("caps the title length", () => {
    expect(summarizeMarkdown(`# ${"t".repeat(900)}\n`).title).toHaveLength(200);
  });

  it("stays fast on lines built to make patterns backtrack", () => {
    const hostile = `# ${" ".repeat(200_000)}x\n${"#".repeat(200_000)}\n`;
    const started = Date.now();
    expect(summarizeMarkdown(hostile).title).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("leaves no description for an HTML block that never ends, within the lines it scans", () => {
    const text = `<div>\n${"a line of it\n".repeat(300)}\nThe intro.\n`;
    expect(summarizeMarkdown(text).description).toBeUndefined();
  });

  it("only scans the top of the document", () => {
    expect(summarizeMarkdown(`${"text\n".repeat(500)}# Late heading\n`).title).toBeUndefined();
  });

  it("refuses a first paragraph that carries invisible or control characters", () => {
    const rlo = String.fromCodePoint(0x202e);
    expect(summarizeMarkdown(`# T\n\nSafe ${rlo}text\n`).description).toBeUndefined();
  });

  it("stays fast on paragraphs built to make patterns backtrack", () => {
    const hostile = `# T\n\n${"[".repeat(100_000)}${"a".repeat(100_000)}\n${"- ".repeat(100_000)}\n`;
    const started = Date.now();
    summarizeMarkdown(hostile);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("stays fast on a paragraph of many lines that never close a bracket", () => {
    // Each line stays under the heading bound; together they made one long paragraph.
    const hostile = `# T\n\n${`${"[".repeat(999)}\n`.repeat(200)}`;
    const started = Date.now();
    expect(summarizeMarkdown(hostile).description).toMatch(/^\[+…$/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("reads the glimpse from the start of a long paragraph", () => {
    const summary = summarizeMarkdown(`# T\n\n[Guide](guide.md) first. ${"more ".repeat(2000)}\n`);
    expect(summary.description?.startsWith("Guide first. more more")).toBe(true);
    expect(summary.description).toHaveLength(200);
  });
});
