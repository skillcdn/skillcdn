import {
  type Address,
  accountAvatarUrl,
  BROWSE_MAX_LIMIT,
  browseBody,
  describeLicense,
  FIND_MAX_LIMIT,
  fileBody,
  findBody,
  formatAddress,
  GitHostError,
  isLegalDocumentKind,
  type LegalDocumentKind,
  MAX_QUERY_LENGTH,
  MAX_REPO_PATH_LENGTH,
  type MountOverview,
  parseOwnerPath,
  parseRepoPath,
  READ_FILE_MAX_LIMIT,
  REST_FEATURED_SKILL_NAMES,
  REST_MOUNT_LIST_LIMIT,
  REST_ROUTES,
  type RestFailure,
  type RestFeatured,
  type RestLegalDocument,
  type RestMount,
  type RestRepository,
  type RestShowcase,
  rawFileUrl,
  mountBody as restMountBody,
  restRepoTranslations,
  skillOutcome,
} from "@skillcdn/core";
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import * as z from "zod";
import type { Logger } from "../logger.js";
import { ReaderInputError } from "../mounts/continuation.js";
import type { MountReader, NotReady } from "../mounts/mount-reader.js";
import type { Mount } from "../mounts/mount-service.js";
import { OwnerNotFoundError, type OwnerService } from "../owners/owner-service.js";
import type { AppEnv } from "./request-context.js";

export interface RestDependencies {
  readonly reader: MountReader;
  readonly logger: Logger;
  /** Resolves the address after `prefix` in the request path, or answers with the error. */
  readonly mountAt: (c: Context<AppEnv>, prefix: string) => Promise<Mount | Response>;
  /** Resolves an address without a request around it. `undefined` when it does not resolve. */
  readonly mountOf: (address: Address) => Promise<Mount | undefined>;
  /** The addresses the operator features, as the lists say right now. */
  readonly featured: () => Promise<readonly Address[]>;
  /** The landing showcase as the pages read it, as the operator wrote it right now (ADR-0028). */
  readonly showcase: () => Promise<RestShowcase>;
  /** A page of the deployment's own, when the operator wrote it (ADR-0029). */
  readonly legal: (kind: LegalDocumentKind) => Promise<RestLegalDocument | undefined>;
  /** The pages of accounts (ADR-0037). Left out, there are none. */
  readonly owners: OwnerService | undefined;
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
/** The git host pages an account's listing; it stops long before this. */
const ownerQuery = z.object({ page: z.coerce.number().int().min(1).max(100).optional() });
const fileQuery = z.object({
  path: z.string().min(1).max(MAX_REPO_PATH_LENGTH),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(READ_FILE_MAX_LIMIT).optional(),
});

export function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, ...extra } };
}

/** The size of the owner's picture the pages ask the host for: 80 CSS pixels on a 2x screen. */
const AVATAR_SIZE = 160;

function repositoryOf(mount: Mount): RestRepository {
  const { repository } = mount.repo;
  return {
    host: mount.address.host,
    owner: repository.owner.login,
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    description: repository.description ?? null,
    avatar: accountAvatarUrl(mount.address.host, repository.owner.hostAccountId, AVATAR_SIZE),
    visibility: repository.visibility,
  };
}

/**
 * Where the picture that stands for the address is loaded from (ADR-0031): the operator's, else
 * the one the manifest declares, which is a file of the repository at the commit the mount shows
 * or a URL as written; `null` when there is neither.
 */
function imageOf(
  mount: Mount,
  manifest: { readonly image: string | undefined } | undefined,
): string | null {
  if (mount.image !== undefined) {
    return mount.image;
  }
  const declared = manifest?.image;
  if (declared === undefined) {
    return null;
  }
  if (/^https:\/\//i.test(declared)) {
    return declared;
  }
  const path = parseRepoPath(declared);
  const { repository } = mount.repo;
  return path.ok
    ? rawFileUrl(
        { host: mount.address.host, owner: repository.owner.login, name: repository.name },
        mount.commit,
        path.value,
      )
    : null;
}

/**
 * What an address serves, as the API says it: shared with the page rendered for browsers. The
 * shape is core's; what only this server knows, the repository as the host shows it and where
 * its picture is, is added here.
 */
