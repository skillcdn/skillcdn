import { describe, expect, it } from "vitest";
import {
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_MANIFEST_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  parseSkillManifest,
  type SkillManifestErrorCode,
} from "./skill-manifest.js";

const MINIMAL = [
  "---",
  "name: release-notes",
  "description: Drafts release notes from merged changes. Use when preparing a release.",
  "---",
  "# Release notes",
  "",
  "Collect the merged changes first.",
  "",
].join("\n");

function parsed(text: string, directoryName: string | undefined = "release-notes") {
  const result = parseSkillManifest(text, { directoryName });
  if (!result.ok) {
    throw new Error(`expected the manifest to parse, got ${result.error.code}`);
  }
  return result.value;
}

function errorCode(text: string): SkillManifestErrorCode | undefined {
  const result = parseSkillManifest(text, { directoryName: undefined });
  return result.ok ? undefined : result.error.code;
}

describe("parseSkillManifest", () => {
  it("reads a minimal manifest", () => {
    expect(parsed(MINIMAL)).toEqual({
      manifest: {
        name: "release-notes",
        description: "Drafts release notes from merged changes. Use when preparing a release.",
        license: undefined,
        compatibility: undefined,
        allowedTools: undefined,
        metadata: {},
        body: "# Release notes\n\nCollect the merged changes first.\n",
      },
      warnings: [],
    });
  });

  it("reads the optional fields and keeps scalars as text", () => {
    const { manifest, warnings } = parsed(
      [
        "---",
        "name: release-notes",
        "description: >",
        "  Drafts release notes",
        "  from merged changes.",
        "license: Apache-2.0",
        "compatibility: Requires git",
        "allowed-tools: Bash(git:*) Read",
        "metadata:",
        "  author: acme",
        "  version: 1.0",
        "future-field: ignored",
        "---",
        "Body",
      ].join("\n"),
    );
    expect(warnings).toEqual([]);
    expect(manifest).toMatchObject({
      description: "Drafts release notes from merged changes.",
      license: "Apache-2.0",
      compatibility: "Requires git",
      allowedTools: "Bash(git:*) Read",
      metadata: { author: "acme", version: "1.0" },
      body: "Body",
    });
    expect(manifest).not.toHaveProperty("future-field");
  });

  it("does not compare the name with the directory at the mounted root", () => {
    expect(parsed(MINIMAL, undefined).warnings).toEqual([]);
  });

  it("warns about names that break the naming convention, and still serves the skill", () => {
    const text = MINIMAL.replace("name: release-notes", "name: Release Notes");
    const { manifest, warnings } = parsed(text, "release-notes");
    expect(manifest.name).toBe("Release Notes");
    expect(warnings.map((warning) => warning.code)).toEqual([
      "unconventional_name",
      "name_directory_mismatch",
    ]);
  });

  it("ignores optional fields it cannot use, with a warning", () => {
    const { manifest, warnings } = parsed(
      [
        "---",
        "name: release-notes",
        "description: Drafts release notes.",
        "license: [MIT, Apache-2.0]",
        `compatibility: ${"x".repeat(501)}`,
        "metadata:",
        "  author: acme",
        "  nested: { a: b }",
        "  list: [a]",
        "---",
      ].join("\n"),
    );
    expect(manifest.license).toBeUndefined();
    expect(manifest.compatibility).toBeUndefined();
    expect(manifest.metadata).toEqual({ author: "acme" });
    expect(warnings.map((warning) => warning.code)).toEqual([
      "ignored_field",
      "ignored_field",
      "ignored_field",
    ]);
  });

  it("keeps author-chosen metadata keys away from the prototype", () => {
    const { manifest } = parsed(
      [
        "---",
        "name: release-notes",
        "description: Drafts release notes.",
        "metadata:",
        "  __proto__: polluted",
        "  constructor: x",
        "---",
      ].join("\n"),
    );
    expect(Object.keys(manifest.metadata).sort()).toEqual(["__proto__", "constructor"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(manifest.metadata)).toBeNull();
  });

  it.each<[string, string, SkillManifestErrorCode]>([
    ["no front-matter", "# Release notes\n", "missing_front_matter"],
    ["unterminated front-matter", "---\nname: a\n", "unterminated_front_matter"],
    ["invalid YAML", '---\nname: "a\n---\n', "invalid_front_matter"],
    ["a sequence as front-matter", "---\n- a\n---\n", "invalid_front_matter"],
    ["a missing name", "---\ndescription: d\n---\n", "invalid_name"],
    ["an empty name", '---\nname: ""\ndescription: d\n---\n', "invalid_name"],
    ["a name that is not text", "---\nname: [a]\ndescription: d\n---\n", "invalid_name"],
    ["a multi-line name", '---\nname: "a\\nb"\ndescription: d\n---\n', "invalid_name"],
    [
      "a name that is too long",
      `---\nname: ${"a".repeat(MAX_SKILL_NAME_LENGTH + 1)}\ndescription: d\n---\n`,
      "invalid_name",
    ],
    ["a missing description", "---\nname: a\n---\n", "invalid_description"],
    ["a blank description", '---\nname: a\ndescription: "  "\n---\n', "invalid_description"],
    [
      "a description that is too long",
      `---\nname: a\ndescription: ${"d".repeat(MAX_SKILL_DESCRIPTION_LENGTH + 1)}\n---\n`,
      "invalid_description",
    ],
  ])("skips a manifest with %s", (_name, text, code) => {
    expect(errorCode(text)).toBe(code);
  });
});

describe("parseSkillManifest with hostile input", () => {
  it.each<[string, string, SkillManifestErrorCode]>([
    ["an oversized file", `${MINIMAL}${"x".repeat(MAX_SKILL_MANIFEST_LENGTH)}`, "too_large"],
    [
      "an alias bomb",
      "---\nname: &a [x, x]\ndescription: &b [*a, *a]\nmetadata: [*b, *b]\n---\n",
      "invalid_front_matter",
    ],
    [
      "a control character in the name",
      `---\nname: "a${String.fromCodePoint(0x1b)}[2Jb"\ndescription: d\n---\n`,
      "invalid_name",
    ],
    [
      "a direction override in the name",
      `---\nname: "a${String.fromCodePoint(0x202e)}b"\ndescription: d\n---\n`,
      "invalid_name",
    ],
    [
      "a zero-width character in the description",
      `---\nname: a\ndescription: "d${String.fromCodePoint(0x200b)}d"\n---\n`,
      "invalid_description",
    ],
  ])("skips a manifest with %s", (_name, text, code) => {
    expect(errorCode(text)).toBe(code);
  });
});
