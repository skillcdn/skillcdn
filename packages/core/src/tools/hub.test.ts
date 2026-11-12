import { describe, expect, it } from "vitest";
import { parseAddress } from "../address.js";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import { hubBody } from "../rest/bodies.js";
import { restSearchSchema } from "../rest/contracts.js";
import { hubResultOf } from "../rest/results.js";
import { HUB_DEFAULT_LIMIT, HUB_MAX_LIMIT, searchPacksTool } from "./contracts.js";
import { renderFindResult, renderHubInstructions, renderHubResult } from "./render.js";
import type { FindResult, HubResult } from "./results.js";

// The search across every pack a deployment serves (ADR-0070): what the model is told on connect
// and in a result, and the REST body that says the same as data and reads back as the result.

function path(value: string): RepoPath {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error(value);
  return parsed.value;
}
function address(value: string) {
  const parsed = parseAddress(value);
  if (!parsed.ok) throw new Error(value);
  return parsed.value;
}

const result: HubResult = {
  query: "release notes",
  packs: 7,
  items: [
    {
      address: address("/gh/acme/multi-skill"),
      repository: "Acme/multi-skill",
      pack: {
        kind: "skills",
        verified: true,
        skills: 3,
        avatar: "https://avatars.example/acme.png",
      },
      item: {
        kind: "skill",
        path: path("skills/release-notes/SKILL.md"),
        name: "release-notes",
        directory: path("skills/release-notes"),
        description: "Writes the notes of a release.",
        files: [],
        moreFiles: 0,
        translations: {},
      },
    },
    {
      address: address("/gh/acme/document-pack"),
      repository: "Acme/document-pack",
      item: {
        kind: "document",
        path: path("docs/release-notes.md"),
        title: "Release notes",
        summary: "What changed, by release.",
        skillDirectory: undefined,
        sections: [
          {
            heading: ["Release notes", "2.0"],
            offset: 120,
            length: 400,
            excerpt: "The 2.0 release.",
          },
        ],
      },
    },
  ],
  ranking: { meaning: true, reranked: false },
};

