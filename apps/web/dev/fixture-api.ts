import {
  type Address,
  formatAddress,
  isPinnedAddress,
  parseAddress,
  REST_FEATURED_SKILL_NAMES,
  REST_MOUNT_LIST_LIMIT,
  REST_ROUTES,
  type RestBrowse,
  type RestBrowseEntry,
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
    return directory === undefined ? [] : [summaryOf(detail)];
  });
  const documents = repository.documents.flatMap((document) => {
    const path = below(address.path, document.path);
    return path === undefined ||
      path === "" ||
      skillOwning(address, repository, document.path) !== null
      ? []
      : [document];
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
              manifest:
                repository.manifest === undefined
                  ? null
                  : {
                      // Above the mount when a sub-path is mounted, as the server would say.
                      path: repository.manifest.path,
                      name: repository.manifest.name,
                      description: repository.manifest.description,
                      language: repository.manifest.language ?? null,
                      translations: repository.manifest.translations ?? {},
                    },
              groups: browseEntries(address, repository, address.path).filter(
                (entry) => entry.kind === "directory",
              ),
              skillCount: skills.length,
              documentCount: documents.length,
              skills: skills.slice(0, REST_MOUNT_LIST_LIMIT),
              documents: documents.slice(0, REST_MOUNT_LIST_LIMIT),
              diagnostics: [...repository.diagnostics],
            },
  };
}

/** The repository-root directory of the skill a file belongs to; `null` when none does. */
function skillOwning(address: Address, repository: FixtureRepository, path: string): string | null {
  const owner = repository.skills.find(
    (detail) => detail.directory !== "" && path.startsWith(`${detail.directory}/`),
  );
  const directory = owner === undefined ? undefined : below(address.path, owner.directory);
  return directory === undefined ? null : (owner?.directory ?? null);
}

function findBody(
  address: Address,
  repository: FixtureRepository,
  params: URLSearchParams,
): RestFind {
  const query = params.get("query")?.trim() ?? "";
  const limit = Number(params.get("limit") ?? "10");
  const scope = params.get("path") ?? address.path;
  const offset = Number(params.get("cursor") ?? "0");
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const matches = (text: string) =>
    words.length === 0 || words.some((word) => text.toLowerCase().includes(word));

  type SkillItem = Extract<RestFindItem, { kind: "skill" }>;
  const skills: SkillItem[] = [];
  for (const detail of repository.skills) {
    const directory = below(scope, detail.directory);
    if (directory !== undefined && matches(`${detail.name} ${detail.description} ${detail.body}`)) {
      skills.push({
        kind: "skill",
        name: detail.name,
        directory: detail.directory,
        description: detail.description,
        translations: detail.translations,
        files: [],
        moreFiles: 0,
      });
    }
  }
  const documents: RestFindItem[] = [];
  for (const document of repository.documents) {
    const path = below(scope, document.path);
    const text = `${document.path} ${document.title ?? ""} ${document.summary ?? ""}`;
    const owner = skillOwning(address, repository, document.path);
    // A listing leaves a skill's own files to the skill; a search folds them under the skill.
    if (path === undefined || path === "" || !matches(text)) {
      continue;
    }
    const skill = owner === null ? undefined : skills.find((item) => item.directory === owner);
    if (skill !== undefined && words.length > 0) {
      skills[skills.indexOf(skill)] = {
        ...skill,
        files: [
          ...skill.files,
          { path: document.path, title: document.title, summary: document.summary },
        ],
      };
    } else if (words.length > 0 || owner === null) {
      documents.push({
        kind: "document",
        path: document.path,
        title: document.title,
        summary: document.summary,
        skillDirectory: owner,
      });
    }
  }
  const items = [...skills, ...documents];
  return {
    status: "ready",
    commit: repository.commit,
    path: scope,
    query: query === "" ? null : query,
    items: items.slice(offset, offset + limit),
    nextCursor: offset + limit < items.length ? String(offset + limit) : null,
    totals: words.length === 0 ? { skills: skills.length, documents: documents.length } : null,
  };
}

