import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchLike } from "@skillcdn/client";
import { restMountSchema } from "@skillcdn/core";
import { INDEX_LIMIT_DEFAULTS } from "@skillcdn/indexer";
import { describe, expect, it } from "vitest";
import { DEFAULT_ORIGIN, EXIT_MISSING, EXIT_UNREADABLE, EXIT_USAGE, runCli } from "./cli.js";
import { createMemoryStore } from "./credentials.js";
import { createMemoryDirectoryStore } from "./directory.js";
import { openDirectory } from "./local.js";
import { type Pack, PackError } from "./pack.js";

// A deployment, as far as the command can tell: a fake fetch that answers the REST routes of
// an address from a pack read on this machine, in the API's own shapes. The command's reads of
// a deployment are then held against its reads of the directory.

async function repository(files: Record<string, string>, name = "skills"): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "skillcdn-remote-"));
  const root = join(parent, name);
  for (const [file, contents] of Object.entries(files)) {
    const parts = file.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), contents);
  }
  return root;
}

const PACK: Record<string, string> = {
  "SKILLCDN.md": "---\nname: Acme skills\ndescription: The skills of Acme.\n---\nBe brief.\n",
  "marketing/ads/SKILL.md":
    "---\nname: ads\ndescription: Writes ad copy for a product page.\n---\n# Ads\n\nWrite three variants.\n",
  "docs/guide.md": "# Guide\n\nHow the skills are used.\n",
};

interface Deployment {
  readonly fetch: FetchLike;
  readonly requests: { readonly url: string; readonly authorization: string | undefined }[];
  /** How many times the index was asked for before it was ready. */
  indexing: number;
}

/** A deployment that serves `root` at `/gh/acme/skills`, indexing it for the first `indexing` looks. */
async function deploymentOf(root: string, indexing = 0): Promise<Deployment> {
  const opened = await openDirectory({
    directory: root,
    as: "local/acme/skills",
    limits: INDEX_LIMIT_DEFAULTS,
  });
  if ("error" in opened) throw new Error(opened.error);
  const pack: Pack = opened;
  const state: Deployment = {
    requests: [],
    indexing,
    fetch: async (url, init) => {
      const headers = init.headers as Record<string, string>;
      state.requests.push({ url, authorization: headers.authorization });
      const parsed = new URL(url);
      const match = /^\/api\/v1\/(mounts|browse|find|skills|files)\/gh\/acme\/skills$/.exec(
        parsed.pathname,
      );
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (match === null) {
        return json({ error: { code: "mount.repo_not_found", message: "not found" } }, 404);
      }
      const q = parsed.searchParams;
      const number = (name: string) => (q.get(name) === null ? undefined : Number(q.get(name)));
      try {
        switch (match[1]) {
          case "mounts": {
            const mount = await pack.mount();
            // As the deployment names it: the address of the repository at the host.
            const named = {
              ...mount,
              address: "/gh/acme/skills",
              repository: { ...mount.repository, host: "gh", owner: "acme", name: "skills" },
            };
            if (state.indexing > 0) {
              state.indexing -= 1;
              return json({ ...named, index: { status: "indexing" } });
            }
            return json(named);
          }
          case "browse":
            return json(
              await pack.browse({
                path: q.get("path") ?? undefined,
                cursor: q.get("cursor") ?? undefined,
                limit: number("limit"),
              }),
            );
          case "find":
            return json(
              await pack.find({
                query: q.get("query") ?? undefined,
                path: q.get("path") ?? undefined,
                cursor: q.get("cursor") ?? undefined,
                limit: number("limit"),
              }),
            );
          case "skills":
            return json(await pack.skill(q.get("path") ?? "", q.get("cursor") ?? undefined));
          case "files":
            return json(
              await pack.file({
                path: q.get("path") ?? "",
                offset: number("offset"),
                limit: number("limit"),
              }),
            );
          default:
            return json({ error: { code: "internal", message: "no" } }, 500);
        }
      } catch (error) {
        if (error instanceof PackError) {
          return json(
            {
              error: {
                code: error.code,
                message: error.message,
                ...(error.sourceUrl === undefined ? {} : { sourceUrl: error.sourceUrl }),
              },
            },
            error.status,
          );
        }
        throw error;
      }
    },
  };
  return state;
}

