import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDocs, NAV_FILE, REPOSITORY_ROOT } from "./docs.js";

// A small repository to read the documentation from, written per test.
let root: string | undefined;

function repository(files: Readonly<Record<string, string>>): string {
  root = mkdtempSync(join(tmpdir(), "skillcdn-docs-"));
  for (const [file, content] of Object.entries(files)) {
    const target = join(root, ...file.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const nav = (sections: unknown) => JSON.stringify({ sections });

const GUIDE = [
  "# Use skills",
  "",
  "A skill is a set of **instructions**. See [the format](../specs/format.md#rules) and",
  "[the decision](../adr/0001-first.md), or [the whole tree](../adr/).",
  "",
  "## Connect",
  "",
  "Read [the rules](#rules-of-the-road) first, then [the tools](../specs/format.md).",
  "",
  "```md",
  "[not a link](nowhere.md)",
  "```",
  "",
  "A `[span](nowhere.md)` in code is text. External: [site](https://example.com/a) and <https://x.y>.",
  "",
  "## Rules of the road",
  "",
  "![a picture](../../pictures/one.png) and [a definition][d].",
  "",
  "[d]: ../adr/0001-first.md#context",
  "",
].join("\n");

const FORMAT = [
  "# Spec: the format",
  "",
  "- Status: draft.",
  "",
  "How a repository is read. Every rule is here.",
  "",
  "## Rules",
  "",
  "### Rules",
  "",
  "Back to [the guide](../guide/use.md#connect).",
  "",
].join("\n");

const FILES = {
  [NAV_FILE]: nav([
    { id: "guides", pages: [{ file: "docs/guide/use.md" }] },
    {
      id: "reference",
      pages: [{ file: "docs/specs/format.md", slug: "format", title: "The format" }],
    },
  ]),
  "docs/guide/use.md": GUIDE,
  "docs/specs/format.md": FORMAT,
  "docs/adr/0001-first.md": "# First\n\n## Context\n",
  "pictures/one.png": "not really a picture",
};

describe("loadDocs", () => {
  it("reads the pages the navigation names, with their titles, descriptions and outlines", () => {
    const docs = loadDocs(repository(FILES));
    expect(docs.catalog.sections.map((section) => section.id)).toEqual(["guides", "reference"]);
    const [guide, format] = docs.catalog.sections.flatMap((section) => section.pages);
    expect(guide).toMatchObject({
      slug: "use",
      file: "docs/guide/use.md",
      title: "Use skills",
      description:
        "A skill is a set of instructions. See the format and the decision, or the whole tree.",
      section: "guides",
    });
    expect(guide?.headings).toEqual([
      { level: 2, text: "Connect", id: "connect" },
      { level: 2, text: "Rules of the road", id: "rules-of-the-road" },
    ]);
    // The title the navigation gives wins over the heading; the description skips the list.
    expect(format).toMatchObject({
      slug: "format",
      title: "The format",
      description: "How a repository is read. Every rule is here.",
    });
    // A repeated heading is counted, as the host counts it.
    expect(format?.headings.map((heading) => heading.id)).toEqual(["rules", "rules-1"]);
    expect(docs.files).toHaveLength(3);
  });

  it("resolves every link: pages to the site, the rest to the source, and keeps the Markdown whole for agents", () => {
    const docs = loadDocs(repository(FILES));
    const guide = docs.content.use;
    if (guide === undefined) throw new Error("the guide was not read");
    // The page sets its title; the body starts with the first paragraph.
    expect(guide.body.startsWith("A skill is a set")).toBe(true);
    expect(guide.source.startsWith("# Use skills\n\nA skill")).toBe(true);
    // A link to a published page becomes its path on the site, fragment kept.
    expect(guide.body).toContain("[the format](/docs/format#rules)");
    expect(guide.body).toContain("[the tools](/docs/format)");
    // For agents, the Markdown of that page, at the origin that is filled in when served.
    expect(guide.source).toContain(
      "[the format](https://origin.skillcdn.invalid/docs/format.md#rules)",
    );
    // A file that is not a page is read at the host; a directory as a tree.
    expect(guide.body).toContain(
      "[the decision](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0001-first.md)",
    );
    expect(guide.body).toContain(
      "[the whole tree](https://github.com/skillcdn/skillcdn/tree/main/docs/adr)",
    );
    expect(guide.source).toContain(
      "[d]: https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0001-first.md#context",
    );
    // A picture of the repository is loaded from the host's raw copy.
    expect(guide.body).toContain(
      "![a picture](https://raw.githubusercontent.com/skillcdn/skillcdn/main/pictures/one.png)",
    );
    // Fragments of the page, external links and anything inside code stay as written.
    expect(guide.body).toContain("[the rules](#rules-of-the-road)");
    expect(guide.body).toContain("[site](https://example.com/a) and <https://x.y>");
    expect(guide.body).toContain("[not a link](nowhere.md)");
    expect(guide.body).toContain("`[span](nowhere.md)`");
    // The other way round, with a fragment checked against the target's headings.
    expect(docs.content.format?.body).toContain("[the guide](/docs/use#connect)");
  });

  it("names the slug after the file, or after the directory of a README", () => {
    const docs = loadDocs(
      repository({
        [NAV_FILE]: nav([
          {
            id: "operate",
            pages: [{ file: "deploy/README.md" }, { file: "docs/Self-Hosting.md" }],
          },
        ]),
        "deploy/README.md": "# deploy/\n\nHow to run it.\n",
        "docs/Self-Hosting.md": "# Self-hosting\n\nAlso how to run it.\n",
      }),
    );
    expect(docs.catalog.sections[0]?.pages.map((page) => page.slug)).toEqual([
      "deploy",
      "self-hosting",
    ]);
  });

  it("refuses a link that leads nowhere, naming the file and the line", () => {
    expect(() =>
      loadDocs(
        repository({
          ...FILES,
          "docs/guide/use.md": [
            "# Use",
            "",
            "Intro.",
            "",
            "See [gone](missing.md), [outside](../../../etc/passwd), [no heading](#nope),",
            "[no such heading](../specs/format.md#nope) and [empty]().",
            "",
          ].join("\n"),
        }),
        { complete: true },
      ),
    ).toThrow(
      /use\.md:5: "missing\.md" leads to nothing[\s\S]*use\.md:5: "\.\.\/\.\.\/\.\.\/etc\/passwd" leaves the repository[\s\S]*use\.md:5: "#nope" names no heading of the page[\s\S]*use\.md:6: "\.\.\/specs\/format\.md#nope" names no heading of docs\/specs\/format\.md[\s\S]*use\.md:6: a link with no destination/,
    );
  });

  it("resolves what a partial copy does not have to the host, and checks the rest", () => {
    // The image is built from a copy that carries only the published files: a link to a file
    // it does not have is read as written, a trailing slash naming a directory.
    const partial = repository({
      ...FILES,
      "docs/guide/use.md": [
        "# Use",
        "",
        "Intro.",
        "",
        "## Connect",
        "",
        "See [the decision](../adr/0002-second.md#context), [every decision](../adr/),",
        "[the workflow](../../.github/workflows/ci.yml) and [a page](../specs/format.md#rules).",
        "",
      ].join("\n"),
    });
    const body = loadDocs(partial).content.use?.body ?? "";
    expect(body).toContain(
      "[the decision](https://github.com/skillcdn/skillcdn/blob/main/docs/adr/0002-second.md#context)",
    );
    expect(body).toContain(
      "[every decision](https://github.com/skillcdn/skillcdn/tree/main/docs/adr)",
    );
    expect(body).toContain(
      "[the workflow](https://github.com/skillcdn/skillcdn/blob/main/.github/workflows/ci.yml)",
    );
    expect(body).toContain("[a page](/docs/format#rules)");
    // What is there is still read, and a page's headings are still checked.
    expect(() => loadDocs(partial, { complete: true })).toThrow(
      /0002-second\.md#context" leads to nothing/,
    );
    expect(() =>
      loadDocs(
        repository({
          ...FILES,
          "docs/guide/use.md": "# Use\n\nSee [x](../specs/format.md#nope).\n",
        }),
      ),
    ).toThrow(/names no heading of docs\/specs\/format\.md/);
  });

  it("refuses a navigation that is wrong, saying what", () => {
    const cases: readonly [unknown, RegExp][] = [
      [{ nope: [] }, /must be an object with a "sections" array/],
      [{ sections: [{ id: "Bad Id", pages: [] }] }, /needs an "id" of lowercase letters/],
      [{ sections: [{ id: "a", pages: [] }] }, /at least one page/],
      [{ sections: [{ id: "a", pages: [{ file: "../x.md" }] }] }, /not a Markdown file path/],
      [{ sections: [{ id: "a", pages: [{ file: "docs/x.md" }] }] }, /not a file of the repository/],
      [
        { sections: [{ id: "a", pages: [{ file: "docs/guide/use.md", slug: "Bad" }] }] },
        /slug "Bad" must be lowercase/,
      ],
      [
        {
          sections: [
            { id: "a", pages: [{ file: "docs/guide/use.md" }] },
            { id: "a", pages: [{ file: "docs/specs/format.md" }] },
          ],
        },
        /the id "a" is used twice/,
      ],
      [
        {
          sections: [
            { id: "a", pages: [{ file: "docs/guide/use.md", slug: "one" }] },
            { id: "b", pages: [{ file: "docs/specs/format.md", slug: "one" }] },
          ],
        },
        /the slug "one" is also the slug of docs\/guide\/use\.md/,
      ],
    ];
    for (const [sections, message] of cases) {
      expect(() =>
        loadDocs(repository({ ...FILES, [NAV_FILE]: JSON.stringify(sections) })),
      ).toThrow(message);
      rmSync(root ?? "", { recursive: true, force: true });
      root = undefined;
    }
  });

  it("refuses a page without a title, with front matter, or with nothing to describe it", () => {
    expect(() =>
      loadDocs(
        repository({
          [NAV_FILE]: nav([{ id: "a", pages: [{ file: "docs/one.md" }] }]),
          "docs/one.md": "Just a paragraph.\n",
        }),
      ),
    ).toThrow(/no level-one heading/);
    rmSync(root ?? "", { recursive: true, force: true });
    expect(() =>
      loadDocs(
        repository({
          [NAV_FILE]: nav([{ id: "a", pages: [{ file: "docs/one.md" }] }]),
          "docs/one.md": "---\ntitle: One\n---\n# One\n\nText.\n",
        }),
      ),
    ).toThrow(/starts with front matter/);
    rmSync(root ?? "", { recursive: true, force: true });
    expect(() =>
      loadDocs(
        repository({
          [NAV_FILE]: nav([{ id: "a", pages: [{ file: "docs/one.md" }] }]),
          "docs/one.md": "# One\n\n- only a list\n",
        }),
      ),
    ).toThrow(/no paragraph to describe it by/);
  });

  it("reads the documentation of this repository, every link of it resolving", () => {
    const docs = loadDocs(REPOSITORY_ROOT, { complete: true });
    const pages = docs.catalog.sections.flatMap((section) => section.pages);
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      expect(page.title, page.file).not.toBe("");
      expect(page.description, page.file).not.toBe("");
      expect(docs.content[page.slug]?.body, page.file).toBeTruthy();
      // Nothing of the repository's own structure leaks into the site's links.
      expect(docs.content[page.slug]?.body, page.file).not.toMatch(/\]\(\.\.?\//);
    }
  });
});

/** A glob over a path with `/` separators: `**` crosses directories, `*` and `?` do not. */
function globRegex(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern.charAt(i);
    if (char === "*" && pattern.charAt(i + 1) === "*") {
      i += pattern.charAt(i + 2) === "/" ? 2 : 1;
      source += i + 1 >= pattern.length ? ".*" : "(.*/)?";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+()|{}^$\\]/, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

// The rules of the repository's .dockerignore, read as the image's build reads them: a rule
// matches a path or one of its parent directories, and the rules apply in order, a `!` rule
// only to a path the rules before it left out.
interface IgnoreRule {
  readonly leavesOut: boolean;
  readonly matches: (path: string) => boolean;
}

function ignoreRules(text: string): readonly IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const leavesOut = !line.startsWith("!");
    const pattern = (leavesOut ? line : line.slice(1).trim()).replace(/^\/+|\/+$/g, "");
    const regex = globRegex(pattern);
    const matches = (path: string) => {
      const parts = path.split("/");
      return parts.some((_, index) => regex.test(parts.slice(0, index + 1).join("/")));
    };
    rules.push({ leavesOut, matches });
  }
  return rules;
}

function leftOutOfTheImage(rules: readonly IgnoreRule[], path: string): boolean {
  let out = false;
  for (const rule of rules) {
    if (rule.leavesOut === out) continue;
    if (rule.matches(path)) out = rule.leavesOut;
  }
  return out;
}

/** The files of the repository a task of turbo.json hashes, as globs from the repository root. */
function turboInputs(task: string): readonly RegExp[] {
  const turbo = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "turbo.json"), "utf8")) as {
    readonly tasks: Readonly<Record<string, { readonly inputs?: readonly string[] }>>;
  };
  return (turbo.tasks[task]?.inputs ?? [])
    .filter((input) => input.startsWith("../../"))
    .map((input) => globRegex(input.slice("../../".length)));
}