function browseEntries(
  address: Address,
  repository: FixtureRepository,
  path: string,
): RestBrowseEntry[] {
  const entries = new Map<string, RestBrowseEntry>();
  const prefix = path === "" ? "" : `${path}/`;
  const files = new Set([
    ...Object.keys(repository.files),
    ...repository.documents.map((document) => document.path),
    ...repository.skills.map(
      (detail) =>
        detail.path ?? (detail.directory === "" ? "SKILL.md" : `${detail.directory}/SKILL.md`),
    ),
  ]);
  for (const file of files) {
    if (!file.startsWith(prefix) || below(address.path, file) === undefined) continue;
    const relative = file.slice(prefix.length);
    const slash = relative.indexOf("/");
    const childPath = slash < 0 ? file : `${prefix}${relative.slice(0, slash)}`;
    const detail = repository.skills.find(
      (skill) => `${skill.directory === "" ? "" : `${skill.directory}/`}SKILL.md` === file,
    );
    const directSkill = repository.skills.find((skill) => skill.directory === childPath);
    const skill = slash < 0 ? detail : directSkill;
    const entryPath =
      skill === undefined
        ? childPath
        : `${skill.directory === "" ? "" : `${skill.directory}/`}SKILL.md`;
    const group = repository.groups?.[childPath];
    const document = repository.documents.find((item) => item.path === file);
    entries.set(entryPath, {
      kind: skill !== undefined ? "skill" : slash < 0 ? "file" : "directory",
      path: entryPath,
      name: skill?.name ?? group?.name ?? (slash < 0 ? document?.title : null) ?? null,
      description:
        skill?.description ?? group?.description ?? (slash < 0 ? document?.summary : null) ?? null,
      skillCount:
        skill !== undefined
          ? 1
          : repository.skills.filter((item) => below(childPath, item.directory) !== undefined)
              .length,
      documentCount:
        slash < 0
          ? 0
          : repository.documents.filter(
              (item) =>
                below(childPath, item.path) !== undefined &&
                skillOwning(address, repository, item.path) === null,
            ).length,
      size: slash < 0 ? (repository.files[file]?.length ?? null) : null,
      manifestPath: group === undefined ? null : `${childPath}/SKILLCDN.md`,
      language: group?.language ?? repository.manifest?.language ?? null,
    });
  }
  return [...entries.values()].sort(
    (a, b) =>
      Number(a.kind !== "directory") - Number(b.kind !== "directory") ||
      a.path.localeCompare(b.path),
  );
}

function browseBody(
  address: Address,
  repository: FixtureRepository,
  params: URLSearchParams,
): RestBrowse {
  const path = params.get("path") ?? address.path;
  const offset = Number(params.get("cursor") ?? "0");
  const limit = Number(params.get("limit") ?? "40");
  const entries = browseEntries(address, repository, path);
  return {
    status: "ready",
    commit: repository.commit,
    path,
    entries: entries.slice(offset, offset + limit),
    nextCursor: offset + limit < entries.length ? String(offset + limit) : null,
  };
}

