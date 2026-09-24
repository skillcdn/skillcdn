import {
  type Address,
  BROWSE_MAX_LIMIT,
  type BrowseResult,
  FIND_MAX_LIMIT,
  type FindResult,
  formatAddress,
  GitHostError,
  isPinnedAddress,
  MAX_QUERY_LENGTH,
  MAX_REPO_PATH_LENGTH,
  READ_FILE_MAX_LIMIT,
  REST_FEATURED_SKILL_NAMES,
  REST_MOUNT_LIST_LIMIT,
  REST_ROUTES,
  type RepoTranslation,
  type RestBrowse,
  type RestFeatured,
  type RestFile,
  type RestFind,
  type RestMount,
  type RestRepository,
  type RestRepoTranslation,
  type RestSkill,
  type RestSkillTranslation,
  type SkillTranslation,
} from "@skillcdn/core";
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import * as z from "zod";
import type { Logger } from "../logger.js";
import { ReaderInputError } from "../mounts/continuation.js";
import type { MountOverview, MountReader, NotReady, SkillLookup } from "../mounts/mount-reader.js";
import type { Mount } from "../mounts/mount-service.js";
import type { AppEnv } from "./request-context.js";

export interface RestDependencies {
  readonly reader: MountReader;
  readonly logger: Logger;
  /** Resolves the address after `prefix` in the request path, or answers with the error. */
  readonly mountAt: (c: Context<AppEnv>, prefix: string) => Promise<Mount | Response>;
  /** Resolves an address without a request around it. `undefined` when it does not resolve. */
  readonly mountOf: (address: Address) => Promise<Mount | undefined>;
  readonly featured: readonly Address[];
  /** Milliseconds from a clock that never goes backwards. */
  readonly now: () => number;
}

/** The featured list is the same for everyone and costs several queries per address. */
const FEATURED_CACHE_MS = 30_000;

const findQuery = z.object({
  path: z.string().max(MAX_REPO_PATH_LENGTH).optional(),
  cursor: z.string().max(4096).optional(),
  query: z.string().max(MAX_QUERY_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(FIND_MAX_LIMIT).optional(),
});
const browseQuery = z.object({
  path: z.string().max(MAX_REPO_PATH_LENGTH).optional(),
  cursor: z.string().max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(BROWSE_MAX_LIMIT).optional(),
});
const skillQuery = z
  .object({
    path: z.string().min(1).max(MAX_REPO_PATH_LENGTH).optional(),
    name: z.string().min(1).max(MAX_REPO_PATH_LENGTH).optional(),
    cursor: z.string().max(4096).optional(),
  })
  .refine((value) => value.path !== undefined || value.name !== undefined);
const fileQuery = z.object({
  path: z.string().min(1).max(MAX_REPO_PATH_LENGTH),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(READ_FILE_MAX_LIMIT).optional(),
});

function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, ...extra } };
}

function repositoryOf(mount: Mount): RestRepository {
  const { repository } = mount.repo;
  return {
    host: mount.address.host,
    owner: repository.owner.login,
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    description: repository.description ?? null,
  };
}

const notReadyBody = (outcome: NotReady) =>
  outcome.status === "indexing"
    ? ({ status: "indexing" } as const)
    : ({ status: "failed", errorCode: outcome.errorCode } as const);

// Absent values are `null` in the API, never missing keys.
function skillTranslations(
  translations: Readonly<Record<string, SkillTranslation>>,
): Record<string, RestSkillTranslation> {
  return Object.fromEntries(
    Object.entries(translations).map(([tag, entry]) => [
      tag,
      { title: entry.title ?? null, description: entry.description ?? null },
    ]),
  );
}

function repoTranslations(
  translations: Readonly<Record<string, RepoTranslation>>,
): Record<string, RestRepoTranslation> {
  return Object.fromEntries(
    Object.entries(translations).map(([tag, entry]) => [
      tag,
      { name: entry.name ?? null, description: entry.description ?? null },
    ]),
  );
}

export function browseBody(
  answer: NotReady | { readonly status: "ready"; readonly result: BrowseResult },
): RestBrowse {
  return answer.status !== "ready"
    ? notReadyBody(answer)
    : {
        status: "ready",
        commit: answer.result.mount.commit,
        path: answer.result.path,
        overview:
          answer.result.overview === undefined
            ? undefined
            : {
                path: answer.result.overview.path,
                title: answer.result.overview.title ?? null,
                description: answer.result.overview.description ?? null,
              },
        diagnostics: [...(answer.result.diagnostics ?? [])],
        entries: [...answer.result.entries],
        nextCursor: answer.result.nextCursor ?? null,
      };
}