describe("the files the navigation publishes", () => {
  const published = () => [
    NAV_FILE,
    ...loadDocs(REPOSITORY_ROOT).catalog.sections.flatMap((section) =>
      section.pages.map((page) => page.file),
    ),
  ];

  it("survive .dockerignore, so that the image builds the pages", () => {
    // The pages are built inside the image, from a build context that .dockerignore trims down
    // to what the image needs. A file docs/nav.json names has to survive the trimming, or the
    // image fails to build, in CI alone: pnpm check never builds it.
    const rules = ignoreRules(readFileSync(join(REPOSITORY_ROOT, ".dockerignore"), "utf8"));
    // The rules are read as the build reads them.
    expect(leftOutOfTheImage(rules, "README.md")).toBe(false);
    expect(leftOutOfTheImage(rules, "apps/web/package.json")).toBe(false);
    expect(leftOutOfTheImage(rules, "packages/core/README.md")).toBe(true);
    expect(leftOutOfTheImage(rules, "docs/adr/README.md")).toBe(true);
    expect(leftOutOfTheImage(rules, "apps/server/.env")).toBe(true);
    const files = published();
    expect(files.length).toBeGreaterThan(5);
    expect(files.filter((file) => leftOutOfTheImage(rules, file))).toEqual([]);
  });

  it("are inputs of the web build and its tests in turbo.json, so that a change rebuilds the pages", () => {
    for (const task of ["@skillcdn/web#build", "@skillcdn/web#test"]) {
      const inputs = turboInputs(task);
      expect(inputs.length).toBeGreaterThan(0);
      expect(
        published().filter((file) => !inputs.some((input) => input.test(file))),
        task,
      ).toEqual([]);
    }
  });
});
