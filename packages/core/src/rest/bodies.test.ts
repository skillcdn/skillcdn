import { describe, expect, it } from "vitest";
import { parseAddress } from "../address.js";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import { renderInstructions } from "../tools/catalog.js";
import type { MountOverview } from "../tools/reads.js";
import type {
  BrowseResult,
  DirectoryResult,
  FileResult,
  FindResult,
  MountSummary,
  SkillResult,
} from "../tools/results.js";
import {
  browseBody,
  directoryBody,
  fileBody,
  findBody,
  mountBody,
  skillOutcome,
} from "./bodies.js";
import {
  restBrowseSchema,
  restFileSchema,
  restFindSchema,
  restMountSchema,
  restSkillSchema,
} from "./contracts.js";
import {
  browseResultOf,
  catalogStateOf,
  directoryResultOf,
  fileResultOf,
  findResultOf,
  mountSummaryOf,
  skillResultOf,
} from "./results.js";

// Every body the API answers with reads back as the result it was built from, so that a
// program on the REST API renders what an MCP client's model is given. The bodies are also
// parsed with the schemas, as a client parses them.

function path(input: string): RepoPath {
  const parsed = parseRepoPath(input);
  if (!parsed.ok) throw new Error(`invalid test path ${input}`);
  return parsed.value;
}

function address(input: string) {
  const parsed = parseAddress(input);
  if (!parsed.ok) throw new Error(`invalid test address ${input}`);
  return parsed.value;
}

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const mount: MountSummary = {
  repository: "Acme/Skills",
  ref: "main",
  commit: COMMIT,
  path: path(""),
  verified: false,
  truncated: false,
  skillUri: "skill://gh/acme/skills",
};

const overview: MountOverview = {
  overview: { path: path("README.md"), title: "Skills", description: "What we do." },
  groups: [
    {
      kind: "directory",
      path: path("marketing"),
      name: "Marketing",
      description: null,
      skillCount: 1,
      documentCount: 0,
      size: null,
      manifestPath: null,
      language: null,
      browsePath: path("marketing"),
    },
  ],
  mount,
  manifest: {
    path: path("SKILLCDN.md"),
    name: "Acme skills",
    description: "The skills of Acme.",
    language: "en",
    image: undefined,
    translations: { ko: { name: "에이크미 스킬", description: undefined } },
    rules: "Be brief.",
  },
  license: { kind: "permissive", name: "MIT", source: path("LICENSE") },
  skillCount: 1,
  documentCount: 1,
  skills: [
    {
      name: "ads",
      directory: path("marketing/ads"),
      description: "Writes ads.",
      warnings: [],
      translations: { ko: { title: "광고", description: "광고를 씁니다." } },
    },
  ],
  documents: [
    {
      kind: "document",
      path: path("docs/guide.md"),
      title: "Guide",
      summary: undefined,
      skillDirectory: undefined,
    },
  ],
  diagnostics: [{ path: path("broken/SKILL.md"), code: "invalid_front_matter", message: "x" }],
};

const restMount = mountBody(
  {
    address: address("/gh/Acme/Skills@main"),
    repository: {
      host: "gh",
      owner: "Acme",
      name: "Skills",
      defaultBranch: "main",
      description: "Acme's skills",
      avatar: "https://avatars.example/acme",
      visibility: "public",
    },
    commit: COMMIT,
    verified: false,
    image: (manifest) => (manifest === undefined ? null : "https://pictures.example/acme"),
  },
  { status: "ready", overview },
);

