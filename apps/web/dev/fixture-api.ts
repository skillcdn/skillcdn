import {
  type Address,
  formatAddress,
  isPinnedAddress,
  parseAddress,
  REST_FEATURED_SKILL_NAMES,
  REST_MOUNT_LIST_LIMIT,
  REST_ROUTES,
  type RestFeatured,
  type RestFile,
  type RestFind,
  type RestFindItem,
  type RestMount,
  type RestSkill,
} from "@skillcdn/core";
import {
  FIXTURE_FAILURES,
  FIXTURE_FEATURED,
  FIXTURE_REPOSITORIES,
  type FixtureRepository,
  summaryOf,
} from "./fixtures.js";

// The REST API of docs/specs/rest.md, answered from fixtures. The development server of the web
// UI mounts it, so the UI runs without a server, a database or a network. It follows the spec
// closely enough to design against; the real thing is apps/server.

export interface FixtureAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** How long `demo/slow` stays "indexing" after it was first asked for. */
const SLOW_INDEXING_MS = 5000;
const PAGE_LIMIT = 40_000;

const firstAsked = new Map<string, number>();

/** Forgets when `demo/slow` was first asked for, so that it starts indexing again. */
export function resetFixtureState(): void {
  firstAsked.clear();
}

const problem = (status: number, code: string, message: string, extra = {}): FixtureAnswer => ({
  status,
  body: { error: { code, message, ...extra } },
});

/** A path of the repository as seen from the mounted directory; `undefined` outside of it. */
function below(mountPath: string, path: string): string | undefined {
  if (mountPath === "") {
    return path;
  }
  if (path === mountPath) {
    return "";
  }
  return path.startsWith(`${mountPath}/`) ? path.slice(mountPath.length + 1) : undefined;
}

function stateOf(
  key: string,
  repository: FixtureRepository,
  now: number,
): "ready" | "indexing" | "failed" {
  if (repository.state === "slow") {
    const since = firstAsked.get(key) ?? now;
    firstAsked.set(key, since);
    return now - since < SLOW_INDEXING_MS ? "indexing" : "ready";
  }
  return repository.state;
}

function resolve(
  address: Address,
): { readonly key: string; readonly repository: FixtureRepository } | FixtureAnswer {
  const key = `${address.owner}/${address.repo}`;
  const failure = FIXTURE_FAILURES[key];
  if (failure !== undefined) {
    return problem(failure.status, failure.code, failure.message);
  }
  const repository = FIXTURE_REPOSITORIES[key];
  if (repository === undefined) {
    return problem(404, "mount.repo_not_found", "The repository was not found.");
  }
  if (address.ref?.kind === "name" && address.ref.name.startsWith("missing")) {
    return problem(404, "mount.ref_not_found", "The ref was not found in this repository.");
  }
  return { key, repository };
}

function mountBody(
  address: Address,
  key: string,
  repository: FixtureRepository,
  now: number,
): RestMount {
  const state = stateOf(key, repository, now);
  const skills = repository.skills.flatMap((detail) => {
    const directory = below(address.path, detail.directory);
    return directory === undefined ? [] : [{ ...summaryOf(detail), directory }];
  });
  const documents = repository.documents.flatMap((document) => {
    const path = below(address.path, document.path);
    return path === undefined || path === "" ? [] : [{ ...document, path }];
  });
  const ref = address.ref;
  return {
    address: formatAddress(address),
    repository: {
      host: address.host,
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
      description: repository.description ?? null,
    },
    ref: ref === undefined ? null : ref.kind === "commit" ? ref.hash : ref.name,
    pinned: isPinnedAddress(address),
    commit: ref?.kind === "commit" ? ref.hash : repository.commit,
    path: address.path,
    verified: false,
    index:
      state === "indexing"
        ? { status: "indexing" }
        : state === "failed"
          ? { status: "failed", errorCode: "git_host.transient" }
          : {
              status: "ready",
              truncated: repository.truncated === true,
              skillCount: skills.length,
              documentCount: documents.length,
              skills: skills.slice(0, REST_MOUNT_LIST_LIMIT),
              documents: documents.slice(0, REST_MOUNT_LIST_LIMIT),
              diagnostics: [...repository.diagnostics],
            },
  };
}

function findBody(
  address: Address,
  repository: FixtureRepository,
  params: URLSearchParams,
): RestFind {
  const query = params.get("query")?.trim() ?? "";
  const limit = Number(params.get("limit") ?? "10");
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const matches = (text: string) =>
    words.length === 0 || words.some((word) => text.toLowerCase().includes(word));

  const items: RestFindItem[] = [];
  for (const detail of repository.skills) {
    const directory = below(address.path, detail.directory);
    if (directory !== undefined && matches(`${detail.name} ${detail.description} ${detail.body}`)) {
      items.push({ kind: "skill", name: detail.name, directory, description: detail.description });
    }
  }
  for (const document of repository.documents) {
    const path = below(address.path, document.path);
    const text = `${document.path} ${document.title ?? ""} ${document.summary ?? ""}`;
    if (path !== undefined && path !== "" && matches(text)) {
      items.push({ kind: "document", path, title: document.title, summary: document.summary });
    }
  }
  return { status: "ready", query: query === "" ? null : query, items: items.slice(0, limit) };
}

