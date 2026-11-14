import {
  answeredInPart,
  BROWSE_MAX_LIMIT,
  baseName,
  browseBody,
  codeBody,
  DATA_CODE_MAX_LIMIT,
  DATA_ROWS_MAX_LIMIT,
  describeLicense,
  describeSource,
  FIND_MAX_LIMIT,
  fileBody,
  findBody,
  GitHostError,
  type IndexNotReady,
  listedBody,
  listingBody,
  MAX_QUERY_LENGTH,
  MAX_REPO_PATH_LENGTH,
  type MountOverview,
  notReadyBody,
  READ_FILE_MAX_LIMIT,
  REST_MOUNT_LIST_LIMIT,
  REST_ROUTES,
  type RepoPath,
  type RestFailure,
  type RestMount,
  rowsBody,
  rowsCsv,
  skillOutcome,
} from "@skillcdn/core";
import { type Reader, ReaderInputError } from "@skillcdn/reader";
import type { Context, Env, Hono } from "hono";
import { cors } from "hono/cors";
import * as z from "zod";
import { restCacheControl, type ServedMount, sourceAccess } from "./mount.js";
import { recordRead, type ServeLogger, type UsageHooks } from "./tools.js";

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
const rawQuery = z.object({ path: z.string().min(1).max(MAX_REPO_PATH_LENGTH) });
/** The tables under a path as data (ADR-0080): a page of them, as JSON or as one CSV. */
const rowsQuery = z.object({
  path: z.string().max(MAX_REPO_PATH_LENGTH).optional(),
  heading: z.string().max(MAX_QUERY_LENGTH).optional(),
  cursor: z.string().max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(DATA_ROWS_MAX_LIMIT).optional(),
  format: z.enum(["json", "csv"]).optional(),
});
const codeQuery = z.object({
  path: z.string().max(MAX_REPO_PATH_LENGTH).optional(),
  heading: z.string().max(MAX_QUERY_LENGTH).optional(),
  cursor: z.string().max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(DATA_CODE_MAX_LIMIT).optional(),
});
/** A page of the listing, or one URI of it; never both. */
const listingQuery = z
  .object({
    cursor: z.string().max(4096).optional(),
    uri: z.string().min(1).max(2048).optional(),
  })
  .refine((value) => value.cursor === undefined || value.uri === undefined);

/** A file of a mount opened for its bytes to be sent as they are (ADR-0077). */
export interface RawFile {
  readonly size: number;
  /** The bytes, streamed. */
  readonly body: () => ReadableStream<Uint8Array>;
}

/**
 * The headers the bytes of a file are sent with (ADR-0077): an attachment, of no type a browser
 * would render, with nothing in it allowed to run, so that a repository's HTML or SVG never
 * executes on this origin; the same headers a git host's raw host sends.
 */
