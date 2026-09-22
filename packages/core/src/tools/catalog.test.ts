import { describe, expect, it } from "vitest";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import {
  type CatalogSkill,
  type CatalogState,
  describeFindTool,
  FIND_DESCRIPTION_MAX_LENGTH,
  INSTRUCTIONS_MAX_LENGTH,
  renderInstructions,
} from "./catalog.js";
import { findTool } from "./contracts.js";
import type { MountSummary } from "./results.js";

function path(input: string): RepoPath {
  const result = parseRepoPath(input);
  if (!result.ok) {
    throw new Error(`invalid test path ${input}`);
  }
  return result.value;
}

const mount: MountSummary = {
  repository: "acme/skills",
  ref: "main",
  commit: "0123456789abcdef0123456789abcdef01234567",
  path: path(""),
  verified: true,
  truncated: false,
};

function never(): never {
  throw new Error("expected a ready catalog");
}

const skill = (name: string, description: string, directory = `skills/${name}`): CatalogSkill => ({
  name,
  directory: path(directory),
  description,
});

const ready = (
  skills: readonly CatalogSkill[],
  counts: { skillCount?: number; documentCount?: number } = {},
): CatalogState => ({
  status: "ready",
  catalog: {
    mount,
    manifest: undefined,
    skills,
    skillCount: counts.skillCount ?? skills.length,
    documentCount: counts.documentCount ?? 2,
  },
});

describe("renderInstructions", () => {
  it("lets a repository with a manifest introduce itself, and points at its rules", () => {
    const state = ready([skill("incident-review", "Guides a blameless incident review.")]);
    const catalog = state.status === "ready" ? state.catalog : never();
    const text = renderInstructions({
      status: "ready",
      catalog: {
        ...catalog,
        manifest: {
          name: "Acme playbooks",
          description: "The playbooks every Acme team runs. Use them for incidents and releases.",
          path: path("SKILLCDN.md"),
          hasRules: true,
        },
      },
    });
    expect(text).toContain(
      "This server serves Acme playbooks, the git repository acme/skills@main (commit 0123456): The playbooks every Acme team runs. Use them for incidents and releases. It has 1 skill and 2 other documents.",
    );
    expect(text).toContain(
      "Rules that hold for every skill here come with each skill that get returns",
    );
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);

    const unnamed = renderInstructions({
      status: "ready",
      catalog: {
        ...catalog,
        manifest: { name: undefined, description: "Playbooks.", path: undefined, hasRules: false },
      },
    });
    expect(unnamed).toContain("This server serves acme/skills, the git repository");
    expect(unnamed).not.toContain("Rules that hold");
  });

  it("names every skill with its description, and says how to use one", () => {
    const text = renderInstructions(
      ready([
        skill("incident-review", "Guides a blameless incident review."),
        skill("release-notes", "Drafts release notes  from merged\nchanges."),
      ]),
    );
    expect(text).toBe(
      [
        "This server serves the skills and documents of the git repository acme/skills@main (commit 0123456). It has 2 skills and 2 other documents.",
        "Skills:",
        "- incident-review: Guides a blameless incident review.",
        "- release-notes: Drafts release notes from merged changes.",
        "To use a skill, call get with its name, follow the instructions it returns, and read the files it points to with read_file. find searches the skills and the documents; read_file lists a directory when given one.",
      ].join("\n"),
    );
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
  });

  it("shortens the descriptions, then keeps only the names, to stay under the budget", () => {
    const long = "A description that goes on and on. ".repeat(30);
    const shortened = renderInstructions(ready([skill("a", long), skill("b", long)]));
    expect(shortened.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    expect(shortened).toContain("- a: A description that goes on");
    expect(shortened).toContain("…");

    const thirty = Array.from({ length: 30 }, (_, index) => skill(`skill-${index}`, long));
    const namesOnly = renderInstructions(ready(thirty));
    expect(namesOnly.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    expect(namesOnly).toContain("skill-0, skill-1,");
    expect(namesOnly).toContain("skill-29");
    expect(namesOnly).not.toContain("goes on");
  });

  it("counts the skills that did not fit, and the ones beyond the listing cap", () => {
    const wide = Array.from({ length: 100 }, (_, index) =>
      skill(`a-rather-long-skill-name-number-${index}`, "x".repeat(1024)),
    );
    const text = renderInstructions(ready(wide, { skillCount: 250 }));
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    expect(text).toMatch(/\(and \d+ more; find without a query lists every skill\)/);
    expect(text).toContain("It has 250 skills");
  });

  it("tells skills that share a name apart by their directory", () => {
    const text = renderInstructions(
      ready([
        skill("review", "Reviews code.", "eng/review"),
        skill("review", "Reviews copy.", "marketing/review"),
        skill("deploy", "Deploys."),
      ]),
    );
    expect(text).toContain("- review (eng/review): Reviews code.");
    expect(text).toContain("- review (marketing/review): Reviews copy.");
    expect(text).toContain("- deploy: Deploys.");
  });

  it("says when the index is not there, and when there are no skills", () => {
    expect(renderInstructions({ status: "indexing", mount })).toContain(
      "The commit is being indexed; in a few seconds, find lists its skills.",
    );
    expect(renderInstructions({ status: "failed", mount })).toContain("could not be indexed");
    const none = renderInstructions(ready([], { documentCount: 7 }));
    expect(none).toContain("It has no skills; its 7 documents can be searched with find");
  });
});

describe("describeFindTool", () => {
  it("names the skills after the usual description", () => {
    const text = describeFindTool(ready([skill("a", "A."), skill("b", "B.")]));
    expect(text).toBe(`${findTool.description} Skills here: a, b.`);
  });

  it("stays short with many or long names", () => {
    const many = Array.from({ length: 100 }, (_, index) =>
      skill(`a-rather-long-skill-name-number-${index}`, "x"),
    );
    const text = describeFindTool(ready(many, { skillCount: 120 }));
    expect(text.length).toBeLessThanOrEqual(FIND_DESCRIPTION_MAX_LENGTH);
    expect(text).toMatch(/ \(and \d+ more\)\.$/);
  });

  it("says when there is nothing to name yet", () => {
    expect(describeFindTool({ status: "indexing", mount })).toContain("being indexed");
    expect(describeFindTool({ status: "failed", mount })).toBe(findTool.description);
    expect(describeFindTool(ready([]))).toContain("no skills, only documents");
  });
});