describe("the mounts body", () => {
  it("parses with the schema and reads back as the summary and the catalog of the address", () => {
    expect(restMountSchema.parse(restMount)).toEqual(restMount);
    expect(restMount.image).toBe("https://pictures.example/acme");
    expect(mountSummaryOf(restMount)).toEqual(mount);
    const state = catalogStateOf(restMount);
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.catalog.manifest).toEqual({
      name: "Acme skills",
      description: "The skills of Acme.",
      path: path("SKILLCDN.md"),
      language: "en",
    });
    expect(state.catalog.skills).toEqual([
      { name: "ads", directory: path("marketing/ads"), description: "Writes ads." },
    ]);
    expect(state.catalog.groups).toEqual(overview.groups);
    expect(state.catalog.diagnostics).toEqual(overview.diagnostics);
    expect(renderInstructions(state)).toContain("Acme skills: The skills of Acme.");
  });

  it("says that the index is not ready, and reads that back", () => {
    const indexing = mountBody(
      {
        address: address("/gh/acme/skills"),
        repository: restMount.repository,
        commit: COMMIT,
        verified: true,
        image: () => null,
      },
      { status: "indexing" },
    );
    expect(indexing.index).toEqual({ status: "indexing" });
    expect(indexing.image).toBeNull();
    expect(mountSummaryOf(indexing)).toMatchObject({
      truncated: false,
      verified: true,
      ref: undefined,
    });
    expect(catalogStateOf(indexing)).toEqual({
      status: "indexing",
      mount: mountSummaryOf(indexing),
      description: "Acme's skills",
    });
  });
});

describe("the browse body", () => {
  it("round-trips, with the licensing of a skill entry", () => {
    const result: BrowseResult = {
      mount,
      path: path("marketing"),
      overview: { path: path("marketing/README.md"), title: "Marketing", description: undefined },
      entries: [
        {
          kind: "skill",
          path: path("marketing/ads/SKILL.md"),
          browsePath: path("marketing/ads"),
          name: "ads",
          description: "Writes ads.",
          skillCount: 1,
          documentCount: 0,
          size: null,
          manifestPath: "marketing/ads/SKILL.md",
          language: null,
          license: { kind: "restrictive", name: "CC-BY-NC-4.0", source: undefined },
          describedOnly: true,
        },
      ],
      nextCursor: "next",
      diagnostics: [],
    };
    const body = browseBody({ status: "ready", result });
    expect(restBrowseSchema.parse(body)).toEqual(body);
    if (body.status !== "ready") throw new Error("not ready");
    expect(body.commit).toBe(COMMIT);
    expect(browseResultOf(body, mount)).toEqual(result);
  });

  it("drops an entry whose path is not one, and a folder whose path is not one", () => {
    const hostile = restBrowseSchema.parse({
      status: "ready",
      commit: COMMIT,
      path: "",
      entries: [
        {
          kind: "file",
          path: "../x",
          name: null,
          description: null,
          skillCount: 0,
          documentCount: 0,
          size: 1,
          manifestPath: null,
          language: null,
        },
      ],
      nextCursor: null,
    });
    if (hostile.status !== "ready") throw new Error("not ready");
    expect(browseResultOf(hostile, mount)?.entries).toEqual([]);
    expect(browseResultOf({ ...hostile, path: "/abs" }, mount)).toBeUndefined();
  });
});

describe("the find body", () => {
  it("round-trips a listing and a search", () => {
    const listing: FindResult = {
      mount,
      query: undefined,
      path: path(""),
      items: [
        {
          kind: "skill",
          path: path("marketing/ads/SKILL.md"),
          name: "ads",
          directory: path("marketing/ads"),
          description: "Writes ads.",
          files: [],
          moreFiles: 0,
          translations: {},
        },
        {
          kind: "document",
          path: path("docs/guide.md"),
          title: "Guide",
          summary: "How to.",
          skillDirectory: undefined,
        },
      ],
      totals: { skills: 1, documents: 1 },
      diagnostics: [],
      nextCursor: undefined,
    };
    const listed = findBody({ status: "ready", result: listing });
    expect(restFindSchema.parse(listed)).toEqual(listed);
    if (listed.status !== "ready") throw new Error("not ready");
    expect(findResultOf(listed, mount)).toEqual(listing);

    const search: FindResult = {
      mount,
      query: "ads",
      path: path("marketing"),
      items: [
        {
          kind: "skill",
          path: path("marketing/ads/SKILL.md"),
          name: "ads",
          directory: path("marketing/ads"),
          description: "Writes ads.",
          files: [{ path: path("marketing/ads/guide.md"), title: "Guide", summary: undefined }],
          moreFiles: 2,
          translations: { ko: { title: "광고", description: undefined } },
          license: { kind: "permissive", name: "MIT", source: path("LICENSE") },
        },
      ],
      totals: undefined,
      diagnostics: [],
      nextCursor: "more",
    };
    const found = findBody({ status: "ready", result: search });
    if (found.status !== "ready") throw new Error("not ready");
    expect(findResultOf(found, mount)).toEqual(search);
  });
});

