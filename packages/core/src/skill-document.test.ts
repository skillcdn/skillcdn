import { describe, expect, it } from "vitest";
import { parseFrontMatter } from "./front-matter.js";
import {
  assembleSkillDocument,
  frontMatterObject,
  provenanceLine,
  renderSkillSections,
  serializeFrontMatter,
} from "./skill-document.js";

function fields(source: string): ReadonlyMap<string, unknown> {
  const parsed = parseFrontMatter(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

const SOURCE = [
  "name: release-notes",
  'description: "Writes release notes. Use when a release: is due."',
  "license: Apache-2.0",
  "allowed-tools: Bash(git log:*)",
  "metadata:",
  "  author: acme",
  "  version: 1.0",
  "skillcdn:",
  "  include: [references/style.md]",
  "  translations:",
  "    ko:",
  "      title: 릴리스 노트",
  "tags: [release, notes]",
  "empty:",
].join("\n");

describe("the served front matter", () => {
  it("keeps the author's fields in order, quotes every value and drops the skillcdn key", () => {
    expect(serializeFrontMatter(fields(SOURCE))).toBe(
      [
        'name: "release-notes"',
        'description: "Writes release notes. Use when a release: is due."',
        'license: "Apache-2.0"',
        'allowed-tools: "Bash(git log:*)"',
        "metadata:",
        '  author: "acme"',
        '  version: "1.0"',
        "tags:",
        '  - "release"',
        '  - "notes"',
        'empty: ""',
      ].join("\n"),
    );
  });

  it("serializes what a reader will parse back, field by field", () => {
    const served = serializeFrontMatter(fields(SOURCE));
    expect(frontMatterObject(fields(served))).toEqual(frontMatterObject(fields(SOURCE)));
    expect(frontMatterObject(fields(SOURCE))).toEqual({
      name: "release-notes",
      description: "Writes release notes. Use when a release: is due.",
      license: "Apache-2.0",
      "allowed-tools": "Bash(git log:*)",
      metadata: { author: "acme", version: "1.0" },
      tags: ["release", "notes"],
      empty: "",
    });
  });

  it("quotes keys and values that a reader could mistake for something else", () => {
    const text = serializeFrontMatter(
      fields(
        [
          '"true": yes',
          'quote: say "hi"',
          "multi: |",
          "  two",
          "  lines",
          "nested:",
          "  - a: 1",
          "    b: [x]",
        ].join("\n"),
      ),
    );
    expect(text).toBe(
      [
        '"true": "yes"',
        'quote: "say \\"hi\\""',
        'multi: "two\\nlines\\n"',
        "nested:",
        "  -",
        '    a: "1"',
        "    b:",
        '      - "x"',
      ].join("\n"),
    );
    expect(fields(text).get("multi")).toBe("two\nlines\n");
  });
});

describe("the assembled document", () => {
  const input = {
    frontMatter: fields(SOURCE),
    commit: "0123456789abcdef0123456789abcdef01234567",
    sources: [
      "SKILLCDN.md",
      "skills/release-notes/SKILL.md",
      "skills/release-notes/references/style.md",
    ],
    rules: [{ path: "SKILLCDN.md", body: "# Rules\n\nAsk first." }],
    body: "# Release notes\n\nGroup the changes.",
    included: [
      { path: "skills/release-notes/references/style.md", content: "Lead with the benefit." },
    ],
  };

  it("is a SKILL.md: quoted front matter, provenance, rules, instructions, included files", () => {
    const document = assembleSkillDocument(input);
    expect(document).toBe(
      [
        "---",
        'name: "release-notes"',
        'description: "Writes release notes. Use when a release: is due."',
        'license: "Apache-2.0"',
        'allowed-tools: "Bash(git log:*)"',
        "metadata:",
        '  author: "acme"',
        '  version: "1.0"',
        "tags:",
        '  - "release"',
        '  - "notes"',
        'empty: ""',
        "---",
        "> Assembled by SkillCDN from `SKILLCDN.md`, `skills/release-notes/SKILL.md` and `skills/release-notes/references/style.md` at commit `0123456789abcdef0123456789abcdef01234567`.",
        "",
        "--- applicable rules: SKILLCDN.md ---",
        "# Rules",
        "",
        "Ask first.",
        "",
        "--- instructions ---",
        "# Release notes",
        "",
        "Group the changes.",
        "",
        "--- included file: skills/release-notes/references/style.md ---",
        "Lead with the benefit.",
        "",
      ].join("\n"),
    );
    expect(assembleSkillDocument(input)).toBe(document);
  });

  it("stays a plain skill when nothing is added to it", () => {
    expect(
      assembleSkillDocument({
        frontMatter: fields("name: x\ndescription: One."),
        commit: "a".repeat(40),
        sources: ["SKILL.md"],
        rules: [],
        body: "Do it.",
        included: [],
      }),
    ).toBe(
      `---\nname: "x"\ndescription: "One."\n---\n${provenanceLine("a".repeat(40), ["SKILL.md"])}\n\n--- instructions ---\nDo it.\n`,
    );
  });

  it("marks sections a page cut, and files that are not at hand, only for a tool", () => {
    const sections = {
      rules: [{ path: "SKILLCDN.md", body: "Ask", truncated: true }],
      body: "",
      included: [{ path: "a.md", content: undefined }],
    };
    expect(renderSkillSections(sections)).toBe(
      "--- applicable rules: SKILLCDN.md ---\nAsk\n\n--- included file: a.md ---\n(Not at hand here.)",
    );
    expect(renderSkillSections(sections, { tool: "load_skill", reader: "read_repo_file" })).toBe(
      "--- applicable rules: SKILLCDN.md ---\nAsk\n(Continues in the next load_skill page.)\n\n--- included file: a.md ---\n(Not at hand here; read_repo_file has it.)",
    );
  });
});
