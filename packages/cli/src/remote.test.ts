import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    readonly cwd?: string;
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
    cwd: options.cwd,
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
    // And how the agents that work here learn of it: the sentence for the checkout's agreement.
    expect(bound.out).toContain("CLAUDE.md or AGENTS.md");
    expect(bound.out).toContain("**Bound to a pack?** When .skillcdn.json is in this checkout");
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
    expect(kept.out).toContain("A token is kept for every repository at https://skillcdn.example");
    expect(kept.out).not.toContain("scdn_repo_secret");
    const listed = await run(["logins"], deployment, { store });
    expect(listed.out).toBe(
      "https://skillcdn.example  every repository  since 2026-10-18T00:00:00.000Z\n",
    );
    // Without a repository to connect to, and without a token to read, there is nothing to do.
    const fromArgument = await run(["login", "--url", "https://skillcdn.example"], deployment, {
      store,
    });
    expect(fromArgument.code).toBe(EXIT_USAGE);
    expect(fromArgument.err).toContain("Say which repository to connect to");
    // A token given for one repository is kept beside the one for every repository.
    const forOne = await run(
      ["login", "--url", "https://skillcdn.example", "gh/acme/skills", "--token-stdin"],
      deployment,
      { store, stdin: "scdn_repo_one" },
    );
    expect(forOne.out).toContain("A token is kept for /gh/acme/skills at https://skillcdn.example");
    expect((await run(["logins"], deployment, { store })).out.split("\n")).toEqual([
      "https://skillcdn.example  every repository  since 2026-10-18T00:00:00.000Z",
      "https://skillcdn.example  /gh/acme/skills  since 2026-10-18T00:00:00.000Z",
      "",
    ]);
    const forgotOne = await run(
      ["logout", "--url", "https://skillcdn.example", "gh/acme/skills"],
      deployment,
      { store },
    );
    expect(forgotOne.out).toContain(
      "The token kept for /gh/acme/skills at https://skillcdn.example is forgotten",
    );
    expect((await run(["logins"], deployment, { store })).out).toBe(
      "https://skillcdn.example  every repository  since 2026-10-18T00:00:00.000Z\n",
    );
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

  it("connects with a code a person approves, and keeps the token for that repository", async () => {
    const root = await repository(PACK);
    const deployment = await deploymentOf(root);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const item = {
      id: "11111111-1111-4111-8111-111111111111",
      address: "/gh/acme/skills",
      label: "Claude Code on a laptop",
      createdAt: "2026-10-18T00:00:00.000Z",
      expiresAt: "2027-01-16T00:00:00.000Z",
      lastUsedAt: null,
    };
    let claims = 0;
    let approved = true;
    /** The deployment, connecting commands as well: pending twice, then the token. */
    const connecting: Deployment = {
      ...deployment,
      fetch: async (url, init) => {
        const { pathname } = new URL(url);
        if (pathname === "/api/v1/connect") {
          expect(init.method).toBe("POST");
          expect(JSON.parse(String(init.body))).toEqual({
            address: "/gh/acme/skills",
            agent: "Claude Code on a laptop",
          });
          return json(
            {
              code: "ABCD-EFGH",
              url: "https://skillcdn.example/connect/ABCD-EFGH",
              secret: "scdn_cx_secret",
              expiresAt: "2026-10-18T00:10:00.000Z",
              intervalSeconds: 5,
            },
            201,
          );
        }
        if (pathname === "/api/v1/connect/claim") {
          claims += 1;
          expect(JSON.parse(String(init.body))).toEqual({ secret: "scdn_cx_secret" });
          if (!approved) {
            return json({ error: { code: "connect.not_found", message: "Nothing waits." } }, 404);
          }
          return claims < 3
            ? json({ status: "pending", expiresAt: "2026-10-18T00:10:00.000Z" })
            : json({ status: "connected", token: "scdn_repo_connected", item });
        }
        return deployment.fetch(url, init);
      },
    };
    const store = createMemoryStore();
    const connected = await run(
      [
        "login",
        "--url",
        "https://skillcdn.example",
        "gh/acme/skills",
        "--agent",
        "Claude Code on a laptop",
      ],
      connecting,
      { store },
    );
    expect(connected.code).toBe(0);
    expect(connected.out).toContain("open https://skillcdn.example/connect/ABCD-EFGH signed in");
    expect(connected.out).toContain("the code ABCD-EFGH");
    expect(connected.out).toContain(
      "Connected: a token for /gh/acme/skills at https://skillcdn.example is kept",
    );
    expect(connected.out).toContain('"Claude Code on a laptop" until 2027-01-16');
    expect(connected.out).not.toContain("scdn_");
    expect(claims).toBe(3);

    // Kept for the repository: presented there, and nowhere else at the deployment.
    deployment.requests.length = 0;
    await run(["skills", "gh/acme/skills", "--url", "https://skillcdn.example"], deployment, {
      store,
    });
    expect(deployment.requests.length).toBeGreaterThan(0);
    expect(
      deployment.requests.every(
        (request) => request.authorization === "Bearer scdn_repo_connected",
      ),
    ).toBe(true);
    deployment.requests.length = 0;
    await run(["skills", "gh/acme/other", "--url", "https://skillcdn.example"], deployment, {
      store,
    });
    expect(deployment.requests.every((request) => request.authorization === undefined)).toBe(true);
    expect((await run(["logins"], deployment, { store })).out).toBe(
      "https://skillcdn.example  /gh/acme/skills  since 2026-10-18T00:00:00.000Z\n",
    );

    // The pack the directory is bound to is the repository, when none is said.
    const directory = createMemoryDirectoryStore({
      pack: "/gh/acme/skills",
      url: "https://skillcdn.example",
    });
    claims = 0;
    const again = await run(
      ["login", "--url", "https://skillcdn.example", "--agent", "Claude Code on a laptop"],
      connecting,
      { store, directory },
    );
    expect(again.code).toBe(0);

    // Declined, or not approved in time: the command says so and keeps nothing.
    approved = false;
    const declined = await run(
      [
        "login",
        "--url",
        "https://skillcdn.example",
        "gh/acme/skills",
        "--agent",
        "Claude Code on a laptop",
      ],
      connecting,
      { store: createMemoryStore() },
    );
    expect(declined.code).toBe(EXIT_MISSING);
    expect(declined.err).toContain("not approved in time, or the person said it was not theirs");

    // A deployment where nobody signs in connects no command, and says what to do instead.
    const nobody = await run(
      ["login", "--url", "https://skillcdn.example", "gh/acme/skills"],
      deployment,
      { store: createMemoryStore() },
    );
    expect(nobody.code).toBe(EXIT_MISSING);
    expect(nobody.err).toContain("connects no command");
    expect(nobody.err).toContain("--token-stdin");
  });

  it("binds a directory on this machine, and reads it with no deployment and no token", async () => {
    const root = await repository(PACK, "acme");
    const deployment = await deploymentOf(root);
    const directory = createMemoryDirectoryStore();
    const cwd = dirname(root);
    const bound = await run(["use", "acme"], deployment, { directory, cwd });
    expect(bound.code).toBe(0);
    expect(bound.out).toMatch(
      /This directory reads \/local\/[^/]+\/acme from acme, on this machine/,
    );
    expect(bound.out).toContain("**Bound to a pack?**");
    const read = await run(["skills"], deployment, { directory, cwd });
    expect(read.code).toBe(0);
    expect(read.out).toContain("marketing/ads/SKILL.md");
    expect(deployment.requests).toEqual([]);
    const status = await run(["status"], deployment, { directory, cwd });
    expect(status.code).toBe(0);
    expect(status.out).toContain("a directory on this machine: no deployment and no token");
    expect(status.out).toContain("Next: skillcdn skills.");
    // A directory that is not there, and a deployment named for one.
    expect((await run(["use", "./nowhere"], deployment, { directory, cwd })).code).toBe(
      EXIT_UNREADABLE,
    );
    expect(
      (
        await run(["use", "acme", "--url", "https://skillcdn.example"], deployment, {
          directory,
          cwd,
        })
      ).code,
    ).toBe(EXIT_USAGE);
  });

  it("says what this directory reads, and whether a token is kept for it", async () => {
    const root = await repository(PACK);
    const deployment = await deploymentOf(root);
    const unbound = await run(["status"], deployment);
    expect(unbound.code).toBe(0);
    expect(unbound.out).toContain("bound to no pack");
    expect(unbound.out).toContain("Next: skillcdn skills <pack>.");
    const directory = createMemoryDirectoryStore({
      pack: "/gh/acme/skills",
      url: "https://skillcdn.example",
    });
    const none = await run(["status"], deployment, { directory });
    expect(none.out).toContain("This directory reads /gh/acme/skills at https://skillcdn.example");
    expect(none.out).toContain("No token is kept for it");
    expect(none.out).toContain("skillcdn login --url https://skillcdn.example");
    const store = createMemoryStore({
      logins: [
        {
          url: "https://skillcdn.example",
          repository: "/gh/acme/skills",
          token: "scdn_repo_kept",
          since: "2026-10-18T00:00:00.000Z",
        },
      ],
    });
    const kept = await run(["status"], deployment, { directory, store });
    expect(kept.out).toContain("A token is kept for it, since 2026-10-18T00:00:00.000Z");
    expect(kept.out).not.toContain("scdn_repo_kept");
    expect(deployment.requests).toEqual([]);
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
