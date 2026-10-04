import {
  type Address,
  AUTH_ROUTES,
  accountPageUrl,
  CONSENT_REQUEST_PARAM,
  formatAddress,
  isLegalDocumentKind,
  isPinnedAddress,
  parseAddress,
  parseOwnerPath,
  REST_FEATURED_SKILL_NAMES,
  REST_MOUNT_LIST_LIMIT,
  REST_ROUTES,
  RETURN_TO_PARAM,
  type RestAuthorization,
  type RestBrowse,
  type RestBrowseEntry,
  type RestFeatured,
  type RestFile,
  type RestFind,
  type RestFindItem,
  type RestGrants,
  type RestMe,
  type RestMount,
  type RestMyRepositories,
  type RestOwner,
  type RestRepositoryCard,
  type RestShowcase,
  type RestSkill,
} from "@skillcdn/core";
import {
  FIXTURE_AUTHORIZATIONS,
  FIXTURE_AVATAR,
  FIXTURE_FAILURES,
  FIXTURE_FEATURED,
  FIXTURE_GRANTS,
  FIXTURE_INSTALL_URL,
  FIXTURE_LEGAL,
  FIXTURE_OWNERS,
  FIXTURE_REPOSITORIES,
  FIXTURE_USER,
  type FixtureRepository,
  summaryOf,
} from "./fixtures.js";

// The REST API of docs/specs/rest.md, answered from fixtures. The development server of the web
// UI mounts it, so the UI runs without a server, a database or a network. It follows the spec
// closely enough to design against; the real thing is apps/server.

export interface FixtureAnswer {
  readonly status: number;
  /** `undefined` for an answer without a body. */
  readonly body: unknown;
  /** Where the browser is sent, with a redirect status. */
  readonly location?: string;
}

/** How long `demo/slow` stays "indexing" after it was first asked for. */
const SLOW_INDEXING_MS = 5000;
const PAGE_LIMIT = 40_000;
/** How many repositories a page of an account lists here; the server's pages are the host's. */
const OWNER_PAGE_SIZE = 30;
/** Where the fixture sends a browser that has nowhere of its own to go back to. */
const STATES_PAGE = "/dev/states";

const firstAsked = new Map<string, number>();
/**
 * Whether the fixture person is signed in, and what they took back. One developer uses this
 * server, so it is one fact for the whole of it, without a cookie.
 */
let signedIn = false;
const removedGrants = new Set<string>();

/**
 * Forgets when `demo/slow` was first asked for, so that it starts indexing again, and who signed
 * in and what they removed.
 */
