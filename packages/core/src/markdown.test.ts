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

  it("only scans the top of the document", () => {
    expect(summarizeMarkdown(`${"text\n".repeat(500)}# Late heading\n`).title).toBeUndefined();
  });
});
