import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_MEDIA_BYTES } from "@skillcdn/core";
import { OPERATOR_LIST_KINDS, type OperatorListKind, purgeRepository } from "@skillcdn/db";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Logger } from "../logger.js";
import { OperatorListError, OperatorLists } from "../operator/lists.js";
import { type Showcase, ShowcaseError } from "../operator/showcase.js";
import type { AppEnv } from "./request-context.js";
import { errorBody } from "./rest.js";

/**
 * The admin API (ADR-0026, ADR-0028): the operator's lists, the landing showcase with its uploads,
 * and the takedown, behind one bearer token. It exists only when a token is configured;
 * otherwise the paths are nothing, like any other.
 */
export interface AdminDependencies {
  readonly token: string;
  readonly lists: OperatorLists;
  readonly showcase: Showcase;
  readonly purge: (address: string) => Promise<{ snapshots: number; blobs: number } | undefined>;
  readonly logger: Logger;
}

export const ADMIN_PREFIX = "/admin/v1";

/** An entry is a document of words in a few languages; this is far more than any needs. */
const MAX_ENTRY_BYTES = 256 * 1024;

/** Equal without leaking how far the comparison got; the hashes make the lengths equal. */
function sameToken(presented: string, expected: string): boolean {
  const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

function kindOf(value: string): OperatorListKind | undefined {
  return OPERATOR_LIST_KINDS.find((kind) => kind === value);
}

export function registerAdmin(app: Hono<AppEnv>, dependencies: AdminDependencies): void {
  const { token, lists, showcase, logger } = dependencies;

  app.use(`${ADMIN_PREFIX}/*`, async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (presented.length === 0 || !sameToken(presented, token)) {
      c.header("www-authenticate", 'Bearer realm="admin"');
      return c.json(errorBody("admin.unauthorized", "A valid admin token is required."), 401);
    }
    c.header("cache-control", "no-store");
    await next();
  });

  /** The address after `prefix` in the request path, as the operator wrote it. */
  const addressAfter = (url: string, prefix: string): string =>
    decodeURIComponent(new URL(url).pathname.slice(prefix.length));

  /** What the operator did wrong, as a status and a body; anything else is ours to look at. */
  const refused = (c: Context<AppEnv>, error: unknown): Response => {
    if (error instanceof ShowcaseError) {
      const extra = error.problems.length === 0 ? {} : { problems: error.problems };
      const status = error.code === "media.unsupported_type" ? 415 : 400;
      return c.json(errorBody(error.code, error.message, extra), status);
    }
    if (error instanceof OperatorListError) {
      return c.json(errorBody(error.code, error.message), 400);
    }
    throw error;
  };

  app.get(`${ADMIN_PREFIX}/repositories`, async (c) => {
    const wanted = c.req.query("kind");
    const kind = wanted === undefined ? undefined : kindOf(wanted);
    if (wanted !== undefined && kind === undefined) {
      return c.json(
        errorBody("admin.invalid_kind", "kind must be verified, featured or blocked."),
        400,
      );
    }
    const items = (await lists.all(kind)).map((entry) => ({
      kind: entry.kind,
      address: entry.address,
      createdAt: entry.createdAt.toISOString(),
    }));
    return c.json({ items });
  });

  for (const method of ["put", "delete"] as const) {
    app[method](`${ADMIN_PREFIX}/repositories/:kind/*`, async (c) => {
      const kind = kindOf(c.req.param("kind"));
      if (kind === undefined) {
        return c.json(
          errorBody("admin.invalid_kind", "kind must be verified, featured or blocked."),
          404,
        );
      }
      const written = addressAfter(c.req.url, `${ADMIN_PREFIX}/repositories/${kind}`);
      try {
        if (method === "put") {
          const address = await lists.add(kind, written);
          logger.info(
            { kind, address, requestId: c.get("requestId") },
            "operator list entry added",
          );
          return c.json({ kind, address }, 200);
        }
        const removed = await lists.remove(kind, written);
        logger.info(
          { kind, address: written, removed, requestId: c.get("requestId") },
          "operator list entry removed",
        );
        return removed
          ? c.json({ kind, address: written, removed: true })
          : c.json(errorBody("admin.not_listed", "No such entry."), 404);
      } catch (error) {
        return refused(c, error);
      }
    });
  }

  // The landing showcase: entries by name, made of uploads by hash.
  app.get(`${ADMIN_PREFIX}/showcase`, async (c) => c.json(await showcase.list()));

  app.put(
    `${ADMIN_PREFIX}/showcase/:id`,
    bodyLimit({
      maxSize: MAX_ENTRY_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(errorBody("showcase.invalid", "The body is not JSON."), 400);
      }
      try {
        const entry = await showcase.put(c.req.param("id"), body);
        logger.info({ entry: entry.id, requestId: c.get("requestId") }, "showcase entry written");
        return c.json(entry);
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.delete(`${ADMIN_PREFIX}/showcase/:id`, async (c) => {
    const id = c.req.param("id");
    const removed = await showcase.remove(id);
    logger.info({ entry: id, removed, requestId: c.get("requestId") }, "showcase entry removed");
    return removed
      ? c.json({ id, removed: true })
      : c.json(errorBody("admin.not_found", "No such entry."), 404);
  });

  app.get(`${ADMIN_PREFIX}/media`, async (c) =>
    c.json({
      items: (await showcase.listMedia()).map((upload) => ({
        ...upload,
        createdAt: upload.createdAt.toISOString(),
      })),
    }),
  );

  app.post(
    `${ADMIN_PREFIX}/media`,
    bodyLimit({
      maxSize: MAX_MEDIA_BYTES,
      onError: (c) =>
        c.json(
          errorBody("media.too_large", `An upload has at most ${MAX_MEDIA_BYTES} bytes.`),
          413,
        ),
    }),
    async (c) => {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      try {
        const uploaded = await showcase.addMedia(bytes, c.req.header("content-type") ?? "");
        logger.info(
          { sha: uploaded.sha, size: uploaded.size, requestId: c.get("requestId") },
          "media uploaded",
        );
        return c.json(uploaded);
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.delete(`${ADMIN_PREFIX}/media/:sha`, async (c) => {
    const sha = c.req.param("sha");
    const outcome = await showcase.removeMedia(sha);
    logger.info({ sha, outcome, requestId: c.get("requestId") }, "media removal");
    switch (outcome) {
      case "removed":
        return c.json({ sha, removed: true });
      case "in_use":
        return c.json(errorBody("media.in_use", "A showcase entry still shows the upload."), 409);
      default:
        return c.json(errorBody("admin.not_found", "No such upload."), 404);
    }
  });

  app.post(`${ADMIN_PREFIX}/purge/*`, async (c) => {
    const written = addressAfter(c.req.url, `${ADMIN_PREFIX}/purge`);
    try {
      const address = OperatorLists.addressOf("blocked", written);
      const result = await dependencies.purge(`/${address.host}/${address.owner}/${address.repo}`);
      logger.info({ address: written, result, requestId: c.get("requestId") }, "repository purged");
      return result === undefined
        ? c.json(errorBody("admin.unknown_repository", "The repository was never indexed."), 404)
        : c.json(result);
    } catch (error) {
      return refused(c, error);
    }
  });
}

/** Removes what a repository's address names from the index; see `purgeRepository`. */
export function purgeByAddress(database: Parameters<typeof purgeRepository>[0]) {
  return async (address: string) => {
    const parsed = OperatorLists.addressOf("blocked", address);
    return purgeRepository(database, { host: parsed.host, owner: parsed.owner, repo: parsed.repo });
  };
}
