import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_DIRECTORIES,
  MAX_EXCLUDED_PATHS,
  MAX_REPO_DESCRIPTION_LENGTH,
  MAX_REPO_MANIFEST_LENGTH,
  MAX_REPO_NAME_LENGTH,
  parseRepoManifest,
  type RepoManifestErrorCode,
} from "./repo-manifest.js";

const FULL = [
  "---",
  "name: Acme playbooks",
  "description: The playbooks every Acme team runs. Use them for incidents and releases.",
  "documents:",
  "  - docs",
  "  - handbook/",
  "license: MIT",
  "metadata:",
  "  author: acme",
  "---",
  "# Rules for every skill",
  "",
  "- Ask first.",
  "",
].join("\n");

function parsed(text: string) {
  const result = parseRepoManifest(text);
  if (!result.ok) {
    throw new Error(`expected the manifest to parse, got ${result.error.code}`);
  }
  return result.value;
}

function errorCode(text: string): RepoManifestErrorCode | undefined {
  const result = parseRepoManifest(text);
  return result.ok ? undefined : result.error.code;
}

describe("parseRepoManifest", () => {
  it("reads the fields and the body", () => {
    const { manifest, warnings } = parsed(FULL);
    expect(manifest.name).toBe("Acme playbooks");
    expect(manifest.description).toBe(
      "The playbooks every Acme team runs. Use them for incidents and releases.",
    );
    expect(manifest.documents).toEqual(["docs", "handbook"]);
    expect(manifest.license).toBe("MIT");
    expect(manifest.metadata).toEqual({ author: "acme" });
    expect(manifest.body).toBe("# Rules for every skill\n\n- Ask first.\n");
    expect(warnings).toEqual([]);
  });

  it("needs only a description", () => {
    const { manifest } = parsed("---\ndescription: Playbooks.\n---\n");
    expect(manifest.name).toBeUndefined();
    expect(manifest.documents).toEqual(["docs"]);
    expect(manifest.exclude).toEqual([]);
    expect(manifest.language).toBeUndefined();
    expect(manifest.translations).toEqual({});
    expect(manifest.body).toBe("");
  });

  it("reads the language and the translations", () => {
    const { manifest, warnings } = parsed(
      [
        "---",
        "name: Acme playbooks",
        "description: The playbooks every Acme team runs.",
        "language: en",
        "translations:",
        "  ko:",
        "    name: Acme 플레이북",
        "    description: Acme의 모든 팀이 쓰는 플레이북입니다.",
        "  ja:",
        "    name: Acme プレイブック",
        "---",
      ].join("\n"),
    );
    expect(warnings).toEqual([]);
    expect(manifest.language).toBe("en");
    expect(manifest.translations).toEqual({
      ko: { name: "Acme 플레이북", description: "Acme의 모든 팀이 쓰는 플레이북입니다." },
      ja: { name: "Acme プレイブック", description: undefined },
    });
  });

  it("ignores a language that is not a tag and translations that translate nothing", () => {
    const { manifest, warnings } = parsed(
      [
        "---",
        "description: D.",
        "language: Korean",
        "translations:",
        "  ko:",
        "    name: |",
        "      two",
        "      lines",
        "  en-US-x-private-long-subtag: {name: x}",
        "---",
      ].join("\n"),
    );
    expect(manifest.language).toBeUndefined();
    expect(manifest.translations).toEqual({});
    expect(warnings.map((warning) => warning.message)).toEqual([
      '"language" is ignored: expected a language tag such as "en" or "pt-BR"',
      '2 "translations" entries are ignored: expected at most 32 language tags such as "ko", each mapping to translated fields',
    ]);
  });

  it("warns when the description is cut at a hash", () => {
    const { manifest, warnings } = parsed("---\ndescription: Playbooks # for teams\n---\n");
    expect(manifest.description).toBe("Playbooks");
    expect(warnings.map((warning) => warning.code)).toEqual(["commented_value"]);
  });

  it("serves docs unless told otherwise, and nothing when told so", () => {
    expect(parsed("---\ndescription: D.\ndocuments: []\n---\n").manifest.documents).toEqual([]);
    expect(parsed("---\ndescription: D.\ndocuments:\n---\n").manifest.documents).toEqual([]);
  });

  it("lets a dot stand for the manifest's own directory", () => {
    expect(
      parsed("---\ndescription: D.\ndocuments: ['.', docs]\n---\n").manifest.documents,
    ).toEqual(["", "docs"]);
  });

  it("normalizes exact exclusion paths and allows excluding its own scope", () => {
    expect(
      parsed("---\ndescription: D.\nexclude: [fixtures, fixtures/, .data/file.md, '.']\n---\n")
        .manifest.exclude,
    ).toEqual(["fixtures", ".data/file.md", ""]);
    expect(parsed("---\ndescription: D.\nexclude: []\n---\n").manifest.exclude).toEqual([]);
  });

  it.each([
    "fixtures",
    "null",
    "['']",
    "['../up']",
    "['/absolute']",
    "['C:/absolute']",
    "['a/../b']",
    "['a//b']",
    "['a//']",
    "['**/SKILL.md']",
    "['file?.md']",
    "['[abc]']",
    "['{one,two}']",
    "['!keep']",
    "[{path: x}]",
    "['a\\b']",
    `[${Array.from({ length: MAX_EXCLUDED_PATHS + 1 }, (_, i) => `file${i}`).join(",")}]`,
    `['${"a".repeat(1025)}']`,
    `['a${String.fromCodePoint(0x200b)}b']`,
  ])("fails closed instead of dropping invalid exclusions: %s", (value) => {
    expect(errorCode(`---\ndescription: D.\nexclude: ${value}\n---\n`)).toBe("invalid_exclude");
  });

  it("drops directories it cannot trust, and says so", () => {
    const { manifest, warnings } = parsed(
      "---\ndescription: D.\ndocuments: ['../up', '/abs', 'a/../b', docs, docs/, {a: b}]\n---\n",
    );
    expect(manifest.documents).toEqual(["docs"]);
    expect(warnings.map((warning) => warning.code)).toEqual(["ignored_directory"]);
    expect(warnings[0]?.message).toContain("4");
  });

  it("keeps at most the allowed number of directories", () => {
    const many = Array.from({ length: MAX_DOCUMENT_DIRECTORIES + 3 }, (_, i) => `  - d${i}`);
    const { manifest, warnings } = parsed(
      `---\ndescription: D.\ndocuments:\n${many.join("\n")}\n---\n`,
    );
    expect(manifest.documents).toHaveLength(MAX_DOCUMENT_DIRECTORIES);
    expect(warnings.map((warning) => warning.code)).toEqual(["ignored_directory"]);
  });

  it("ignores a documents field that is not a sequence", () => {
    const { manifest, warnings } = parsed("---\ndescription: D.\ndocuments: docs\n---\n");
    expect(manifest.documents).toEqual([]);
    expect(warnings.map((warning) => warning.code)).toEqual(["ignored_field"]);
  });

  it("ignores a name that is too long or not one line", () => {
    const long = parsed(
      `---\nname: ${"n".repeat(MAX_REPO_NAME_LENGTH + 1)}\ndescription: D.\n---\n`,
    );
    expect(long.manifest.name).toBeUndefined();
    expect(long.warnings.map((warning) => warning.code)).toEqual(["ignored_field"]);
    const folded = parsed("---\nname: |\n  two\n  lines\ndescription: D.\n---\n");
    expect(folded.manifest.name).toBeUndefined();
  });

  it.each<[string, string, RepoManifestErrorCode]>([
    ["no front-matter", "# Just a document\n", "missing_front_matter"],
    ["unterminated front-matter", "---\ndescription: D.\n", "unterminated_front_matter"],
    ["invalid YAML", "---\ndescription: [\n---\n", "invalid_front_matter"],
    ["a sequence instead of a mapping", "---\n- a\n---\n", "invalid_front_matter"],
    ["no description", "---\nname: Acme\n---\n", "invalid_description"],
    [
      "a description that is too long",
      `---\ndescription: ${"d".repeat(MAX_REPO_DESCRIPTION_LENGTH + 1)}\n---\n`,
      "invalid_description",
    ],
    [
      "a description with an invisible character",
      `---\ndescription: Play${String.fromCodePoint(0x200b)}books.\n---\n`,
      "invalid_description",
    ],
    [
      "too much text",
      `---\ndescription: D.\n---\n${"x".repeat(MAX_REPO_MANIFEST_LENGTH)}`,
      "too_large",
    ],
  ])("cannot be read with %s", (_, text, code) => {
    expect(errorCode(text)).toBe(code);
  });
});
