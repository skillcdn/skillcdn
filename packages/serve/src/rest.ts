import {
  BROWSE_MAX_LIMIT,
  browseBody,
  describeLicense,
  FIND_MAX_LIMIT,
  fileBody,
  findBody,
  GitHostError,
  type IndexNotReady,
  MAX_QUERY_LENGTH,
  MAX_REPO_PATH_LENGTH,
  type MountOverview,
  READ_FILE_MAX_LIMIT,
  REST_MOUNT_LIST_LIMIT,
  REST_ROUTES,
  type RestFailure,
  type RestMount,
  skillOutcome,
} from "@skillcdn/core";
import { type Reader, ReaderInputError } from "@skillcdn/reader";
import type { Context, Env, Hono } from "hono";
import { cors } from "hono/cors";
import * as z from "zod";
import type { ServedMount } from "./mount.js";
import type { ServeLogger } from "./tools.js";

// The routes of the REST API that read an address (docs/specs/rest.md): `mounts`, `browse`,
// `find`, `skills` and `files`, over the reader, on any Hono app. Who may read the address is
// the app's to decide: `mountAt` resolves the address after the route's prefix, for whoever the
// request is for, or answers with the refusal.

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

export function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, ...extra } };
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

/** How long a browser may remember a preflight answer. */
export const CORS_MAX_AGE_SECONDS = 86_400;

export interface AddressRouteDependencies<E extends Env, M extends ServedMount> {
  readonly reader: Reader<M>;
  readonly logger: ServeLogger;
  /** Resolves the address after `prefix` in the request path, or answers with the error. */
  readonly mountAt: (c: Context<E>, prefix: string) => Promise<M | Response>;
  /** The `mounts` body of a mount: what names the address, which only the app knows. */
  readonly mountBody: (
    mount: M,
    answer: IndexNotReady | { readonly status: "ready"; readonly overview: MountOverview },
  ) => RestMount;
  /** What of a request goes into the log of a failure, such as its id. */
  readonly requestFields?: ((c: Context<E>) => Record<string, unknown>) | undefined;
}

/** Registers the routes that read an address on the app, with CORS for any origin and no caching. */
export function registerAddressRoutes<E extends Env, M extends ServedMount>(
  app: Hono<E>,
  dependencies: AddressRouteDependencies<E, M>,
): void {
  const { reader, logger, mountAt, mountBody } = dependencies;

  /** Parses the query string, or answers 400 without repeating what was sent. */
  const queryOf = <Schema extends z.ZodType>(
    c: Context<E>,
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
  const failure = (c: Context<E>, error: unknown): Response => {
    if (error instanceof ReaderInputError) return c.json(errorBody(error.code, error.message), 400);
    const known = hostFailure(error);
    if (known !== undefined) {
      if (known.retryAfterSeconds !== undefined) {
        c.header("retry-after", String(known.retryAfterSeconds));
      }
      return c.json(errorBody(known.code, known.message), known.status as 503);
    }
    logger.error({ err: error, ...dependencies.requestFields?.(c) }, "rest request failed");
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
}