function skillAnswer(
  address: Address,
  repository: FixtureRepository,
  wanted: string,
  cursor: string | null = null,
): FixtureAnswer {
  const inMount = repository.skills.flatMap((detail) => {
    const directory = below(address.path, detail.directory);
    return directory === undefined ? [] : [{ detail, directory: detail.directory }];
  });
  const byDirectory = inMount.filter(
    (entry) => entry.directory === wanted || entry.detail.path === wanted,
  );
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
      files: match.detail.files.filter((file) => below(address.path, file) !== undefined),
      included: match.detail.included.filter((file) => below(address.path, file) !== undefined),
      ruleChain: [
        ...(repository.manifest === undefined
          ? []
          : [
              { path: repository.manifest.path, body: repository.manifest.rules, truncated: false },
            ]),
        ...Object.entries(repository.groups ?? {})
          .filter(([path]) => below(path, match.directory) !== undefined)
          .map(([path, group]) => ({
            path: `${path}/SKILLCDN.md`,
            body: group.rules,
            truncated: false,
          })),
      ],
      includedContents: match.detail.included.map((path) => ({
        path,
        content: repository.files[path] ?? null,
        truncated: false,
      })),
      rules:
        repository.manifest === undefined || repository.manifest.rules.length === 0
          ? null
          : {
              path: repository.manifest.path,
              body: repository.manifest.rules,
              truncated: false,
            },
    },
  };
  const offset = Number(cursor ?? "0");
  let position = 0;
  const take = (text: string): string => {
    const start = Math.max(0, offset - position);
    const end = Math.max(0, offset + PAGE_LIMIT - position);
    position += text.length;
    return text.slice(start, end);
  };
  const ruleChain = (body.skill.ruleChain ?? []).flatMap((rule) => {
    const fragment = take(rule.body);
    return fragment === ""
      ? []
      : [{ ...rule, body: fragment, truncated: fragment.length < rule.body.length }];
  });
  const instructions = take(body.skill.body);
  const includedContents = (body.skill.includedContents ?? []).flatMap((file) => {
    if (file.content === null) return [file];
    const fragment = take(file.content);
    return fragment === ""
      ? []
      : [{ ...file, content: fragment, truncated: fragment.length < file.content.length }];
  });
  const complete = offset + PAGE_LIMIT >= position;
  return {
    status: 200,
    body: {
      ...body,
      skill: {
        ...body.skill,
        ruleChain,
        body: instructions,
        includedContents,
        complete,
        nextCursor: complete ? null : String(offset + PAGE_LIMIT),
      },
    },
  };
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
  const isRoot = path === "." || path === "/";
  const absolute = isRoot ? address.path : path;
  if (below(address.path, absolute) === undefined)
    return problem(404, "file.not_found", "No file at that path in this mount.");
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
  const content = isRoot ? undefined : repository.files[absolute];
  if (content === undefined) {
    // A directory answers with what it contains, subdirectories first.
    const prefix = absolute === "" ? "" : `${absolute}/`;
    const children = new Map<string, { kind: "file" | "directory"; size: number | null }>();
    for (const [file, text] of Object.entries(repository.files)) {
      if (!file.startsWith(prefix)) {
        continue;
      }
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf("/");
      const name = slash < 0 ? rest : rest.slice(0, slash);
      if (!children.has(name)) {
        children.set(name, {
          kind: slash < 0 ? "file" : "directory",
          size: slash < 0 ? text.length : null,
        });
      }
    }
    if (children.size === 0) {
      return problem(404, "file.not_found", "No file at that path in this mount.");
    }
    const entries = [...children]
      .sort(
        ([a, x], [b, y]) =>
          Number(x.kind === "file") - Number(y.kind === "file") || (a < b ? -1 : 1),
      )
      .map(([name, child]) => ({
        path: isRoot ? name : `${path}/${name}`,
        kind: child.kind,
        size: child.size,
      }));
    const body: RestFile = {
      kind: "directory",
      path: isRoot ? "" : path,
      entries,
      truncated: false,
    };
    return { status: 200, body };
  }
  const offset = Number(params.get("offset") ?? "0");
  const end = Math.min(offset + PAGE_LIMIT, content.length);
  const body: RestFile = {
    kind: "file",
    path,
    references: [],
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
          manifest:
            status === "ready" && repository.manifest !== undefined
              ? {
                  name: repository.manifest.name,
                  description: repository.manifest.description,
                  translations: repository.manifest.translations ?? {},
                }
              : null,
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
  const operation = (["mounts", "browse", "find", "skills", "files"] as const).find((name) =>
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
  if (operation === "browse") {
    return { status: 200, body: browseBody(address, repository, url.searchParams) };
  }
  if (operation === "find") {
    return { status: 200, body: findBody(address, repository, url.searchParams) };
  }
  const name = url.searchParams.get("path") ?? url.searchParams.get("name");
  return name === null || name === ""
    ? problem(400, "request.invalid", "Missing or malformed query parameters: name.")
    : skillAnswer(address, repository, name, url.searchParams.get("cursor"));
}
