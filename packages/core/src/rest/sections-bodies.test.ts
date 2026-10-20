import { describe, expect, it } from "vitest";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import type { BrowseResult, FindResult, MountSummary } from "../tools/results.js";
import { browseBody, findBody } from "./bodies.js";
import { restBrowseSchema, restFindSchema } from "./contracts.js";
import { browseResultOf, findResultOf } from "./results.js";

// The sections of a search result and the outline of a file travel through the REST API as data
// (ADR-0063), and read back as the results they were made from.

function path(input: string): RepoPath {
  const result = parseRepoPath(input);
  if (!result.ok) {
    throw new Error(`invalid test path ${input}`);
  }
  return result.value;
}

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const mount: MountSummary = {
  repository: "acme/handbook",
  ref: undefined,
  commit: COMMIT,
  path: path(""),
  verified: true,
  truncated: false,
  skillUri: "skill://gh/acme/handbook",
};

describe("sections in the find body", () => {
  it("round-trips the sections of a document result", () => {
    const result: FindResult = {
      mount,
      query: "discount",
      path: path(""),
      items: [
        {
          kind: "document",
          path: path("docs/billing.md"),
          title: "Billing",
          summary: "How a workspace is charged.",
          skillDirectory: undefined,
          sections: [
            {
              heading: ["Billing", "Discounts"],
              offset: 620,
              length: 1370,
              excerpt: "Volume discounts apply from ten seats.",
            },
            { heading: [], offset: 0, length: 40, excerpt: undefined },
          ],
        },
      ],
      totals: undefined,
      diagnostics: [],
      nextCursor: undefined,
    };
    const body = findBody({ status: "ready", result });
    expect(restFindSchema.parse(body)).toEqual(body);
    if (body.status !== "ready") throw new Error("not ready");
    const item = body.items[0];
    if (item?.kind !== "document") throw new Error("not a document");
    expect(item.sections?.[1]?.excerpt).toBeNull();
    expect(findResultOf(body, mount)).toEqual(result);
  });

  it("leaves a result without sections as it was", () => {
    const earlier = restFindSchema.parse({
      status: "ready",
      query: "x",
      items: [
        { kind: "document", path: "docs/a.md", title: null, summary: null, skillDirectory: null },
      ],
      totals: null,
    });
    if (earlier.status !== "ready") throw new Error("not ready");
    const item = findResultOf(earlier, mount).items[0];
    expect(item?.kind === "document" && "sections" in item).toBe(false);
  });
});

describe("the outline in the browse body", () => {
  it("round-trips the outline of a file, with the reason there is none", () => {
    const result: BrowseResult = {
      mount,
      path: path("docs/billing.md"),
      entries: [],
      nextCursor: "more",
      diagnostics: [],
      outline: {
        path: path("docs/billing.md"),
        size: 2048,
        totalLength: 1990,
        headings: [
          { level: 1, text: "Billing", offset: 0, length: 120 },
          { level: 2, text: "", offset: 120, length: 1870 },
        ],
        truncated: true,
      },
    };
    const body = browseBody({ status: "ready", result });
    expect(restBrowseSchema.parse(body)).toEqual(body);
    if (body.status !== "ready") throw new Error("not ready");
    expect(body.outline?.totalLength).toBe(1990);
    expect(browseResultOf(body, mount)).toEqual(result);

    const described: BrowseResult = {
      ...result,
      nextCursor: undefined,
      outline: {
        path: path("docs/billing.md"),
        size: 2048,
        totalLength: undefined,
        headings: [],
        truncated: false,
        unavailable: "described_only",
        license: { kind: "restrictive", name: "CC-BY-NC-4.0", source: path("LICENSE") },
        sourceUrl: "https://example.test/billing.md",
      },
    };
    const refused = browseBody({ status: "ready", result: described });
    expect(restBrowseSchema.parse(refused)).toEqual(refused);
    if (refused.status !== "ready") throw new Error("not ready");
    expect(refused.outline?.totalLength).toBeNull();
    expect(browseResultOf(refused, mount)).toEqual(described);
  });

  it("drops an outline whose path is not one", () => {
    const hostile = restBrowseSchema.parse({
      status: "ready",
      commit: COMMIT,
      path: "docs",
      entries: [],
      outline: { path: "../x", size: 1, totalLength: 1, headings: [], truncated: false },
      nextCursor: null,
    });
    if (hostile.status !== "ready") throw new Error("not ready");
    expect(browseResultOf(hostile, mount)?.outline).toBeUndefined();
  });
});
