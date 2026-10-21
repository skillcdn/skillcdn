import { describe, expect, it } from "vitest";
import { embeddable, embeddingBatches, meaningSearchOf } from "./meaning-policy.js";

describe("embeddingBatches", () => {
  const take = { maxTexts: 3, maxBatchChars: 10, maxTextChars: 6 };

  it("packs texts into calls within the embedder's take, counting a text as it will be cut", () => {
    expect(embeddingBatches(["aaaa", "bbbb", "cc", "dddddddddd", "eeeee"], take)).toEqual([
      [0, 1, 2],
      [3],
      [4],
    ]);
  });

  it("makes one call of a lone text, however long, and none of nothing", () => {
    expect(embeddingBatches(["x".repeat(100)], take)).toEqual([[0]]);
    expect(embeddingBatches([], take)).toEqual([]);
  });
});

describe("meaningSearchOf", () => {
  const manifest = (path: string, meaning?: boolean) => ({
    path,
    kind: "manifest",
    frontMatter: meaning === undefined ? undefined : { search: { meaning } },
  });

  it("keeps the documents under a manifest that turns the search by meaning off to the words", () => {
    const allowed = meaningSearchOf([
      manifest("SKILLCDN.md"),
      manifest("docs/private/SKILLCDN.md", false),
      { path: "docs/guide.md", kind: "markdown" },
      { path: "docs/private/notes.md", kind: "markdown" },
    ]);
    expect(allowed("docs/guide.md")).toBe(true);
    expect(allowed("docs/private/notes.md")).toBe(false);
    expect(allowed("docs/private/deeper/more.md")).toBe(false);
    expect(allowed("SKILL.md")).toBe(true);
  });

  it("lets a nearer manifest decide for its own directory", () => {
    const allowed = meaningSearchOf([
      manifest("SKILLCDN.md", false),
      manifest("docs/open/SKILLCDN.md", true),
    ]);
    expect(allowed("docs/guide.md")).toBe(false);
    expect(allowed("docs/open/guide.md")).toBe(true);
  });

  it("embeds everything where no manifest says otherwise", () => {
    const allowed = meaningSearchOf([{ path: "README.md", kind: "markdown" }]);
    expect(allowed("README.md")).toBe(true);
    expect(allowed("a/b/c.md")).toBe(true);
  });
});

describe("embeddable", () => {
  it("names the searchable Markdown documents and skills", () => {
    expect(embeddable({ kind: "markdown", searchable: true })).toBe(true);
    expect(embeddable({ kind: "skill", searchable: true })).toBe(true);
    expect(embeddable({ kind: "markdown", searchable: false })).toBe(false);
    expect(embeddable({ kind: "json", searchable: true })).toBe(false);
    expect(embeddable({ kind: "manifest", searchable: false })).toBe(false);
  });
});