export function findBody(
  answer: NotReady | { readonly status: "ready"; readonly result: FindResult },
): RestFind {
  if (answer.status !== "ready") return notReadyBody(answer);
  const result = answer.result;
  return {
    status: "ready",
    commit: result.mount.commit,
    path: result.path ?? result.mount.path,
    nextCursor: result.nextCursor ?? null,
    query: result.query ?? null,
    totals: result.totals ?? null,
    diagnostics: [...result.diagnostics],
    items: result.items.map((item) =>
      item.kind === "skill"
        ? {
            kind: "skill",
            name: item.name,
            path: item.directory.length === 0 ? "SKILL.md" : `${item.directory}/SKILL.md`,
            directory: item.directory,
            description: item.description,
            translations: skillTranslations(item.translations),
            files: item.files.map((file) => ({
              path: file.path,
              title: file.title ?? null,
              summary: file.summary ?? null,
            })),
            moreFiles: item.moreFiles,
          }
        : {
            kind: "document",
            path: item.path,
            title: item.title ?? null,
            summary: item.summary ?? null,
            skillDirectory: item.skillDirectory ?? null,
          },
    ),
  };
}

/** What an address serves, as the API says it: shared with the page rendered for browsers. */
export function mountBody(
  mount: Mount,
  answer: NotReady | { readonly status: "ready"; readonly overview: MountOverview },
): RestMount {
  const ref = mount.address.ref;
  return {
    address: formatAddress(mount.address),
    repository: repositoryOf(mount),
    ref: ref === undefined ? null : ref.kind === "commit" ? ref.hash : ref.name,
    pinned: isPinnedAddress(mount.address),
    commit: mount.commit,
    path: mount.address.path,
    verified: mount.verified,
    index:
      answer.status !== "ready"
        ? notReadyBody(answer)
        : {
            status: "ready",
            truncated: answer.overview.mount.truncated,
            manifest:
              answer.overview.manifest === undefined
                ? null
                : {
                    path: answer.overview.manifest.path ?? null,
                    name: answer.overview.manifest.name ?? null,
                    description: answer.overview.manifest.description,
                    language: answer.overview.manifest.language ?? null,
                    translations: repoTranslations(answer.overview.manifest.translations),
                  },
            skillCount: answer.overview.skillCount,
            documentCount: answer.overview.documentCount,
            skills: answer.overview.skills.map((skill) => ({
              name: skill.name,
              path: skill.directory.length === 0 ? "SKILL.md" : `${skill.directory}/SKILL.md`,
              directory: skill.directory,
              description: skill.description,
              warnings: [...skill.warnings],
              translations: skillTranslations(skill.translations),
            })),
            documents: answer.overview.documents.map((document) => ({
              path: document.path,
              title: document.title ?? null,
              summary: document.summary ?? null,
            })),
            diagnostics: answer.overview.diagnostics.map((diagnostic) => ({
              path: diagnostic.path,
              code: diagnostic.code,
              message: diagnostic.message,
            })),
            groups: [...(answer.overview.groups ?? [])],
          },
  };
}

export interface RestFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly directories?: readonly string[];
  readonly retryAfterSeconds?: number;
}