describe("a search across every pack", () => {
  it("renders every item under the address of its pack, and says how to go on", () => {
    const text = renderHubResult(result, "https://packs.example");
    expect(text).toContain('2 results for "release notes" across 7 packs:');
    expect(text).toContain(
      "1. /gh/acme/multi-skill\n   skill: release-notes (skills/release-notes/SKILL.md)\n   Writes the notes of a release.",
    );
    expect(text).toContain(
      "2. /gh/acme/document-pack\n   document: docs/release-notes.md - Release notes\n   What changed, by release.\n   Sections:\n   - Release notes > 2.0 (offset 120, limit 400): The 2.0 release.",
    );
    expect(text).toContain("A section is read at its pack with read_repo_file");
    expect(text).toContain("Ranked by words and meaning.");
    expect(text).toContain(
      "Connect to a pack at https://packs.example by its address for browse_repo, search_repo, load_skill and read_repo_file",
    );
    // Where the words ran out of their time, the one line says whose answer this is (ADR-0091).
    const byMeaningAlone = { ...result, ranking: { meaning: true, reranked: false, words: false } };
    expect(renderHubResult(byMeaningAlone, undefined)).toContain(
      "Ranked by meaning alone this time: the words did not answer in time, so a result only they would find is missing. Ask again for the full answer.",
    );
    expect(restSearchSchema.parse(hubBody(byMeaningAlone)).ranking).toEqual({
      meaning: true,
      reranked: false,
      words: false,
    });
    expect(renderHubResult({ ...result, items: [], ranking: undefined }, undefined)).toBe(
      'No results for "release notes" across 7 packs. Try fewer or different keywords, in the language a pack is written in.',
    );
  });

  it("names the reads as commands that take the address, where nothing is connected to", () => {
    const words = {
      browse: "skillcdn browse",
      search: "skillcdn find",
      load: "skillcdn skill",
      read: "skillcdn file",
    };
    const text = renderHubResult(result, "https://packs.example", words);
    expect(text).toContain("1. /gh/acme/multi-skill\n   skill: release-notes");
    expect(text).toContain(
      "A section is read with skillcdn file: the address of its pack, the path, its offset and its limit.",
    );
    expect(text).toContain(
      "A pack at https://packs.example is read by its address, which skillcdn browse, skillcdn find, skillcdn skill and skillcdn file take first: skillcdn skill <address> <path of a SKILL.md> loads a skill whole.",
    );
    expect(text).not.toContain("Connect to a pack");
    expect(text).not.toContain("read_repo_file");
  });

  it("tells a client on connect what is here and how a pack it finds is used", () => {
    const text = renderHubInstructions(7, "https://packs.example");
    expect(text).toContain("7 public packs served at https://packs.example");
    expect(text).toContain("search_packs");
    expect(text).toContain("https://packs.example/gh/<owner>/<repo>");
    expect(renderHubInstructions(1)).toContain("1 public pack served at this deployment");
    expect(searchPacksTool.name).toBe("search_packs");
    expect(
      searchPacksTool.inputSchema.safeParse({ query: "x", limit: HUB_MAX_LIMIT }).success,
    ).toBe(true);
    expect(searchPacksTool.inputSchema.safeParse({ query: " ", limit: 1 }).success).toBe(false);
    expect(
      searchPacksTool.inputSchema.safeParse({ query: "x", limit: HUB_MAX_LIMIT + 1 }).success,
    ).toBe(false);
    expect(HUB_DEFAULT_LIMIT).toBeLessThanOrEqual(HUB_MAX_LIMIT);
  });

  it("answers the REST body that parses with the schema and reads back as the result", () => {
    const body = hubBody(result);
    expect(restSearchSchema.parse(body)).toEqual(body);
    expect(body.items.map((item) => item.address)).toEqual([
      "/gh/acme/multi-skill",
      "/gh/acme/document-pack",
    ]);
    // What the pack is travels where the deployment says it, and not where it does not.
    expect(body.items[0]?.pack).toEqual({
      kind: "skills",
      verified: true,
      skills: 3,
      avatar: "https://avatars.example/acme.png",
    });
    expect(body.items[1]?.pack).toBeUndefined();
    expect(body.items[1]?.item).toMatchObject({
      kind: "document",
      path: "docs/release-notes.md",
      sections: [{ heading: ["Release notes", "2.0"], offset: 120, length: 400 }],
    });
    expect(hubResultOf(body)).toEqual(result);
    // An item whose pack is no address is dropped on the way back.
    expect(
      hubResultOf({ ...body, items: [{ ...(body.items[0] ?? {}), address: "nowhere" }] } as never)
        .items,
    ).toEqual([]);
  });
});

describe("the line that says how a search was ranked", () => {
  const found = (ranking: FindResult["ranking"]): string =>
    renderFindResult({
      mount: {
        repository: "acme/docs",
        ref: undefined,
        commit: "0".repeat(40),
        path: "" as RepoPath,
        verified: true,
        truncated: false,
        skillUri: "skill://gh/acme/docs",
      },
      query: "late fee",
      items: [
        {
          kind: "document",
          path: "docs/fees.md" as RepoPath,
          title: "Fees",
          summary: undefined,
          skillDirectory: undefined,
        },
      ],
      totals: undefined,
      diagnostics: [],
      ranking,
    });

  it("says which layers took part, and how far the embedding is while it goes on", () => {
    expect(found(undefined)).not.toContain("Ranked by");
    expect(found({ meaning: true, reranked: false })).toContain("Ranked by words and meaning.");
    expect(found({ meaning: true, reranked: true })).toContain(
      "Ranked by words and meaning, the first results reranked.",
    );
    expect(
      found({ meaning: true, reranked: false, embedding: { embedded: 123, total: 380 } }),
    ).toContain("Ranked by words and meaning; 123 of 380 documents embedded so far.");
    expect(
      found({ meaning: true, reranked: true, embedding: { embedded: 1, total: 1 } }),
    ).toContain(
      "Ranked by words and meaning, the first results reranked; 1 of 1 document embedded so far.",
    );
    expect(found({ meaning: false, reranked: false })).toContain(
      "Ranked by words alone this time: the search by meaning did not answer.",
    );
    expect(found({ meaning: false, reranked: false, identifiers: true })).toContain(
      "Ranked by words alone: a query of numbers and names is matched as written.",
    );
  });
});