export function mountBody(
  mount: Mount,
  answer: NotReady | { readonly status: "ready"; readonly overview: MountOverview },
): RestMount {
  return restMountBody(
    {
      address: mount.address,
      repository: repositoryOf(mount),
      commit: mount.commit,
      verified: mount.verified,
      image: (manifest) => imageOf(mount, manifest),
    },
    answer,
  );
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
  const { reader, logger, mountAt, mountOf, featured, showcase, legal, now } = dependencies;

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

  // The API is read-only, so a page on any origin may call it. No cookie travels with such a
  // request; a token in the `authorization` header may (docs/specs/rest.md#authorization), and
  // its challenge is readable. The request id is exposed so that a report can be matched to the
  // logs.
  app.use(
    "/api/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "HEAD", "OPTIONS"],
      exposeHeaders: ["x-request-id", "retry-after", "www-authenticate"],
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
              `The file is too large to read here (${lookup.size} bytes; the limit is ${lookup.limit}). Fetch it from the source: ${lookup.sourceUrl}`,
              { sourceUrl: lookup.sourceUrl },
            ),
            413,
          );
        case "not_text":
          return c.json(
            errorBody(
              "file.not_text",
              `The file is not UTF-8 text, which is all this endpoint carries. Fetch it from the source: ${lookup.sourceUrl}`,
              { sourceUrl: lookup.sourceUrl },
            ),
            415,
          );
        case "not_served":
          return c.json(
            errorBody(
              "file.not_served",
              `The file is described, not served: its license (${describeLicense(lookup.license)}) allows SkillCDN to say that it exists, not to pass its content on. Read it at its source: ${lookup.sourceUrl}`,
              { sourceUrl: lookup.sourceUrl },
            ),
            403,
          );
        case "directory":
          return c.json(errorBody("request.invalid", "Use browse for directories."), 400);
        case "found":
          return c.json(fileBody(lookup.file));
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
      (await featured()).map(async (address): Promise<RestFeatured["items"]> => {
        try {
          const mount = await mountOf(address);
          if (mount === undefined) {
            return [];
          }
          const answer = await reader.overview(mount, REST_FEATURED_SKILL_NAMES);
          // A repository without a license is served with its provenance, never promoted
          // (ADR-0026). The operator sees why in the log, not the visitor.
          if (answer.status === "ready" && answer.overview.license.kind === "none") {
            logger.info(
              { address: formatAddress(address) },
              "featured repository has no license and is not shown",
            );
            return [];
          }
          return [
            {
              address: formatAddress(address),
              repository: repositoryOf(mount),
              manifest:
                answer.status === "ready" && answer.overview.manifest !== undefined
                  ? {
                      name: answer.overview.manifest.name ?? null,
                      description: answer.overview.manifest.description,
                      translations: restRepoTranslations(answer.overview.manifest.translations),
                    }
                  : null,
              verified: mount.verified,
              image: imageOf(
                mount,
                answer.status === "ready" ? answer.overview.manifest : undefined,
              ),
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

  // Empty when the operator wrote nothing: the pages then show the build's own showcase.
  app.get(REST_ROUTES.showcase, async (c) => c.json(await showcase()));

  // The page of an account (ADR-0037): who it is and what it has in public, as the git host
  // says, with what is already indexed first. Asking indexes nothing.
  const { owners } = dependencies;
  if (owners !== undefined) {
    app.get(`${REST_ROUTES.owners}/*`, async (c) => {
      const query = queryOf(c, ownerQuery);
      if (query instanceof Response) {
        return query;
      }
      const owner = parseOwnerPath(new URL(c.req.url).pathname.slice(REST_ROUTES.owners.length));
      if (owner === undefined) {
        return c.json(errorBody("owner.invalid", "Write an account as gh/<owner>."), 400);
      }
      try {
        return c.json(await owners.page(owner, query.page ?? 1));
      } catch (error) {
        if (error instanceof OwnerNotFoundError) {
          return c.json(errorBody("owner.not_found", "The account was not found."), 404);
        }
        return failure(c, error);
      }
    });
  }

  // The deployment's own pages, for the pages to render (ADR-0029). A kind that is not one, and
  // a page that has not been written, are the same absence.
  app.get(`${REST_ROUTES.legal}/:kind`, async (c) => {
    const kind = c.req.param("kind");
    const document = isLegalDocumentKind(kind) ? await legal(kind) : undefined;
    return document === undefined
      ? c.json(errorBody("legal.not_found", "This page has not been written."), 404)
      : c.json(document);
  });
}