/** One skill as the API answers it: the body, or the failure with its status. */
export function skillOutcome(
  answer: NotReady | { readonly status: "ready"; readonly lookup: SkillLookup },
): { readonly body: RestSkill } | { readonly failure: RestFailure } {
  if (answer.status !== "ready") {
    return { body: notReadyBody(answer) };
  }
  const { lookup } = answer;
  switch (lookup.kind) {
    case "not_found":
      return {
        failure: {
          status: 404,
          code: "skill.not_found",
          message: "No skill at that SKILL.md path in this mount.",
        },
      };
    case "ambiguous":
      return {
        failure: {
          status: 409,
          code: "skill.ambiguous",
          message: "Several skills share that name. Ask for a directory.",
          directories: [...lookup.directories],
        },
      };
    case "unavailable":
      return {
        failure: {
          status: 503,
          code: "skill.unavailable",
          message: "The skill is indexed but its content is not available.",
        },
      };
    case "found": {
      const { skill } = lookup;
      return {
        body: {
          status: "ready",
          skill: {
            path: skill.path ?? (skill.directory ? `${skill.directory}/SKILL.md` : "SKILL.md"),
            ruleChain: (skill.ruleChain ?? []).map((rule) => ({
              path: rule.path ?? "SKILLCDN.md",
              body: rule.body,
              truncated: rule.truncated,
            })),
            references: [...(skill.references ?? [])],
            complete: skill.complete ?? true,
            nextCursor: skill.nextCursor ?? null,
            includedContents: skill.included.map((file) => ({
              path: file.path,
              content: file.content ?? null,
              truncated: file.truncated,
            })),
            name: skill.name,
            directory: skill.directory,
            description: skill.description,
            license: skill.license ?? null,
            compatibility: skill.compatibility ?? null,
            allowedTools: skill.allowedTools ?? null,
            metadata: { ...skill.metadata },
            body: skill.body,
            files: [...skill.files],
            filesTruncated: skill.filesTruncated,
            included: skill.included.map((file) => file.path),
            warnings: [...skill.warnings],
            translations: skillTranslations(skill.translations),
            rules:
              skill.rules === undefined
                ? null
                : {
                    path: skill.rules.path ?? null,
                    body: skill.rules.body,
                    truncated: skill.rules.truncated,
                  },
          },
        },
      };
    }
  }
}

/** A failure of the git host, which is the caller's to retry. Anything else is ours to look at. */
export function hostFailure(error: unknown): RestFailure | undefined {
  if (error instanceof GitHostError && error.kind === "rate_limited") {
    return {
      status: 503,
      code: "mount.rate_limited",
      message: "The git host is rate limiting requests. Try again later.",
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    };
  }
  if (error instanceof GitHostError) {
    return {
      status: 503,
      code: "mount.unavailable",
      message: "The git host could not be reached. Try again later.",
    };
  }
  return undefined;
}

/** How long a browser may remember the answer to a preflight request. */
/** How long a browser may remember a preflight answer. */
export const CORS_MAX_AGE_SECONDS = 86_400;

