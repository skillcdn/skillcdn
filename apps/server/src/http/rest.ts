import {
  type Address,
  FIND_MAX_LIMIT,
  formatAddress,
  GitHostError,
  isPinnedAddress,
  MAX_QUERY_LENGTH,
  MAX_REPO_PATH_LENGTH,
  READ_FILE_MAX_LIMIT,
  REST_FEATURED_SKILL_NAMES,
  REST_MOUNT_LIST_LIMIT,
  REST_ROUTES,
  type RestFeatured,
  type RestFile,
  type RestFind,
  type RestMount,
  type RestRepository,
  type RestSkill,
} from "@skillcdn/core";
import type { Context, Hono } from "hono";
import * as z from "zod";
import type { Logger } from "../logger.js";
import type { MountReader, NotReady } from "../mounts/mount-reader.js";
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
  query: z.string().max(MAX_QUERY_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(FIND_MAX_LIMIT).optional(),
});
const skillQuery = z.object({ name: z.string().min(1).max(MAX_REPO_PATH_LENGTH) });
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
  };
}

const notReadyBody = (outcome: NotReady) =>
  outcome.status === "indexing"
    ? ({ status: "indexing" } as const)
    : ({ status: "failed", errorCode: outcome.errorCode } as const);

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
    if (error instanceof GitHostError && error.kind === "rate_limited") {
      if (error.retryAfterSeconds !== undefined) {
        c.header("retry-after", String(error.retryAfterSeconds));
      }
      return c.json(
        errorBody("mount.rate_limited", "The git host is rate limiting requests. Try again later."),
        503,
      );
    }
    if (error instanceof GitHostError) {
      return c.json(
        errorBody("mount.unavailable", "The git host could not be reached. Try again later."),
        503,
      );
    }
    logger.error({ err: error, requestId: c.get("requestId") }, "rest request failed");
    return c.json(errorBody("internal", "The request could not be served."), 500);
  };

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
      const answer = await reader.overview(mount, REST_MOUNT_LIST_LIMIT);
      const ref = mount.address.ref;
      const body: RestMount = {
        address: formatAddress(mount.address),
        repository: repositoryOf(mount),
        ref: ref === undefined ? null : ref.kind === "commit" ? ref.hash : ref.name,
        pinned: isPinnedAddress(mount.address),
        commit: mount.commit,
        path: mount.address.path,
        verified: false,
        index:
          answer.status !== "ready"
            ? notReadyBody(answer)
            : {
                status: "ready",
                truncated: answer.overview.mount.truncated,
                skillCount: answer.overview.skillCount,
                documentCount: answer.overview.documentCount,
                skills: answer.overview.skills.map((skill) => ({
                  name: skill.name,
                  directory: skill.directory,
                  description: skill.description,
                  warnings: [...skill.warnings],
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
              },
      };
      return c.json(body);
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
      const found = await reader.find(mount, query, 0);
      const body: RestFind =
        found.status !== "ready"
          ? notReadyBody(found)
          : {
              status: "ready",
              query: found.result.query ?? null,
              items: found.result.items.map((item) =>
                item.kind === "skill"
                  ? { ...item }
                  : {
                      kind: "document",
                      path: item.path,
                      title: item.title ?? null,
                      summary: item.summary ?? null,
                    },
              ),
            };
      return c.json(body);
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
      const answer = await reader.skill(mount, query.name, 0);
      if (answer.status !== "ready") {
        return c.json(notReadyBody(answer) satisfies RestSkill);
      }
      const { lookup } = answer;
      switch (lookup.kind) {
        case "not_found":
          return c.json(errorBody("skill.not_found", "No skill by that name in this mount."), 404);
        case "ambiguous":
          return c.json(
            errorBody("skill.ambiguous", "Several skills share that name. Ask for a directory.", {
              directories: [...lookup.directories],
            }),
            409,
          );
        case "unavailable":
          return c.json(
            errorBody(
              "skill.unavailable",
              "The skill is indexed but its content is not available.",
            ),
            503,
          );
        case "found": {
          const { skill } = lookup;
          const body: RestSkill = {
            status: "ready",
            skill: {
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
              warnings: [...skill.warnings],
            },
          };
          return c.json(body);
        }
      }
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
        case "found": {
          const { file } = lookup;
          const body: RestFile = {
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