function skillAnswer(
  address: Address,
  repository: FixtureRepository,
  wanted: string,
): FixtureAnswer {
  const inMount = repository.skills.flatMap((detail) => {
    const directory = below(address.path, detail.directory);
    return directory === undefined ? [] : [{ detail, directory }];
  });
  const byDirectory = inMount.filter((entry) => entry.directory === wanted);
  const matches =
    byDirectory.length > 0 ? byDirectory : inMount.filter((entry) => entry.detail.name === wanted);
  const [match, ...others] = matches;
  if (match === undefined) {
    return problem(404, "skill.not_found", "No skill by that name in this mount.");
  }
  if (others.length > 0) {
    return problem(409, "skill.ambiguous", "Several skills share that name. Ask for a directory.", {
      directories: matches.map((entry) => entry.directory),
    });
  }
  const body: RestSkill = {
    status: "ready",
    skill: {
      ...match.detail,
      directory: match.directory,
      files: match.detail.files.flatMap((file) => below(address.path, file) ?? []),
    },
  };
  return { status: 200, body };
}

function fileAnswer(
  address: Address,
  repository: FixtureRepository,
  params: URLSearchParams,
): FixtureAnswer {
  const path = params.get("path");
  if (path === null || path === "" || path.split("/").includes("..")) {
    return problem(400, "request.invalid", "Missing or malformed query parameters: path.");
  }
  const absolute = address.path === "" ? path : `${address.path}/${path}`;
  const unreadable = repository.unreadable?.[absolute];
  if (unreadable === "file.too_large") {
    return problem(
      413,
      unreadable,
      "The file is too large to read (5242880 bytes; the limit is 1048576).",
    );
  }
  if (unreadable === "file.not_text") {
    return problem(415, unreadable, "The file is not UTF-8 text.");
  }
  const content = repository.files[absolute];
  if (content === undefined) {
    return problem(404, "file.not_found", "No file at that path in this mount.");
  }
  const offset = Number(params.get("offset") ?? "0");
  const end = Math.min(offset + PAGE_LIMIT, content.length);
  const body: RestFile = {
    path,
    content: content.slice(offset, end),
    offset,
    nextOffset: end < content.length ? end : null,
    totalLength: content.length,
  };
  return { status: 200, body };
}

function featuredBody(now: number): RestFeatured {
  return {
    items: FIXTURE_FEATURED.flatMap((key) => {
      const repository = FIXTURE_REPOSITORIES[key];
      if (repository === undefined) {
        return [];
      }
      const status = stateOf(key, repository, now);
      return [
        {
          address: `/gh/${key}`,
          repository: {
            host: "gh" as const,
            owner: repository.owner,
            name: repository.name,
            defaultBranch: repository.defaultBranch,
            description: repository.description ?? null,
          },
          status,
          skillCount: status === "ready" ? repository.skills.length : null,
          skills:
            status === "ready"
              ? repository.skills.slice(0, REST_FEATURED_SKILL_NAMES).map((detail) => detail.name)
              : [],
        },
      ];
    }),
  };
}

/** Answers a REST request from fixtures. `undefined` when the URL is not part of the REST API. */
export function handleFixtureRequest(
  url: URL,
  now: number = Date.now(),
): FixtureAnswer | undefined {
  if (url.pathname === REST_ROUTES.featured) {
    return { status: 200, body: featuredBody(now) };
  }
  const operation = (["mounts", "find", "skills", "files"] as const).find((name) =>
    url.pathname.startsWith(`${REST_ROUTES[name]}/`),
  );
  if (operation === undefined) {
    return url.pathname.startsWith("/api/")
      ? problem(404, "not_found", "There is nothing at this path.")
      : undefined;
  }

  const parsed = parseAddress(url.pathname.slice(REST_ROUTES[operation].length));
  if (!parsed.ok) {
    return problem(400, `address.${parsed.error.code}`, parsed.error.message);
  }
  const address = parsed.value;
  const resolved = resolve(address);
  if ("status" in resolved) {
    return resolved;
  }
  const { key, repository } = resolved;

  if (operation === "mounts") {
    return { status: 200, body: mountBody(address, key, repository, now) };
  }
  if (operation === "files") {
    return fileAnswer(address, repository, url.searchParams);
  }
  const state = stateOf(key, repository, now);
  if (state !== "ready") {
    return {
      status: 200,
      body:
        state === "indexing"
          ? { status: "indexing" }
          : { status: "failed", errorCode: "git_host.transient" },
    };
  }
  if (operation === "find") {
    return { status: 200, body: findBody(address, repository, url.searchParams) };
  }
  const name = url.searchParams.get("name");
  return name === null || name === ""
    ? problem(400, "request.invalid", "Missing or malformed query parameters: name.")
    : skillAnswer(address, repository, name);
}