describe("the skills body", () => {
  const skill: SkillResult = {
    mount,
    path: path("marketing/ads/SKILL.md"),
    ruleChain: [{ path: path("SKILLCDN.md"), body: "Be brief.", truncated: false }],
    references: [
      {
        source: "marketing/ads/SKILL.md",
        href: "./guide.md",
        path: "marketing/ads/guide.md",
        status: "available",
      },
    ],
    complete: false,
    nextCursor: "page2",
    name: "ads",
    directory: path("marketing/ads"),
    description: "Writes ads.",
    license: "MIT",
    compatibility: undefined,
    allowedTools: "Bash",
    metadata: { author: "acme" },
    body: "# Ads\n",
    files: [path("marketing/ads/guide.md")],
    filesTruncated: false,
    oversized: [{ path: "marketing/ads/big.pdf", size: 9_000_000, sourceUrl: "https://x/big.pdf" }],
    included: [{ path: path("marketing/ads/guide.md"), content: "Guide", truncated: true }],
    warnings: ["w"],
    rules: { path: path("SKILLCDN.md"), body: "Be brief.", truncated: false },
    translations: { ko: { title: "광고", description: "광고를 씁니다." } },
    serving: {
      license: { kind: "permissive", name: "MIT", source: path("LICENSE") },
      full: true,
      sourceUrl: "https://github.com/acme/skills/blob/x/marketing/ads/SKILL.md",
    },
  };

  it("round-trips a found skill, naming its commit", () => {
    const outcome = skillOutcome({ status: "ready", lookup: { kind: "found", skill } });
    if (!("body" in outcome)) throw new Error("not a body");
    expect(restSkillSchema.parse(outcome.body)).toEqual(outcome.body);
    if (outcome.body.status !== "ready") throw new Error("not ready");
    expect(outcome.body.commit).toBe(COMMIT);
    expect(skillResultOf(outcome.body, mount)).toEqual(skill);
  });

  it("names the commit a result was read at, when it differs from the summary's", () => {
    const outcome = skillOutcome({ status: "ready", lookup: { kind: "found", skill } });
    if (!("body" in outcome) || outcome.body.status !== "ready") throw new Error("not ready");
    const later = { ...mount, commit: "f".repeat(40) };
    expect(skillResultOf(outcome.body, later)?.mount.commit).toBe(COMMIT);
  });

  it("answers a failure with its status for what was not found", () => {
    expect(
      skillOutcome({
        status: "ready",
        lookup: { kind: "ambiguous", directories: ["a", "b"] },
      }),
    ).toEqual({
      failure: {
        status: 409,
        code: "skill.ambiguous",
        message: "Several skills share that name. Ask for a directory.",
        directories: ["a", "b"],
      },
    });
    expect(skillOutcome({ status: "failed", errorCode: "boom" })).toEqual({
      body: { status: "failed", errorCode: "boom" },
    });
  });
});

describe("the files body", () => {
  it("round-trips a page of a file and a folder", () => {
    const file: FileResult = {
      mount,
      path: path("docs/guide.md"),
      content: "# Guide",
      offset: 0,
      nextOffset: 7,
      totalLength: 100,
      references: [{ href: "./a.md", path: "docs/a.md", status: "missing" }],
    };
    const page = fileBody(file);
    expect(restFileSchema.parse(page)).toEqual(page);
    if (page.kind !== "file") throw new Error("not a file");
    expect(page.commit).toBe(COMMIT);
    expect(fileResultOf(page, mount)).toEqual(file);

    const directory: DirectoryResult = {
      mount,
      path: path("docs"),
      entries: [
        { path: path("docs/sub"), kind: "directory", size: undefined },
        { path: path("docs/guide.md"), kind: "file", size: 100 },
      ],
      truncated: false,
    };
    const listing = directoryBody(directory);
    expect(restFileSchema.parse(listing)).toEqual(listing);
    if (listing.kind !== "directory") throw new Error("not a directory");
    expect(directoryResultOf(listing, mount)).toEqual(directory);
  });
});
