import { describe, expect, it } from "vitest";
import {
  extractMarkdownReferences,
  inspectMarkdownReferences,
  MAX_LINK_MARKDOWN_LENGTH,
  MAX_MARKDOWN_REFERENCES,
  resolveMarkdownReference,
} from "./markdown-links.js";
import { parseRepoPath, type RepoPath } from "./repo-path.js";

function path(value: string): RepoPath {
  const result = parseRepoPath(value);
  if (!result.ok) throw new Error("invalid test path");
  return result.value;
}

describe("Markdown references", () => {
  const source = path("team/skills/write/SKILL.md");

  it("resolves local inline and reference links from the source file", () => {
    const markdown = [
      "[Local](references/style.md#tone) and [Shared](/shared/guide.md).",
      '[Space](<references/a%20b.md> "Title") and [Parent](../../guide.md).',
      "[Complex](references/a(b).md) and [Explicit][STYLE].",
      "[Short] and [Collapsed][].",
      "[`Code label`](code-label.md)",
      "[style]: /shared/style.md",
      "[short]: ../short.md",
      "[collapsed]: ./collapsed.md",
      "[unused]: /private.md",
    ].join("\n");
    expect(extractMarkdownReferences(source, markdown)).toEqual([
      { href: "references/style.md#tone", path: "team/skills/write/references/style.md" },
      { href: "/shared/guide.md", path: "shared/guide.md" },
      { href: "references/a%20b.md", path: "team/skills/write/references/a b.md" },
      { href: "../../guide.md", path: "team/guide.md" },
      { href: "references/a(b).md", path: "team/skills/write/references/a(b).md" },
      { href: "/shared/style.md", path: "shared/style.md" },
      { href: "../short.md", path: "team/skills/short.md" },
      { href: "./collapsed.md", path: "team/skills/write/collapsed.md" },
      { href: "code-label.md", path: "team/skills/write/code-label.md" },
    ]);
  });

  it("ignores code, front-matter, images, unused definitions and bare filenames", () => {
    expect(
      extractMarkdownReferences(
        source,
        [
          "---",
          "description: '[Wrong](/frontmatter.md)'",
          "---",
          "`[inline](/inline.md)` and ``[inline](/inline2.md)``.",
          "~~~markdown",
          "[fenced](/fenced.md)",
          "~~~",
          "```",
          "[fenced](/fenced2.md)",
          "```",
          "    [indented](/indented.md)",
          "![image](/image.md) ![image][img]",
          "[img]: /reference-image.md",
          "\\[escaped](/escaped.md)",
          "<!-- [Comment](/commented.md) -->",
          "../../bare.md",
          "[Good](/good.md)",
        ].join("\n"),
      ),
    ).toEqual([{ href: "/good.md", path: "good.md" }]);
  });

  it("never closes a code span within a longer backtick run", () => {
    const tick = String.fromCharCode(96);
    const secret = "[secret](/.private/hidden.md)";
    for (const [opening, interior] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [2, 1],
    ] as const) {
      const code = `${tick.repeat(opening)}code${tick.repeat(interior)} ${secret} ${tick.repeat(opening)}`;
      expect(extractMarkdownReferences(source, `Before ${code} [Good](/good.md)`), code).toEqual([
        { href: "/good.md", path: "good.md" },
      ]);
    }
  });

  it("handles escaped opening ticks and treats escapes inside code as literal content", () => {
    const tick = String.fromCharCode(96);
    const slash = String.fromCharCode(92);
    const link = "[secret](/.private/hidden.md)";
    expect(extractMarkdownReferences(source, `${slash}${tick}${link}${tick}`)).toEqual([
      { href: "/.private/hidden.md", path: ".private/hidden.md" },
    ]);
    expect(extractMarkdownReferences(source, `${slash}${tick}${tick}${link}${tick}`)).toEqual([]);
    expect(extractMarkdownReferences(source, `${tick}${link}${slash}${tick}`)).toEqual([]);
    expect(extractMarkdownReferences(source, `${tick}before\n${link}\n${tick}`)).toEqual([]);
  });

  it("bounds scanning of many unmatched backtick runs without hiding prose", () => {
    const tick = String.fromCharCode(96);
    const runs = Array.from({ length: 700 }, (_, index) => tick.repeat(index + 1)).join(" ");
    expect(extractMarkdownReferences(source, `Before ${runs} [Good](/good.md)`)).toEqual([
      { href: "/good.md", path: "good.md" },
    ]);
  });

  it.each([
    "../../../../escape.md",
    "/../escape.md",
    "%2f%2fhost/remote.md",
    "https://host/remote.md",
    "data:remote.md",
    "//host/remote.md",
    "#anchor",
    "guide.json",
    "guide.md%ZZ",
    "../bad\\file.md",
    "bad//file.md",
    `/bad${String.fromCodePoint(0)}.md`,
    `/bad${String.fromCodePoint(0x200b)}.md`,
    "/%2e%2e/escape.md",
    "https%3A%2F%2Fhost/remote.md",
    `${"a".repeat(1025)}.md`,
  ])("rejects unsafe or unsupported destination %j", (href) => {
    expect(resolveMarkdownReference(source, href)).toBeUndefined();
  });

  it("decodes once and permits explicitly referenced hidden files", () => {
    expect(resolveMarkdownReference(source, "/shared/%252e%252e/guide.md")).toBe(
      "shared/%2e%2e/guide.md",
    );
    expect(resolveMarkdownReference(source, "/.agents/shared.md")).toBe(".agents/shared.md");
    expect(resolveMarkdownReference(source, "../../../root.md?raw=1#top")).toBe("root.md");
  });

  it("bounds input, destinations and repeated links", () => {
    expect(extractMarkdownReferences(source, "a".repeat(MAX_LINK_MARKDOWN_LENGTH + 1))).toEqual([]);
    const markdown = Array.from(
      { length: MAX_MARKDOWN_REFERENCES + 20 },
      (_, index) => `[x](/${index}.md)`,
    ).join(" ");
    expect(extractMarkdownReferences(source, markdown)).toHaveLength(MAX_MARKDOWN_REFERENCES);
    expect(extractMarkdownReferences(source, "[a](/one.md) [b](/one.md)")).toHaveLength(1);
    expect(extractMarkdownReferences(source, "[".repeat(10000))).toEqual([]);
    expect(
      extractMarkdownReferences(source, `[x](${"(".repeat(2000)}x.md${")".repeat(2001)}`),
    ).toEqual([]);
  });

  it("reports omitted references without marking an exact limit as incomplete", () => {
    const links = Array.from(
      { length: MAX_MARKDOWN_REFERENCES },
      (_, index) => `[x](/${index}.md)`,
    ).join(" ");
    expect(inspectMarkdownReferences(source, links)).toMatchObject({ truncated: false });
    expect(
      inspectMarkdownReferences(
        source,
        `${links} [Duplicate](/0.md) [External](https://host/a.md)`,
      ),
    ).toMatchObject({ truncated: false });
    const exceeded = inspectMarkdownReferences(source, `${links} [Omitted](/extra.md)`);
    expect(exceeded.truncated).toBe(true);
    expect(exceeded.references).toHaveLength(MAX_MARKDOWN_REFERENCES);
    expect(exceeded.references).toEqual(extractMarkdownReferences(source, links));
  });

  it("stays fast on brackets that never close, and still finds the link at the end", () => {
    const hostile = `${"[".repeat(MAX_LINK_MARKDOWN_LENGTH - 20)}](/late.md)`;
    const started = Date.now();
    expect(inspectMarkdownReferences(source, hostile)).toEqual({
      references: [{ href: "/late.md", path: "late.md" }],
      truncated: false,
    });
    expect(Date.now() - started).toBeLessThan(250);
    // A label never spans a line, however close the next closing bracket is.
    expect(extractMarkdownReferences(source, "[a\n](/x.md) [b](/y.md)")).toEqual([
      { href: "/y.md", path: "y.md" },
    ]);
  });

  it("reports input that could not be inspected within the Markdown size bound", () => {
    expect(inspectMarkdownReferences(source, "a".repeat(MAX_LINK_MARKDOWN_LENGTH + 1))).toEqual({
      references: [],
      truncated: true,
    });
    expect(inspectMarkdownReferences(source, "No links.")).toEqual({
      references: [],
      truncated: false,
    });
  });
});