async function run(
  args: string[],
  deployment: Deployment,
  options: {
    readonly environment?: Record<string, string | undefined>;
    readonly store?: ReturnType<typeof createMemoryStore>;
    readonly directory?: ReturnType<typeof createMemoryDirectoryStore>;
    readonly stdin?: string;
  } = {},
) {
  let out = "";
  let err = "";
  const code = await runCli(args, {
    environment: options.environment ?? {},
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    fetch: deployment.fetch,
    store: options.store,
    directory: options.directory,
    sleep: async () => undefined,
    readStdin: async () => options.stdin ?? "",
    now: () => new Date("2026-10-18T00:00:00Z"),
    userAgent: "skillcdn-cli/test",
  });
  return { code, out, err };
}

/** The words of a read with the source line left out, which names where the pack is. */
const withoutSource = (text: string): string =>
  text.replaceAll(/^Source: .*$/gm, "Source: (elsewhere)");

describe("a pack at a deployment", () => {
  it("reads the same words as from the directory it was read from", async () => {
    const root = await repository(PACK);
    const deployment = await deploymentOf(root);
    const local = await run(
      ["skill", root, "marketing/ads/SKILL.md", "--as", "local/acme/skills"],
      deployment,
    );
    const remote = await run(
      ["skill", "gh/acme/skills", "marketing/ads/SKILL.md", "--url", "https://skillcdn.example"],
      deployment,
    );
    expect(remote.err).toBe("");
    expect(remote.code).toBe(0);
    expect(withoutSource(remote.out)).toBe(withoutSource(local.out));
    expect(remote.out).toContain("Source: acme/skills (commit 0000000)");
    const browsed = await run(
      ["browse", "gh/acme/skills", "--url", "https://skillcdn.example"],
      deployment,
    );
    const listed = await run(["skills", "https://skillcdn.example/gh/acme/skills"], deployment);
    const found = await run(
      ["find", "gh/acme/skills", "ad", "copy", "--url", "https://skillcdn.example"],
      deployment,
    );
    const read = await run(
      ["file", "gh/acme/skills", "docs/guide.md", "--url", "https://skillcdn.example"],
      deployment,
    );
    expect(browsed.out).toContain("- directory: marketing; 1 skill");
    expect(listed.out).toContain("Acme skills: The skills of Acme.");
    expect(listed.out).toContain("skill: ads (marketing/ads/SKILL.md)");
    expect(found.out).toContain("1. skill: ads (marketing/ads/SKILL.md)");
    expect(read.out).toContain("--- content ---\n# Guide");
    const byUri = await run(
      [
        "skill",
        "skill://gh/acme/skills/marketing/ads/SKILL.md",
        "--url",
        "https://skillcdn.example",
      ],
      deployment,
    );
    expect(withoutSource(byUri.out)).toBe(withoutSource(local.out));
  });

  it("waits while the deployment indexes a commit it sees for the first time", async () => {
    const root = await repository(PACK);
    const deployment = await deploymentOf(root, 2);
    const { code, out } = await run(
      ["skills", "gh/acme/skills", "--url", "https://skillcdn.example", "--json"],
      deployment,
    );
    expect(code).toBe(0);
    const mount = restMountSchema.parse(JSON.parse(out));
    expect(mount.index.status).toBe("ready");
    expect(deployment.requests.filter((request) => request.url.includes("/mounts/")).length).toBe(
      3,
    );
  });

  it("presents the token kept for the deployment, and no other", async () => {
    const root = await repository(PACK);
    const deployment = await deploymentOf(root);
    const store = createMemoryStore({
      logins: [
        { url: "https://skillcdn.example", token: "scdn_repo_kept", since: undefined },
        { url: "https://other.example", token: "scdn_repo_other", since: undefined },
      ],
    });
    await run(["skills", "gh/acme/skills", "--url", "https://skillcdn.example"], deployment, {
      store,
    });
    expect(
      deployment.requests.every((request) => request.authorization === "Bearer scdn_repo_kept"),
    ).toBe(true);
    deployment.requests.length = 0;
    await run(["skills", "gh/acme/skills", "--url", "https://skillcdn.example"], deployment, {
      store,
      environment: { SKILLCDN_URL: "https://skillcdn.example", SKILLCDN_TOKEN: "scdn_repo_env" },
    });
    expect(
      deployment.requests.every((request) => request.authorization === "Bearer scdn_repo_env"),
    ).toBe(true);
    deployment.requests.length = 0;
    await run(["skills", "gh/acme/skills", "--url", "https://skillcdn.example"], deployment, {
      store,
      environment: { SKILLCDN_URL: "https://elsewhere.example", SKILLCDN_TOKEN: "scdn_repo_env" },
    });
    // The environment's pair is for another deployment: the login kept for this one is sent.
    expect(
      deployment.requests.every((request) => request.authorization === "Bearer scdn_repo_kept"),
    ).toBe(true);
    const half = await run(["skills", "gh/acme/skills"], deployment, {
      environment: { SKILLCDN_TOKEN: "scdn_repo_env" },
    });
    expect(half.code).toBe(EXIT_USAGE);
    expect(half.err).toContain("taken together or not at all");
    expect(half.err).not.toContain("scdn_repo_env");
  });

  it("reads the pack the directory is bound to, where it is bound to", async () => {
    const root = await repository(PACK);
    const deployment = await deploymentOf(root);
    const directory = createMemoryDirectoryStore();
    const bound = await run(
      ["use", "gh/acme/skills", "--url", "https://skillcdn.example"],
      deployment,
      {
        directory,
      },
    );
    expect(bound.code).toBe(0);
    expect(bound.out).toContain("This directory reads /gh/acme/skills at https://skillcdn.example");
    const { code, out } = await run(["skill", "marketing/ads/SKILL.md"], deployment, { directory });
    expect(code).toBe(0);
    expect(out).toContain("Skill: ads");
    expect(deployment.requests[0]?.url.startsWith("https://skillcdn.example/")).toBe(true);
    const nowhere = await run(["skills"], deployment);
    expect(nowhere.code).toBe(EXIT_USAGE);
    expect(nowhere.err).toContain("skillcdn use <address>");
    const wrong = await run(["use", "local/packs/acme"], deployment, { directory });
    expect(wrong.code).toBe(EXIT_USAGE);
  });

  it("keeps a token read from standard input, names the deployments, and forgets one", async () => {
    const root = await repository(PACK);
    const deployment = await deploymentOf(root);
    const store = createMemoryStore();
    const kept = await run(
      ["login", "--url", "https://skillcdn.example", "--token-stdin"],
      deployment,
      {
        store,
        stdin: "scdn_repo_secret\n",
      },
    );
    expect(kept.code).toBe(0);
    expect(kept.out).toContain("A token is kept for https://skillcdn.example");
    expect(kept.out).not.toContain("scdn_repo_secret");
    const listed = await run(["logins"], deployment, { store });
    expect(listed.out).toBe("https://skillcdn.example  since 2026-10-18T00:00:00.000Z\n");
    const fromArgument = await run(["login", "--url", "https://skillcdn.example"], deployment, {
      store,
    });
    expect(fromArgument.code).toBe(EXIT_USAGE);
    const insecure = await run(
      ["login", "--url", "http://skillcdn.example", "--token-stdin"],
      deployment,
      {
        store,
        stdin: "x",
      },
    );
    expect(insecure.code).toBe(EXIT_USAGE);
    const forgotten = await run(["logout", "--url", "https://skillcdn.example"], deployment, {
      store,
    });
    expect(forgotten.out).toContain("is forgotten here");
    expect((await run(["logins"], deployment, { store })).out).toBe(
      "No token is kept for any deployment.\n",
    );
  });

  it("says what the deployment refuses, and when it cannot be reached", async () => {
    const root = await repository(PACK);
    const deployment = await deploymentOf(root);
    const missing = await run(
      ["skills", "gh/acme/other", "--url", "https://skillcdn.example"],
      deployment,
    );
    expect(missing.code).toBe(EXIT_MISSING);
    expect(missing.err).toContain("mount.repo_not_found");
    const noSkill = await run(
      ["skill", "gh/acme/skills", "marketing/SKILL.md", "--url", "https://skillcdn.example"],
      deployment,
    );
    expect(noSkill.code).toBe(EXIT_MISSING);
    expect(noSkill.err).toContain("skill.not_found");
    const down: Deployment = {
      requests: [],
      indexing: 0,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    };
    const unreachable = await run(["skills", "gh/acme/skills"], down);
    expect(unreachable.code).toBe(EXIT_UNREADABLE);
    expect(unreachable.err).toContain("network");
    expect(DEFAULT_ORIGIN).toBe("https://skillcdn.ai");
  });
});