export function rawFileHeaders(path: RepoPath, size: number): Record<string, string> {
  const name = baseName(path);
  // The plain parameter for old clients, with every character outside printable ASCII replaced;
  // the encoded one for everyone else.
  const plain = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return {
    "content-type": "application/octet-stream",
    "content-length": String(size),
    "content-disposition": `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cache-control": "no-store",
  };
}

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

/**
 * The app a request names in its user agent, as a statistic counts it: the product token the
 * header begins with (`skillcdn-cli`, `curl`), and `browser` for a browser, whose header begins
 * with a token every browser shares; nothing when the header says nothing.
 */
export function clientAppOf(userAgent: string | undefined): string | undefined {
  const token = userAgent?.trim().split(/[\s/]/, 1)[0];
  if (token === undefined || token.length === 0) {
    return undefined;
  }
  return token.toLowerCase() === "mozilla" ? "browser" : token;
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
  /** What the app counts of the reads, as the tools count theirs; left out, nothing is counted. */
  readonly hooks?: UsageHooks<M> | undefined;
  /**
   * The client's network address, as the app resolves it behind its trusted proxies, for the
   * count of distinct clients; counted, never kept. Left out, no client is counted.
   */
  readonly clientAddress?: ((c: Context<E>) => string | undefined) | undefined;
  /**
   * The bytes of a file of a mount the app serves itself, as they are (ADR-0077): a deployment
   * opens the files of the packs of its own directory, the command those of the directories it
   * serves. Left out, or answering nothing for a mount, the `raw` route sends the reader to the
   * file at its source instead.
   */
  readonly rawFile?: ((mount: M, path: RepoPath) => Promise<RawFile | undefined>) | undefined;
}

/**
 * Registers the routes that read an address on the app, with CORS for any origin and no caching,
 * but of a ready answer of a public address pinned to a commit, kept a day (docs/specs/rest.md).
 */
export function registerAddressRoutes<E extends Env, M extends ServedMount>(
  app: Hono<E>,
  dependencies: AddressRouteDependencies<E, M>,
): void {
  const { reader, logger, mountAt, mountBody, hooks = {} } = dependencies;

  /**
   * A read was asked for: a call of the route, counted as a tool call is, by the client at the
   * request's address through the app its user agent names.
   */
  const record = (c: Context<E>, mount: M, route: string): void => {
    hooks.call?.(mount, `rest/${route}`);
    hooks.client?.(mount, dependencies.clientAddress?.(c), clientAppOf(c.req.header("user-agent")));
  };

  /** A ready answer of a pinned public address may be kept a day; the rest is `no-store`, below. */
  const keep = (c: Context<E>, mount: M): void => {
    const control = restCacheControl(mount);
    if (control !== undefined) c.header("cache-control", control);
  };

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
      exposeHeaders: ["x-request-id", "retry-after", "www-authenticate", "x-next-cursor"],
      maxAge: CORS_MAX_AGE_SECONDS,
    }),
  );
  // Nothing of the API is cached, unless a route said how long its answer may be kept: the
  // search across packs does, on a deployment that keeps its answers (ADR-0075), and a ready
  // answer of a public address pinned to a commit does (`keep`, above).
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("cache-control")) {
      c.header("cache-control", "no-store");
    }
  });

  app.get(`${REST_ROUTES.mounts}/*`, async (c) => {
    const mount = await mountAt(c, REST_ROUTES.mounts);
    if (mount instanceof Response) {
      return mount;
    }
    record(c, mount, "mounts");
    try {
      const answer = await reader.overview(mount, REST_MOUNT_LIST_LIMIT);
      if (answer.status === "ready") keep(c, mount);
      return c.json(mountBody(mount, answer));
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
    record(c, mount, "find");
    try {
      const result = await reader.find(mount, query, 0);
      // An answer the meaning did not reach, or reached in part, is not the commit's for a day.
      if (result.status === "ready" && !answeredInPart(result.result.ranking)) keep(c, mount);
      return c.json(findBody(result));
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
    record(c, mount, "skills");
    try {
      const answer = await reader.skill(
        mount,
        query.path ?? query.name ?? "",
        0,
        query.cursor,
        query.path !== undefined,
      );
      const outcome = skillOutcome(answer);
      if ("body" in outcome) {
        // The first page is the load; the pages after it are the same load.
        if (
          query.cursor === undefined &&
          answer.status === "ready" &&
          answer.lookup.kind === "found"
        ) {
          hooks.skillLoad?.(mount, answer.lookup.skill.directory);
        }
        if (outcome.body.status === "ready") keep(c, mount);
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
    record(c, mount, "files");
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
              `The file is too large to read here (${lookup.size} bytes; the limit is ${lookup.limit}). ${describeSource(sourceAccess(mount), lookup.sourceUrl)}`,
              { sourceUrl: lookup.sourceUrl },
            ),
            413,
          );
        case "not_text":
          return c.json(
            errorBody(
              "file.not_text",
              lookup.lfs === undefined
                ? `The file is not UTF-8 text, which is all this endpoint carries. ${describeSource(sourceAccess(mount), lookup.sourceUrl)}`
                : `The file is not readable here. ${describeSource(sourceAccess(mount), lookup.sourceUrl, lookup.lfs)}`,
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
          // The first page is the read; the pages after it are the same read.
          if (query.offset === undefined || query.offset === 0) {
            recordRead(hooks, mount, lookup.indexed);
          }
          keep(c, mount);
          return c.json(fileBody(lookup.file));
      }
    } catch (error) {
      return failure(c, error);
    }
  });

  // The skills extension as data (docs/specs/rest.md): a page of the skills the mount lists,
  // or what one URI of the listing names, for a program that installs skills into an agent's own
  // folder. A described skill is not listed, so its URI names nothing, as over MCP.
  app.get(`${REST_ROUTES.listing}/*`, async (c) => {
    const query = queryOf(c, listingQuery);
    if (query instanceof Response) return query;
    const mount = await mountAt(c, REST_ROUTES.listing);
    if (mount instanceof Response) return mount;
    record(c, mount, "listing");
    try {
      if (query.uri === undefined) {
        const answer = await reader.listSkills(mount, { cursor: query.cursor }, 0);
        if (answer.status === "ready") keep(c, mount);
        return c.json(listingBody(answer));
      }
      const skill = await reader.getSkill(mount, query.uri, 0);
      if (skill.status !== "ready") return c.json(notReadyBody(skill));
      if (skill.skill !== undefined) {
        const read = await reader.readResource(mount, query.uri, 0);
        const document = read.status === "ready" ? read.resource : undefined;
        if (document?.text === undefined) {
          // A listed skill's document is readable by construction; anything else is ours to look at.
          logger.error(
            { uri: query.uri, ...dependencies.requestFields?.(c) },
            "listed skill unreadable",
          );
          return c.json(errorBody("internal", "The request could not be served."), 500);
        }
        hooks.skillLoad?.(mount, skill.directory ?? "");
        keep(c, mount);
        return c.json(
          listedBody(skill.mount.commit, {
            kind: "skill",
            skill: skill.skill,
            document: document.text,
            digest: document.digest,
          }),
        );
      }
      const resource = await reader.readResource(mount, query.uri, 0);
      if (resource.status !== "ready") return c.json(notReadyBody(resource));
      if (resource.resource !== undefined) {
        if (resource.indexed !== undefined) recordRead(hooks, mount, resource.indexed);
        keep(c, mount);
        return c.json(
          listedBody(resource.mount.commit, { kind: "file", resource: resource.resource }),
        );
      }
      const directory = await reader.readDirectory(mount, query.uri, 0);
      if (directory.status !== "ready") return c.json(notReadyBody(directory));
      if (directory.entries !== undefined) {
        keep(c, mount);
        return c.json(
          listedBody(directory.mount.commit, {
            kind: "directory",
            uri: query.uri,
            entries: directory.entries,
          }),
        );
      }
      return c.json(errorBody("listing.not_found", "The URI names nothing this mount lists."), 404);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${REST_ROUTES.browse}/*`, async (c) => {
    const query = queryOf(c, browseQuery);
    if (query instanceof Response) return query;
    const mount = await mountAt(c, REST_ROUTES.browse);
    if (mount instanceof Response) return mount;
    record(c, mount, "browse");
    try {
      const result = await reader.browse(mount, query, 0);
      if (result.status === "ready") keep(c, mount);
      return c.json(browseBody(result));
    } catch (error) {
      return failure(c, error);
    }
  });

  /** What a data read answers when the index is not there to read, or the path names nothing. */
  const dataRefusal = (
    c: Context<E>,
    lookup:
      | { readonly kind: "not_ready"; readonly outcome: IndexNotReady }
      | { readonly kind: "not_found"; readonly path: string },
  ): Response =>
    lookup.kind === "not_found"
      ? c.json(
          errorBody(
            "file.not_found",
            "No Markdown document at that path in this mount, and none under it.",
          ),
          404,
        )
      : c.json(
          errorBody(
            lookup.outcome.status === "indexing" ? "index.indexing" : "index.failed",
            lookup.outcome.status === "indexing"
              ? "The repository is being indexed. Try again shortly."
              : "The repository could not be indexed. Try again later.",
          ),
          503,
          { "retry-after": "2" },
        );

  // The tables of a document, or of every document under a folder, as data (ADR-0080): what a
  // program takes whole instead of a model copying it out. JSON by default; `format=csv` answers
  // the page as one CSV, with the cursor of the next page in a header when there is one.
  app.get(`${REST_ROUTES.rows}/*`, async (c) => {
    const query = queryOf(c, rowsQuery);
    if (query instanceof Response) return query;
    const mount = await mountAt(c, REST_ROUTES.rows);
    if (mount instanceof Response) return mount;
    record(c, mount, "rows");
    try {
      const lookup = await reader.rows(mount, query);
      if (lookup.kind !== "found") return dataRefusal(c, lookup);
      keep(c, mount);
      const body = rowsBody({ status: "ready", result: lookup.result });
      if (query.format !== "csv" || body.status !== "ready") {
        return c.json(body);
      }
      if (body.nextCursor !== null) {
        c.header("x-next-cursor", body.nextCursor);
      }
      return c.body(rowsCsv(body.tables), 200, { "content-type": "text/csv; charset=utf-8" });
    } catch (error) {
      return failure(c, error);
    }
  });

  // The fenced code blocks of a document, or of every document under a folder, as data.
  app.get(`${REST_ROUTES.code}/*`, async (c) => {
    const query = queryOf(c, codeQuery);
    if (query instanceof Response) return query;
    const mount = await mountAt(c, REST_ROUTES.code);
    if (mount instanceof Response) return mount;
    record(c, mount, "code");
    try {
      const lookup = await reader.code(mount, query);
      if (lookup.kind !== "found") return dataRefusal(c, lookup);
      keep(c, mount);
      return c.json(codeBody({ status: "ready", result: lookup.result }));
    } catch (error) {
      return failure(c, error);
    }
  });

  // The bytes of a served file as they are (ADR-0077): sent as an attachment where the app has
  // them, which is where a result sends a reader for a file that is not text; for a repository
  // of a git host, the reader is sent on to the host, which has them.
  app.get(`${REST_ROUTES.raw}/*`, async (c) => {
    const query = queryOf(c, rawQuery);
    if (query instanceof Response) return query;
    const mount = await mountAt(c, REST_ROUTES.raw);
    if (mount instanceof Response) return mount;
    record(c, mount, "raw");
    try {
      const lookup = await reader.rawFile(mount, query.path);
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
        case "not_served":
          return c.json(
            errorBody(
              "file.not_served",
              `The file is described, not served: its license (${describeLicense(lookup.license)}) allows SkillCDN to say that it exists, not to pass its content on. Read it at its source: ${mount.sourceUrl(lookup.path)}`,
              { sourceUrl: mount.sourceUrl(lookup.path) },
            ),
            403,
          );
        case "served": {
          const file = await dependencies.rawFile?.(mount, lookup.path);
          if (file === undefined) {
            // The host's file of a pinned commit never moves: the redirect is kept as a read is.
            keep(c, mount);
            return c.redirect(mount.rawUrl(lookup.path), 302);
          }
          hooks.fileRead?.(mount, lookup.path);
          return c.body(file.body(), 200, rawFileHeaders(lookup.path, file.size));
        }
      }
    } catch (error) {
      return failure(c, error);
    }
  });
}