/** Registers the REST API of docs/specs/rest.md on the app. */
export function registerRest(app: Hono<AppEnv>, dependencies: RestDependencies): void {
  const { reader, logger, mountAt, mountOf, featured, now } = dependencies;

  /** Parses the query string, or answers 400 without repeating what was sent. */
  const queryOf = <Schema extends z.ZodType>(
    c: Context<AppEnv>,
    schema: Schema,
  ): z.infer<Schema> | Response => {
    const parsed = schema.safeParse(c.req.query());
    if (parsed.success) {
      return parsed.data;
    }
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    return c.json(
      errorBody("request.invalid", `Missing or malformed query parameters: ${names.join(", ")}.`),
      400,
    );
  };

  /** Failures of the git host are the caller's to retry; anything else is ours to look at. */
  const failure = (c: Context<AppEnv>, error: unknown): Response => {
    if (error instanceof ReaderInputError) return c.json(errorBody(error.code, error.message), 400);
    const known = hostFailure(error);
    if (known !== undefined) {
      if (known.retryAfterSeconds !== undefined) {
        c.header("retry-after", String(known.retryAfterSeconds));
      }
      return c.json(errorBody(known.code, known.message), known.status as 503);
    }
    logger.error({ err: error, requestId: c.get("requestId") }, "rest request failed");
    return c.json(errorBody("internal", "The request could not be served."), 500);
  };

  // The API is public and read-only, so a page on any origin may call it. No credentials are
  // involved; the request id is exposed so that a report can be matched to the logs.
  app.use(
    "/api/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "HEAD", "OPTIONS"],
      exposeHeaders: ["x-request-id", "retry-after"],
      maxAge: CORS_MAX_AGE_SECONDS,
    }),
  );
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });

  app.get(`${REST_ROUTES.mounts}/*`, async (c) => {
    const mount = await mountAt(c, REST_ROUTES.mounts);
    if (mount instanceof Response) {
      return mount;
    }
    try {
      return c.json(mountBody(mount, await reader.overview(mount, REST_MOUNT_LIST_LIMIT)));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.find}/*`, async (c) => {
    const query = queryOf(c, findQuery);
    if (query instanceof Response) {
      return query;
    }
    const mount = await mountAt(c, REST_ROUTES.find);
    if (mount instanceof Response) {
      return mount;
    }
    try {
      return c.json(findBody(await reader.find(mount, query, 0)));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.skills}/*`, async (c) => {
    const query = queryOf(c, skillQuery);
    if (query instanceof Response) {
      return query;
    }
    const mount = await mountAt(c, REST_ROUTES.skills);
    if (mount instanceof Response) {
      return mount;
    }
    try {
      const outcome = skillOutcome(
        await reader.skill(
          mount,
          query.path ?? query.name ?? "",
          0,
          query.cursor,
          query.path !== undefined,
        ),
      );
      if ("body" in outcome) {
        return c.json(outcome.body);
      }
      const { status, code, message, directories } = outcome.failure;
      return c.json(
        errorBody(code, message, directories === undefined ? {} : { directories }),
        status as 404,
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.files}/*`, async (c) => {
    const query = queryOf(c, fileQuery);
    if (query instanceof Response) {
      return query;
    }
    const mount = await mountAt(c, REST_ROUTES.files);
    if (mount instanceof Response) {
      return mount;
    }
    try {
      const lookup = await reader.file(mount, query);
      switch (lookup.kind) {
        case "not_ready":
          return c.json(
            errorBody(
              lookup.outcome.status === "indexing" ? "index.indexing" : "index.failed",
              lookup.outcome.status === "indexing"
                ? "The repository is being indexed. Try again shortly."
                : "The repository could not be indexed. Try again later.",
            ),
            503,
            { "retry-after": "2" },
          );
        case "invalid_path":
          return c.json(errorBody("request.invalid", `Not a valid path: ${lookup.reason}.`), 400);
        case "not_found":
          return c.json(errorBody("file.not_found", "No file at that path in this mount."), 404);
        case "too_large":
          return c.json(
            errorBody(
              "file.too_large",
              `The file is too large to read (${lookup.size} bytes; the limit is ${lookup.limit}).`,
            ),
            413,
          );
        case "not_text":
          return c.json(errorBody("file.not_text", "The file is not UTF-8 text."), 415);
        case "directory":
          return c.json(errorBody("request.invalid", "Use browse for directories."), 400);
        case "found": {
          const { file } = lookup;
          const body: RestFile = {
            kind: "file",
            references: [...(file.references ?? [])],
            path: file.path,
            content: file.content,
            offset: file.offset,
            nextOffset: file.nextOffset ?? null,
            totalLength: file.totalLength,
          };
          return c.json(body);
        }
      }
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.browse}/*`, async (c) => {
    const query = queryOf(c, browseQuery);
    if (query instanceof Response) return query;
    const mount = await mountAt(c, REST_ROUTES.browse);
    if (mount instanceof Response) return mount;
    try {
      return c.json(browseBody(await reader.browse(mount, query, 0)));
    } catch (error) {
      return failure(c, error);
    }
  });

  let featuredCache: { readonly until: number; readonly body: Promise<RestFeatured> } | undefined;

  const loadFeatured = async (): Promise<RestFeatured> => {
    const items = await Promise.all(
      featured.map(async (address): Promise<RestFeatured["items"]> => {
        try {
          const mount = await mountOf(address);
          if (mount === undefined) {
            return [];
          }
          const answer = await reader.overview(mount, REST_FEATURED_SKILL_NAMES);
          return [
            {
              address: formatAddress(address),
              repository: repositoryOf(mount),
              manifest:
                answer.status === "ready" && answer.overview.manifest !== undefined
                  ? {
                      name: answer.overview.manifest.name ?? null,
                      description: answer.overview.manifest.description,
                      translations: repoTranslations(answer.overview.manifest.translations),
                    }
                  : null,
              status: answer.status,
              skillCount: answer.status === "ready" ? answer.overview.skillCount : null,
              skills:
                answer.status === "ready" ? answer.overview.skills.map((skill) => skill.name) : [],
            },
          ];
        } catch (error) {
          logger.warn({ err: error, address: formatAddress(address) }, "featured address failed");
          return [];
        }
      }),
    );
    return { items: items.flat() };
  };

  app.get(REST_ROUTES.featured, async (c) => {
    if (featuredCache === undefined || featuredCache.until <= now()) {
      const body = loadFeatured();
      featuredCache = { until: now() + FEATURED_CACHE_MS, body };
      body.catch(() => {
        featuredCache = undefined;
      });
    }
    return c.json(await featuredCache.body);
  });
}
