import {
  type BlobStore,
  type GitHost,
  GitHostError,
  type IndexLimits,
  MAX_LINK_MARKDOWN_LENGTH,
  MAX_MARKDOWN_REFERENCES,
  parseRepoPath,
  type RepoPath,
  type TreeEntry,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { INDEX_LIMIT_DEFAULTS } from "../config/config.js";
import { buildSnapshotIndex } from "./build-index.js";
import { gitBlobHash } from "./git-hash.js";

function path(value: string): RepoPath {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error("invalid test path");
  return parsed.value;
}

const skill = (body = "", extra = ""): string =>
  `---\nname: example\ndescription: An example skill.\n${extra}---\n${body}`;
const manifest = (body = "", extra = "documents: []\n"): string =>
  `---\ndescription: Example collection.\n${extra}---\n${body}`;

async function index(
  files: Record<string, string>,
  options: { limits?: Partial<IndexLimits>; unreadable?: string[]; symlinks?: string[] } = {},
) {
  const bytes = new Map<string, Uint8Array>();
  const entries: TreeEntry[] = Object.entries(files).map(([name, body]) => {
    const data = new TextEncoder().encode(body);
    const hash = gitBlobHash(data);
    bytes.set(hash, data);
    return {
      path: path(name),
      hash,
      size: data.byteLength,
      type: options.symlinks?.includes(name) ? "symlink" : "file",
    };
  });
  const unreadable = new Set(
    entries.filter((entry) => options.unreadable?.includes(entry.path)).map((entry) => entry.hash),
  );
  const fetched: string[] = [];
  const gitHost: Pick<GitHost, "getTree" | "readBlob"> = {
    async getTree() {
      return { entries, truncated: false };
    },
    async readBlob(_coordinates, hash) {
      fetched.push(hash);
      const data = bytes.get(hash);
      if (data === undefined || unreadable.has(hash))
        throw new GitHostError("not_found", "unavailable test file");
      return data;
    },
  };
  const stored = new Map<string, string>();
  const blobStore: BlobStore = {
    async read(hash) {
      return stored.get(hash);
    },
    async write(hash, text) {
      stored.set(hash, text);
    },
    async missing(hashes) {
      return new Set(hashes.filter((hash) => !stored.has(hash)));
    },
  };
  const result = await buildSnapshotIndex({
    gitHost,
    blobStore,
    coordinates: { host: "gh", owner: "example", repo: "skills" },
    commit: "a".repeat(40),
    limits: { ...INDEX_LIMIT_DEFAULTS, ...options.limits },
    signal: new AbortController().signal,
  });
  return {
    ...result,
    byPath: new Map(result.entries.map((entry) => [entry.path, entry])),
    fetched,
    stored,
  };
}

describe("repository publication and link indexing", () => {
  it("keeps translated front-matter out of skill and Markdown search bodies", async () => {
    const result = await index({
      "skills/example/SKILL.md": skill(
        "Plan a storyboard.",
        "skillcdn:\n  translations:\n    ko:\n      title: Presentationonlyquartz\n",
      ),
      "skills/example/reference.md":
        "---\ntitle: Canonical reference\ntranslations:\n  ko:\n    title: Presentationonlyquartz\n---\nReference instructions.",
      "skills/example/broken/SKILL.md":
        "---\nname: broken\nskillcdn:\n  translations:\n    ko:\n      title: Presentationonlyquartz\n---\nRepair these instructions.",
      "skills/example/unterminated.md": "---\ntranslations: Presentationonlyquartz",
      "skills/example/values.json": '{"value":"Searchable JSON"}',
    });
    expect(result.byPath.get("skills/example/SKILL.md")).toMatchObject({
      searchBody: "Plan a storyboard.",
      frontMatter: { translations: { ko: { title: "Presentationonlyquartz" } } },
    });
    expect(result.byPath.get("skills/example/reference.md")).toMatchObject({
      title: "Canonical reference",
      searchBody: "Reference instructions.",
    });
    expect(result.byPath.get("skills/example/broken/SKILL.md")).toMatchObject({
      kind: "markdown",
      searchBody: "Repair these instructions.",
    });
    expect(result.byPath.get("skills/example/unterminated.md")?.searchBody).toBe("");
    expect(result.byPath.get("skills/example/values.json")?.searchBody).toBeUndefined();
  });

  it("discovers flat, nested, root and hidden skill declarations through one rule", async () => {
    const result = await index({
      "SKILL.md": skill(),
      "team/skills/write/SKILL.md": skill(),
      ".agents/.curated/review/SKILL.md": skill(
        "[Explicit](.context/note.md)",
        "skillcdn:\n  include: [.data/template.json]\n",
      ),
      ".agents/.curated/review/references/style.md": "# Style\n",
      ".agents/.curated/review/.context/note.md": "# Explicit context\n",
      ".agents/.curated/review/.context/other.md": "# Unpublished\n",
      ".agents/.curated/review/.data/template.json": "{}",
      ".agents/config.json": "{}",
      "root.txt": "root support",
    });
    expect(
      result.entries.filter((entry) => entry.kind === "skill").map((entry) => entry.path),
    ).toEqual([".agents/.curated/review/SKILL.md", "SKILL.md", "team/skills/write/SKILL.md"]);
    expect(result.byPath.get(".agents/.curated/review/references/style.md")?.visible).toBe(true);
    expect(result.byPath.get(".agents/.curated/review/.context/note.md")?.visible).toBe(true);
    expect(result.byPath.get(".agents/.curated/review/.context/other.md")?.visible).toBe(false);
    expect(result.byPath.get(".agents/.curated/review/.data/template.json")?.visible).toBe(true);
    expect(result.byPath.get(".agents/config.json")?.visible).toBe(false);
    expect(result.byPath.get("root.txt")?.visible).toBe(true);
  });

  it("follows shared, recursive and cyclic links without adding catalog/search documents", async () => {
    const result = await index({
      "SKILLCDN.md": manifest("[Policy](/shared/policy.md)"),
      "team/skills/write/SKILL.md": skill(
        "[Shared](../../../shared/start.md) [Missing](/missing.md)",
      ),
      "shared/start.md": "# Shared\n[Next](next.md) [Policy](policy.md)",
      "shared/next.md": "# Next\n[Cycle](start.md) [Hidden](/.context/guide.md)",
      "shared/policy.md": "# Policy\n[Next](next.md)",
      ".context/guide.md": "# Hidden\n",
      ".context/unlinked.md": "# Private\n",
      "README.md": "# Repository overview\n",
    });
    expect(result.diagnostics).toEqual([]);
    for (const name of [
      "shared/start.md",
      "shared/next.md",
      "shared/policy.md",
      ".context/guide.md",
    ]) {
      expect(result.byPath.get(name)).toMatchObject({
        visible: true,
        searchable: false,
        frontMatter: { linkedOnly: true },
      });
    }
    expect(result.byPath.get("team/skills/write/SKILL.md")?.frontMatter?.references).toEqual([
      { href: "../../../shared/start.md", path: "shared/start.md" },
      { href: "/missing.md", path: "missing.md" },
    ]);
    expect(result.byPath.get("shared/start.md")?.frontMatter?.references).toEqual([
      { href: "next.md", path: "shared/next.md" },
      { href: "policy.md", path: "shared/policy.md" },
    ]);
    expect(result.byPath.get(".context/unlinked.md")?.visible).toBe(false);
    expect(result.byPath.get("README.md")).toMatchObject({
      visible: true,
      searchable: false,
      frontMatter: { overviewOnly: true },
    });
    expect(result.fetched).toHaveLength(7);
  });

  it("starts expansion at served documents and preserves skill and manifest identities", async () => {
    const result = await index({
      "SKILLCDN.md": manifest("", "documents: [docs, .manual]\n"),
      "docs/guide.md": "# Guide\n[External reference](/shared/one.md) [Skill](/flat/SKILL.md)",
      ".manual/guide.md": "# Declared hidden document\n[Rules](/team/SKILLCDN.md)",
      "shared/one.md": "# One\n",
      "flat/SKILL.md": skill(),
      "team/SKILLCDN.md": manifest(),
      ".manual/.draft.md": "# Draft\n",
    });
    expect(result.byPath.get("docs/guide.md")?.searchable).toBe(true);
    expect(result.byPath.get(".manual/guide.md")?.searchable).toBe(true);
    expect(result.byPath.get(".manual/.draft.md")?.visible).toBe(false);
    expect(result.byPath.get("shared/one.md")?.searchable).toBe(false);
    expect(result.byPath.get("flat/SKILL.md")?.kind).toBe("skill");
    expect(result.byPath.get("team/SKILLCDN.md")?.kind).toBe("manifest");
  });

  it.each(["malformed", "unavailable", "oversized", "admission"])(
    "retains %s manifest boundaries and blocks link expansion through them",
    async (failure) => {
      const failing =
        failure === "malformed"
          ? "broken YAML"
          : failure === "oversized"
            ? manifest("x".repeat(500))
            : manifest();
      const result = await index(
        {
          "SKILLCDN.md": manifest("[Link](/private/docs/guide.md)", "documents: [.]\n"),
          "private/SKILLCDN.md": failing,
          "private/docs/guide.md": "# Must stay closed\n",
          "private/secret.md": "# Secret\n",
        },
        {
          ...(failure === "unavailable" ? { unreadable: ["private/SKILLCDN.md"] } : {}),
          ...(failure === "oversized" ? { limits: { maxIndexedFileBytes: 200 } } : {}),
          ...(failure === "admission" ? { limits: { maxIndexedFiles: 1 } } : {}),
        },
      );
      expect(result.byPath.get("private/SKILLCDN.md")).toMatchObject({
        kind: "manifest",
        visible: true,
        frontMatter: { manifestError: expect.any(String) },
      });
      expect(result.byPath.get("private/docs/guide.md")?.visible).toBe(false);
      expect(result.byPath.get("private/secret.md")?.visible).toBe(false);
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.path === "private/SKILLCDN.md"),
      ).toBe(true);
    },
  );

  it("blocks skills, nested policies and references under a broken hidden ancestor", async () => {
    const result = await index({
      ".agents/SKILLCDN.md": "invalid",
      ".agents/skills/read/SKILL.md": skill("[Private](/private.md)"),
      ".agents/skills/read/references/local.md": "# Local support\n",
      ".agents/skills/SKILLCDN.md": manifest("", "documents: [.]\n"),
      ".agents/skills/README.md": "# Must stay closed\n",
      ".agents/docs/guide.md": "# Closed\n",
      "private.md": "# Closed link\n",
    });
    expect(result.byPath.get(".agents/SKILLCDN.md")?.frontMatter?.manifestError).toBe(
      "missing_front_matter",
    );
    expect(result.byPath.get(".agents/skills/read/SKILL.md")?.visible).toBe(false);
    expect(result.byPath.get(".agents/skills/read/references/local.md")?.visible).toBe(false);
    expect(result.byPath.get(".agents/skills/SKILLCDN.md")?.visible).toBe(false);
    expect(result.byPath.get(".agents/skills/README.md")?.visible).toBe(false);
    expect(result.byPath.get(".agents/docs/guide.md")?.visible).toBe(false);
    expect(result.byPath.get("private.md")?.visible).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.fetched).toHaveLength(1);
  });

  it("excludes exact files and subtrees before skills, documents, includes and links", async () => {
    const result = await index({
      "SKILLCDN.md": manifest(
        "[Hidden](/.private/README.md)",
        "documents: [.]\nexclude: [fixtures, skills/write/private.md, .private]\n",
      ),
      "fixtures/SKILLCDN.md": "invalid child policy",
      "fixtures/SKILL.md": "invalid child skill",
      "fixtures/README.md": "# Private fixtures\n",
      "fixtures/nested/SKILL.md": skill(),
      "fixtures-extra/SKILL.md": skill(),
      ".private/README.md": "# Private\n",
      "skills/write/SKILL.md": skill(
        "[Private](private.md)",
        "skillcdn:\n  include: [private.md]\n",
      ),
      "skills/write/private.md": "# Excluded support\n",
      "skills/write/public.md": "# Public support\n",
    });
    expect(result.diagnostics).toEqual([]);
    for (const name of [
      "fixtures/SKILLCDN.md",
      "fixtures/SKILL.md",
      "fixtures/README.md",
      "fixtures/nested/SKILL.md",
      ".private/README.md",
      "skills/write/private.md",
    ]) {
      expect(result.byPath.get(name)).toMatchObject({ visible: false, searchable: false });
    }
    expect(result.byPath.get("fixtures-extra/SKILL.md")?.visible).toBe(true);
    expect(result.byPath.get("skills/write/public.md")?.visible).toBe(true);
    expect(result.fetched).toHaveLength(4);
  });

  it("excludes a hidden fixture container locally without changing independently mounted children", async () => {
    const fixture = { "SKILL.md": skill(), "references/guide.md": "# Fixture reference\n" };
    const prefix = "apps/server/fixtures/.repositories";
    const combined = await index({
      [`${prefix}/SKILLCDN.md`]: manifest("", "exclude: [.]\n"),
      [`${prefix}/broken/SKILL.md`]: "intentional failure",
      ...Object.fromEntries(
        Object.entries(fixture).map(([name, body]) => [`${prefix}/single/${name}`, body]),
      ),
      "real/SKILL.md": skill(),
    });
    expect(combined.diagnostics).toEqual([]);
    expect(combined.entries.filter((entry) => entry.visible).map((entry) => entry.path)).toEqual([
      "real/SKILL.md",
    ]);
    const independent = await index(fixture);
    expect(independent.entries.every((entry) => entry.visible)).toBe(true);
    expect(independent.entries.some((entry) => entry.kind === "skill")).toBe(true);
  });

  it("fails closed for invalid exclusions even beside a valid nested policy", async () => {
    const result = await index({
      "SKILLCDN.md": manifest("", "exclude: ['../private']\n"),
      "nested/SKILLCDN.md": manifest("", "documents: [.]\nexclude: []\n"),
      "nested/SKILL.md": skill(),
      "README.md": "# Closed\n",
    });
    expect(result.entries.filter((entry) => entry.visible).map((entry) => entry.path)).toEqual([
      "SKILLCDN.md",
    ]);
    expect(result.diagnostics).toEqual([
      { path: "SKILLCDN.md", code: "invalid_exclude", message: expect.any(String) },
    ]);
    expect(result.fetched).toHaveLength(1);
  });

  it("offers root and existing folder introductions without publishing unrelated folders or search aliases", async () => {
    const result = await index({
      "README.md": "# Repository title\n\nChoose a cloud skill.\n\n[Guide](shared/guide.md)",
      "readme.md": "# Alternate spelling\n",
      "README.ko.md": "# Translation\n",
      "skills/README.markdown": "# Available skills\n\nSelect a topic.",
      "skills/cloud/README.mdx": "# Cloud\n\nCloud task selection.",
      "skills/cloud/query/SKILL.md": skill(),
      "skills/cloud/query/README.md": "# Query reference\n",
      "unrelated/README.md": "# Unrelated introduction\n",
      ".hidden/README.md": "# Hidden introduction\n",
      "shared/guide.md": "# Explicit reference\n[More](more.md)",
      "shared/more.md": "# More\n",
      "shared/README.md": "# References do not create an overview scope\n",
    });
    for (const name of ["README.md", "skills/README.markdown", "skills/cloud/README.mdx"]) {
      expect(result.byPath.get(name)).toMatchObject({
        visible: true,
        searchable: false,
        frontMatter: { overviewOnly: true },
      });
    }
    expect(result.byPath.get("README.md")).toMatchObject({
      title: "Repository title",
      description: "Choose a cloud skill.",
    });
    for (const name of [
      "readme.md",
      "README.ko.md",
      "unrelated/README.md",
      ".hidden/README.md",
      "shared/README.md",
    ]) {
      expect(result.byPath.get(name)?.visible).toBe(false);
    }
    expect(result.byPath.get("skills/cloud/query/README.md")).toMatchObject({
      visible: true,
      searchable: true,
    });
    expect(
      result.byPath.get("skills/cloud/query/README.md")?.frontMatter?.overviewOnly,
    ).toBeUndefined();
    expect(result.byPath.get("shared/guide.md")).toMatchObject({
      visible: true,
      searchable: false,
      frontMatter: { linkedOnly: true },
    });
    expect(result.byPath.get("shared/more.md")?.visible).toBe(true);
  });

  it("keeps README readable beside a manifest without turning it into inherited rules", async () => {
    const result = await index({
      "SKILLCDN.md": manifest(),
      "README.md": "# Optional introduction\n",
      "team/SKILLCDN.md": manifest("", "documents: []\nexclude: [README.md]\n"),
      "team/README.md": "# Excluded introduction\n",
      "team/SKILL.md": skill(),
    });
    expect(result.byPath.get("README.md")).toMatchObject({
      kind: "markdown",
      visible: true,
      searchable: false,
    });
    expect(result.byPath.get("team/README.md")?.visible).toBe(false);
    expect(result.byPath.get("team/SKILL.md")?.visible).toBe(true);
  });

  it("prioritizes manifest presence under tree limits and never follows symlinks", async () => {
    const result = await index(
      {
        "docs/guide.md": "# Guide\n",
        "SKILLCDN.md": "invalid",
        "skills/read/SKILL.md": skill("[Link](/linked.md)"),
        "linked.md": "# Symlink\n",
      },
      { limits: { maxTreeEntries: 3 }, symlinks: ["linked.md"] },
    );
    expect(result.byPath.get("SKILLCDN.md")?.kind).toBe("manifest");
    expect(result.byPath.get("docs/guide.md")?.visible).toBe(false);
    expect(result.byPath.has("linked.md")).toBe(false);
  });

  it("retains a symlink policy as a closed boundary without fetching its target or descendants", async () => {
    const result = await index(
      {
        "SKILLCDN.md": manifest("[Closed](/private/README.md)", "documents: [.]\n"),
        "private/SKILLCDN.md": "../policy.md",
        "private/SKILL.md": skill(),
        "private/nested/SKILLCDN.md": manifest("", "documents: [.]\n"),
        "private/nested/SKILL.md": skill(),
        "private/README.md": "# Private introduction\n",
        "policy.md": manifest(),
      },
      { symlinks: ["private/SKILLCDN.md"] },
    );
    expect(result.byPath.get("private/SKILLCDN.md")).toMatchObject({
      kind: "manifest",
      frontMatter: { manifestError: "unsupported_type" },
    });
    for (const name of [
      "private/SKILL.md",
      "private/nested/SKILLCDN.md",
      "private/nested/SKILL.md",
      "private/README.md",
    ]) {
      expect(result.byPath.get(name)?.visible).toBe(false);
    }
    expect(result.diagnostics).toEqual([
      {
        path: "private/SKILLCDN.md",
        code: "unsupported_type",
        message: expect.any(String),
      },
    ]);
    expect(result.fetched).toHaveLength(2);
  });

  it("bounds link depth and total admitted files", async () => {
    const chain = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`shared/${i}.md`, `[Next](${i + 1}.md)`]),
    );
    const files = { "skills/read/SKILL.md": skill("[Start](/shared/0.md)"), ...chain };
    const depth = await index(files);
    expect(depth.truncated).toBe(true);
    expect(depth.byPath.get("shared/7.md")?.visible).toBe(true);
    expect(depth.byPath.get("shared/8.md")?.visible).toBe(false);
    const count = await index(files, { limits: { maxIndexedFiles: 3 } });
    expect(count.truncated).toBe(true);
    expect(count.byPath.get("shared/1.md")?.visible).toBe(true);
    expect(count.byPath.get("shared/2.md")?.visible).toBe(false);
  });

  it.each(["SKILLCDN.md", "skills/read/SKILL.md", "docs/guide.md"])(
    "reports incomplete reference extraction from %s",
    async (source) => {
      const links = Array.from(
        { length: MAX_MARKDOWN_REFERENCES + 1 },
        (_, i) => `[Reference](/shared/${i}.md)`,
      ).join("\n");
      const body =
        source === "SKILLCDN.md"
          ? manifest(links)
          : source.endsWith("SKILL.md")
            ? skill(links)
            : links;
      const result = await index({ [source]: body });
      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toContainEqual({
        path: source,
        code: "reference_limit",
        message: expect.any(String),
      });
      expect(result.byPath.get(source)?.frontMatter?.references).toHaveLength(
        MAX_MARKDOWN_REFERENCES,
      );
    },
  );

  it("reports oversized reference input even when indexing permits the document", async () => {
    const result = await index(
      { "docs/large.md": "a".repeat(MAX_LINK_MARKDOWN_LENGTH + 1) },
      { limits: { maxIndexedFileBytes: MAX_LINK_MARKDOWN_LENGTH + 100 } },
    );
    expect(result.truncated).toBe(true);
    expect(result.diagnostics).toContainEqual({
      path: "docs/large.md",
      code: "reference_limit",
      message: expect.any(String),
    });
    expect(result.byPath.get("docs/large.md")?.visible).toBe(true);
  });
});
