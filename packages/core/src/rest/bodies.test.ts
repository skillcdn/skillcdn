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
  listedBody,
  listingBody,
  mountBody,
  skillOutcome,
} from "./bodies.js";
import {
  restBrowseSchema,
  restFileSchema,
  restFindSchema,
  restListedSchema,
  restListingSchema,
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
  host: "gh",
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
    expect(mountSummaryOf(restMount)).toEqual({ ...mount, visibility: "public" });
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

  it("names the commit the index was read from, with the newest beside it when that is another (ADR-0068)", () => {
    const served = "fedcba9876543210fedcba9876543210fedcba98";
    const facts = {
      address: address("/gh/acme/skills"),
      repository: restMount.repository,
      commit: COMMIT,
      verified: true,
      image: () => null,
    };
    const failed = mountBody(facts, {
      status: "ready",
      overview: {
        ...overview,
        mount: {
          ...mount,
          commit: served,
          newest: { commit: COMMIT, status: "failed", errorCode: "indexer.failed" },
        },
      },
    });
    expect(restMountSchema.parse(failed)).toEqual(failed);
    expect(failed.commit).toBe(served);
    expect(failed.newest).toEqual({
      commit: COMMIT,
      status: "failed",
      errorCode: "indexer.failed",
    });
    expect(mountSummaryOf(failed)).toMatchObject({
      commit: served,
      newest: { commit: COMMIT, status: "failed", errorCode: "indexer.failed" },
    });
    expect(renderInstructions(catalogStateOf(failed))).toContain(
      `(commit ${served.slice(0, 7)}; newest ${COMMIT.slice(0, 7)} failed (indexer.failed))`,
    );
    // Being indexed, there is no error code: the API says null, the summary leaves it out.
    const indexing = mountBody(facts, {
      status: "ready",
      overview: {
        ...overview,
        mount: { ...mount, commit: served, newest: { commit: COMMIT, status: "indexing" } },
      },
    });
    expect(indexing.newest).toEqual({ commit: COMMIT, status: "indexing", errorCode: null });
    expect(mountSummaryOf(indexing).newest).toEqual({ commit: COMMIT, status: "indexing" });
    expect(restMount.newest).toBeNull();
  });

  it("says how the mount is searched: by words alone unless the overview says otherwise", () => {
    expect(restMount.index.status === "ready" ? restMount.index.search : undefined).toEqual({
      meaning: false,
      embedding: null,
    });
    const state = catalogStateOf(restMount);
    // Read back, the words answer alone: a catalog made from the body says so too.
    expect(state.status === "ready" ? state.catalog.search : null).toEqual({
      meaning: false,
      embedding: undefined,
    });
    const facts = {
      address: address("/gh/acme/skills"),
      repository: restMount.repository,
      commit: COMMIT,
      verified: true,
      image: () => null,
    };
    const embedding = mountBody(facts, {
      status: "ready",
      overview: {
        ...overview,
        search: { meaning: true, embedding: { status: "in_progress", embedded: 3, total: 12 } },
      },
    });
    expect(restMountSchema.parse(embedding)).toEqual(embedding);
    const search = embedding.index.status === "ready" ? embedding.index.search : undefined;
    expect(search).toEqual({
      meaning: true,
      embedding: { status: "in_progress", embedded: 3, total: 12 },
    });
    const read = catalogStateOf(embedding);
    expect(read.status === "ready" ? read.catalog.search : undefined).toEqual({
      meaning: true,
      embedding: { status: "in_progress", embedded: 3, total: 12 },
    });
    expect(renderInstructions(read)).toContain("matches words and meaning");
    // Nothing counted: the vectors are there, and that is all that is known.
    const uncounted = mountBody(facts, {
      status: "ready",
      overview: { ...overview, search: { meaning: true, embedding: undefined } },
    });
    expect(uncounted.index.status === "ready" ? uncounted.index.search : undefined).toEqual({
      meaning: true,
      embedding: null,
    });
    const back = catalogStateOf(uncounted);
    expect(back.status === "ready" ? back.catalog.search : undefined).toEqual({
      meaning: true,
      embedding: undefined,
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

  it("round-trips the manifest of a folder, the pictures of its entries, and what an outline says of originals and pictures", () => {
    const folder: BrowseResult = {
      mount,
      path: path("docs"),
      manifestPath: path("docs/SKILLCDN.md"),
      entries: [
        {
          kind: "directory",
          path: path("docs/manual"),
          name: null,
          description: null,
          skillCount: 0,
          documentCount: 3,
          imageCount: 2,
          size: null,
          manifestPath: null,
          language: null,
        },
      ],
      nextCursor: undefined,
      diagnostics: [],
    };
    const folderBody = browseBody({ status: "ready", result: folder });
    expect(restBrowseSchema.parse(folderBody)).toEqual(folderBody);
    if (folderBody.status !== "ready") throw new Error("not ready");
    expect(browseResultOf(folderBody, mount)).toEqual(folder);
    const outlined: BrowseResult = {
      mount,
      path: path("docs/manual/ch3.md"),
      entries: [],
      nextCursor: undefined,
      diagnostics: [],
      outline: {
        path: path("docs/manual/ch3.md"),
        size: 10,
        totalLength: 10,
        headings: [],
        truncated: false,
        sources: [
          {
            text: "sources/a.pdf",
            path: path("docs/manual/sources/a.pdf"),
            url: "https://x/a.pdf",
          },
          { text: "A title" },
        ],
        images: [{ path: path("docs/manual/images/a.png"), alt: "A figure" }],
      },
    };
    const outlinedBody = browseBody({ status: "ready", result: outlined });
    expect(restBrowseSchema.parse(outlinedBody)).toEqual(outlinedBody);
    if (outlinedBody.status !== "ready") throw new Error("not ready");
    expect(browseResultOf(outlinedBody, mount)).toEqual(outlined);
    const pointer: BrowseResult = {
      ...outlined,
      outline: {
        path: path("docs/manual/ch3.md"),
        size: 10,
        totalLength: undefined,
        headings: [],
        truncated: false,
        unavailable: "not_text",
        sourceUrl: "https://x/raw",
        lfs: { size: 12_345 },
      },
    };
    const pointerBody = browseBody({ status: "ready", result: pointer });
    if (pointerBody.status !== "ready") throw new Error("not ready");
    expect(browseResultOf(pointerBody, mount)).toEqual(pointer);
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
      sources: [
        { text: "sources/guide.pdf", path: path("docs/sources/guide.pdf"), url: "https://x/g.pdf" },
        { text: "The guide, third edition" },
      ],
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

describe("the find body and the maps", () => {
  it("round-trips the mark of a document that is the map of its folder", () => {
    const result: FindResult = {
      mount,
      query: "items",
      path: path(""),
      items: [
        {
          kind: "document",
          path: path("docs/README.md"),
          title: "The manual",
          summary: undefined,
          skillDirectory: undefined,
          overview: true,
        },
      ],
      nextCursor: undefined,
      totals: undefined,
      diagnostics: [],
    };
    const body = findBody({ status: "ready", result });
    expect(restFindSchema.parse(body)).toEqual(body);
    if (body.status !== "ready") throw new Error("not ready");
    expect(findResultOf(body, mount).items[0]).toMatchObject({ overview: true });
  });
});

describe("the listing body", () => {
  const SKILL_URI = "skill://gh/acme/skills/marketing/ads/SKILL.md";
  const NOTE_URI = "skill://gh/acme/skills/marketing/ads/references/tone.md";
  const digestOf = (letter: string) => "sha256:" + letter.repeat(64);
  const entry = {
    uri: SKILL_URI,
    frontmatter: { name: "ads", description: "Writes ad copy.", metadata: { version: "2" } },
    resources: [
      { uri: SKILL_URI, digest: digestOf("a"), size: 120 },
      { uri: NOTE_URI, digest: digestOf("b"), size: 40 },
    ],
  };

  it("parses a page of listed skills with the schema, and names the commit it was read from", () => {
    const page = listingBody({
      status: "ready",
      result: { skills: [entry], nextCursor: "next", total: 7, mount },
    });
    expect(restListingSchema.parse(page)).toEqual(page);
    expect(page).toMatchObject({ status: "ready", commit: COMMIT, nextCursor: "next", total: 7 });
    expect(listingBody({ status: "indexing" })).toEqual({ status: "indexing" });
  });

  it("answers a skill with its document, a file with its text or bytes, and a directory with its entries", () => {
    const skill = listedBody(COMMIT, {
      kind: "skill",
      skill: entry,
      document: "---\nname: ads\n---\n# Ads\n",
      digest: digestOf("a"),
    });
    expect(restListedSchema.parse(skill)).toEqual(skill);
    expect(skill).toMatchObject({ status: "ready", commit: COMMIT, item: { kind: "skill" } });

    const file = listedBody(COMMIT, {
      kind: "file",
      resource: {
        uri: NOTE_URI,
        mimeType: "text/markdown",
        text: "# Tone\n",
        digest: digestOf("b"),
      },
    });
    expect(restListedSchema.parse(file)).toEqual(file);
    if (file.status !== "ready" || file.item.kind !== "file") throw new Error("not a file");
    expect(file.item.blob).toBeNull();
    expect(file.item.text).toBe("# Tone\n");

    const picture = listedBody(COMMIT, {
      kind: "file",
      resource: {
        uri: "skill://gh/acme/skills/marketing/ads/a.png",
        mimeType: "image/png",
        blob: "iVBORw0KGgo=",
        digest: digestOf("c"),
      },
    });
    expect(restListedSchema.parse(picture)).toEqual(picture);
    if (picture.status !== "ready" || picture.item.kind !== "file") throw new Error("not a file");
    expect(picture.item.text).toBeNull();

    const directory = listedBody(COMMIT, {
      kind: "directory",
      uri: "skill://gh/acme/skills/marketing/ads",
      entries: [{ uri: SKILL_URI, name: "SKILL.md", mimeType: "text/markdown" }],
    });
    expect(restListedSchema.parse(directory)).toEqual(directory);
    if (directory.status !== "ready" || directory.item.kind !== "directory") {
      throw new Error("not a directory");
    }
    expect(directory.item.resources).toHaveLength(1);
  });
});