export function resetFixtureState(): void {
  firstAsked.clear();
  signedIn = false;
  removedGrants.clear();
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
  const repository = FIXTURE_REPOSITORIES[key] ?? listedRepository(address.owner, address.repo);
  // A private repository is as missing as one that does not exist until its person signs in.
  if (repository === undefined || (repository.private === true && !signedIn)) {
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
      avatar: repository.avatar ?? FIXTURE_AVATAR,
      visibility: repository.private === true ? "private" : "public",
    },
    ref: ref === undefined ? null : ref.kind === "commit" ? ref.hash : ref.name,
    pinned: isPinnedAddress(address),
    commit: ref?.kind === "commit" ? ref.hash : repository.commit,
    path: address.path,
    verified: repository.verified === true,
    // The manifest's picture is known once the index is; the operator's would show before.
    image: state === "ready" ? (repository.image ?? null) : null,
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
    if (repository.overviews?.[path]?.path === file) continue;
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
      overviewPath: repository.overviews?.[skill?.directory ?? childPath]?.path,
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
    overview: repository.overviews?.[path],
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

/** A repository as a card shows it: on the explorer's front page and on the page of an account. */
function cardOf(key: string, repository: FixtureRepository, now: number): RestRepositoryCard {
  const status = stateOf(key, repository, now);
  return {
    address: `/gh/${key}`,
    repository: {
      host: "gh" as const,
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
      description: repository.description ?? null,
      avatar: repository.avatar ?? FIXTURE_AVATAR,
    },
    manifest:
      status === "ready" && repository.manifest !== undefined
        ? {
            name: repository.manifest.name,
            description: repository.manifest.description,
            translations: repository.manifest.translations ?? {},
          }
        : null,
    verified: repository.verified === true,
    image: status === "ready" ? (repository.image ?? null) : null,
    status,
    skillCount: status === "ready" ? repository.skills.length : null,
    skills:
      status === "ready"
        ? repository.skills.slice(0, REST_FEATURED_SKILL_NAMES).map((detail) => detail.name)
        : [],
  };
}

function featuredBody(now: number): RestFeatured {
  return {
    items: FIXTURE_FEATURED.flatMap((key) => {
      const repository = FIXTURE_REPOSITORIES[key];
      return repository === undefined ? [] : [cardOf(key, repository, now)];
    }),
  };
}

/** The name of the made-up repositories an account's page lists besides the fixture ones. */
const LISTED_NAME = /^project-([1-9]\d*)$/;

/**
 * One of the made-up repositories the page of an account lists. Opening it is what opening most
 * repositories of an account is: it gets indexed, and holds nothing to serve.
 */
function listedRepository(owner: string, name: string): FixtureRepository | undefined {
  const profile = FIXTURE_OWNERS[owner];
  const number = Number(LISTED_NAME.exec(name)?.[1] ?? "0");
  return profile === undefined || number < 1 || number > profile.listed
    ? undefined
    : {
        owner: profile.login,
        name,
        defaultBranch: "main",
        commit: "0000000000000000000000000000000000000006",
        state: "ready",
        skills: [],
        documents: [],
        diagnostics: [],
        files: {},
      };
}

/** The page of an account (ADR-0037): what is indexed and holds skills first, then the rest. */
function ownerAnswer(path: string, params: URLSearchParams, now: number): FixtureAnswer {
  const owner = parseOwnerPath(path);
  if (owner === undefined) {
    return problem(400, "owner.invalid", "Write an account as gh/<owner>.");
  }
  const page = Number(params.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 100) {
    return problem(400, "request.invalid", "Missing or malformed query parameters: page.");
  }
  const profile = FIXTURE_OWNERS[owner.owner];
  if (profile === undefined) {
    return problem(404, "owner.not_found", "The account was not found.");
  }
  // Only what everyone can see: a private repository is on nobody's page.
  const own = Object.entries(FIXTURE_REPOSITORIES).filter(
    ([key, repository]) => key.startsWith(`${owner.owner}/`) && repository.private !== true,
  );
  const leads = (key: string, repository: FixtureRepository): boolean =>
    stateOf(key, repository, now) === "ready" && repository.skills.length > 0;
  const listed: RestOwner["repositories"] = [
    ...own
      .filter(([key, repository]) => !leads(key, repository))
      .map(([key, repository], index) => ({
        address: `/gh/${key}`,
        name: repository.name,
        description: repository.description ?? null,
        fork: false,
        archived: false,
        stars: index * 7,
        pushedAt: `2026-09-${String(28 - index).padStart(2, "0")}T08:00:00.000Z`,
      })),
    ...Array.from({ length: profile.listed }, (_, index) => ({
      address: `/gh/${owner.owner}/project-${index + 1}`,
      name: `project-${index + 1}`,
      description:
        index % 3 === 0 ? null : `Project ${index + 1}: one of many repositories without skills.`,
      fork: index % 5 === 4,
      archived: index % 11 === 10,
      stars: index % 4 === 0 ? 0 : (index * 37) % 500,
      pushedAt:
        index % 9 === 8
          ? null
          : `2026-0${8 - (index % 8)}-${String(27 - (index % 27)).padStart(2, "0")}T12:00:00.000Z`,
    })),
  ];
  const start = (page - 1) * OWNER_PAGE_SIZE;
  const body: RestOwner = {
    owner: {
      host: owner.host,
      login: profile.login,
      name: profile.name,
      kind: profile.kind,
      avatar: FIXTURE_AVATAR,
      bio: profile.bio,
      url: accountPageUrl(owner.host, profile.login),
      publicRepositories: own.length + profile.listed,
    },
    indexed:
      page === 1
        ? own
            .filter(([key, repository]) => leads(key, repository))
            .sort(([, a], [, b]) => b.skills.length - a.skills.length)
            .map(([key, repository]) => cardOf(key, repository, now))
        : [],
    repositories: listed.slice(start, start + OWNER_PAGE_SIZE),
    nextPage: start + OWNER_PAGE_SIZE < listed.length ? page + 1 : null,
  };
  return { status: 200, body };
}

const signInRequired = (): FixtureAnswer => problem(401, "auth.required", "Sign in to continue.");

/** What the fixture person can reach through the git host's app, by where it is installed. */
function myRepositoriesBody(): RestMyRepositories {
  return {
    installUrl: FIXTURE_INSTALL_URL,
    installations: [
      {
        account: { login: "Acme", kind: "organization", avatar: FIXTURE_AVATAR },
        manageUrl: FIXTURE_INSTALL_URL,
        selection: "selected",
        repositories: Object.entries(FIXTURE_REPOSITORIES)
          .filter(([key]) => key === "acme/private-skills" || key === "acme/skills")
          .map(([key, repository]) => ({
            address: `/gh/${key}`,
            owner: repository.owner,
            name: repository.name,
            description: repository.description ?? null,
            visibility: repository.private === true ? ("private" as const) : ("public" as const),
          })),
        truncated: false,
      },
      {
        account: { login: FIXTURE_USER.login, kind: "user", avatar: FIXTURE_AVATAR },
        manageUrl: FIXTURE_INSTALL_URL,
        selection: "all",
        repositories: [],
        truncated: false,
      },
    ],
    truncated: false,
  };
}

/** What a client asked the fixture person to allow, for the consent page. */
function authorizationAnswer(params: URLSearchParams): FixtureAnswer {
  const asked = FIXTURE_AUTHORIZATIONS[params.get(CONSENT_REQUEST_PARAM) ?? ""];
  const address = asked === undefined ? undefined : parseAddress(asked.address);
  if (asked === undefined || address === undefined || !address.ok) {
    return problem(400, "oauth.invalid_request", "The request is not valid or has expired.");
  }
  const key = `${address.value.owner}/${address.value.repo}`;
  const body: RestAuthorization = {
    client: asked.client,
    address: asked.address,
    scope: ["read"],
    user: signedIn ? FIXTURE_USER : null,
    visible: signedIn && asked.unknown !== true ? FIXTURE_REPOSITORIES[key] !== undefined : null,
    installUrl: signedIn ? FIXTURE_INSTALL_URL : null,
  };
  return { status: 200, body };
}

/**
 * Signing in and out, and what belongs to whoever is signed in (docs/specs/permissions.md).
 * `undefined` when the request is about none of that.
 */
function accountAnswer(url: URL, method: string): FixtureAnswer | undefined {
  if (url.pathname === AUTH_ROUTES.login) {
    // No git host to ask: the fixture person is signed in, and goes back to where they were.
    signedIn = true;
    const wanted = url.searchParams.get(RETURN_TO_PARAM) ?? "/";
    const local = wanted.startsWith("/") && !wanted.startsWith("//") && !wanted.includes("\\");
    return { status: 302, body: undefined, location: local ? wanted : "/" };
  }
  if (url.pathname === AUTH_ROUTES.logout && method === "POST") {
    signedIn = false;
    return { status: 204, body: undefined };
  }
  if (url.pathname === REST_ROUTES.me) {
    const body: RestMe = { user: signedIn ? FIXTURE_USER : null };
    return { status: 200, body };
  }
  if (url.pathname === `${REST_ROUTES.me}/repositories`) {
    return signedIn ? { status: 200, body: myRepositoriesBody() } : signInRequired();
  }
  const grants = `${REST_ROUTES.me}/grants`;
  if (url.pathname === grants) {
    const body: RestGrants = {
      items: FIXTURE_GRANTS.filter((grant) => !removedGrants.has(grant.id)),
    };
    return signedIn ? { status: 200, body } : signInRequired();
  }
  if (url.pathname.startsWith(`${grants}/`) && method === "DELETE") {
    if (!signedIn) {
      return signInRequired();
    }
    const id = decodeURIComponent(url.pathname.slice(grants.length + 1));
    if (removedGrants.has(id) || !FIXTURE_GRANTS.some((grant) => grant.id === id)) {
      return problem(404, "grant.not_found", "No such grant.");
    }
    removedGrants.add(id);
    return { status: 200, body: { id, removed: true } };
  }
  if (url.pathname === REST_ROUTES.authorization) {
    return authorizationAnswer(url.searchParams);
  }
  if (url.pathname === REST_ROUTES.decision && method === "POST") {
    // There is no app to go back to, so either answer comes back to the list of states.
    return signedIn ? { status: 200, body: { redirect: STATES_PAGE } } : signInRequired();
  }
  return undefined;
}

/**
 * Answers a REST request from fixtures, and the fixture sign-in. `undefined` when the URL is
 * neither.
 */
export function handleFixtureRequest(
  url: URL,
  now: number = Date.now(),
  method = "GET",
): FixtureAnswer | undefined {
  const account = accountAnswer(url, method);
  if (account !== undefined) {
    return account;
  }
  if (url.pathname === REST_ROUTES.featured) {
    return { status: 200, body: featuredBody(now) };
  }
  if (url.pathname.startsWith(`${REST_ROUTES.owners}/`)) {
    return ownerAnswer(url.pathname.slice(REST_ROUTES.owners.length), url.searchParams, now);
  }
  if (url.pathname === REST_ROUTES.showcase) {
    // No operator's showcase: the pages show the build's own, which is what is designed here.
    const body: RestShowcase = { items: [] };
    return { status: 200, body };
  }
  if (url.pathname.startsWith(`${REST_ROUTES.legal}/`)) {
    const kind = url.pathname.slice(REST_ROUTES.legal.length + 1);
    const document = isLegalDocumentKind(kind) ? FIXTURE_LEGAL[kind] : undefined;
    return document === undefined
      ? problem(404, "legal.not_found", "This page has not been written.")
      : { status: 200, body: document };
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
    const state = stateOf(key, repository, now);
    if (state !== "ready") {
      return problem(
        503,
        `index.${state}`,
        "The publication policy is not ready. Try again later.",
      );
    }
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
