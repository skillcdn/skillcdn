import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_MEDIA_BYTES } from "@skillcdn/core";
import { OPERATOR_LIST_KINDS, type OperatorListKind, purgeRepository } from "@skillcdn/db";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as z from "zod";
import { DEFAULT_REPOSITORIES, type EmbeddingReads, MAX_REPOSITORIES } from "../jobs/reads.js";
import type { Logger } from "../logger.js";
import { OperatorImageError, type OperatorImages } from "../operator/images.js";
import { LegalDocumentError, LegalDocuments } from "../operator/legal.js";
import { OperatorListError, OperatorLists } from "../operator/lists.js";
import { type Showcase, ShowcaseError } from "../operator/showcase.js";
import {
  DEFAULT_LIMIT,
  daysInRange,
  MAX_LIMIT,
  MAX_RANGE_DAYS,
  parseUsageDay,
  type UsageRange,
  type UsageReads,
} from "../stats/usage-reads.js";
import type { AppEnv } from "./request-context.js";
import { errorBody } from "./rest.js";

/**
 * The admin API (ADR-0026, ADR-0028, ADR-0029, ADR-0031): the operator's lists, the landing
 * showcase with its uploads, the pictures of addresses, the deployment's own pages, the
 * takedown, and the usage statistics, behind one bearer token. It exists only when a token is
 * configured; otherwise the paths are nothing, like any other.
 */
export interface AdminDependencies {
  readonly token: string;
  readonly lists: OperatorLists;
  readonly showcase: Showcase;
  readonly images: OperatorImages;
  readonly legal: LegalDocuments;
  readonly purge: (address: string) => Promise<{ snapshots: number; blobs: number } | undefined>;
  readonly usage: UsageReads;
  /** The search by meaning: its state, where the embedding went, what it took, and what the operator asks of it (ADR-0064). */
  readonly embeddings: EmbeddingReads;
  readonly logger: Logger;
}

const usageMetric = z.enum(["connection", "tool_call", "skill_load", "file_read", "client"]);
const subjectMetric = z.enum(["tool_call", "skill_load", "file_read"]);
const usageLimit = z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT);

export const ADMIN_PREFIX = "/admin/v1";

/** An entry is a document of words in a few languages; this is far more than any needs. */
const MAX_ENTRY_BYTES = 256 * 1024;
/** A policy in a few languages; far more than any needs. */
const MAX_DOCUMENT_BYTES = 1024 * 1024;
/** Two thousand vectors of a thousand numbers, written out. */
const MAX_IMPORT_BYTES = 48 * 1024 * 1024;
const repositoriesLimit = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_REPOSITORIES)
  .default(DEFAULT_REPOSITORIES);

/** Equal without leaking how far the comparison got; the hashes make the lengths equal. */
function sameToken(presented: string, expected: string): boolean {
  const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

function kindOf(value: string): OperatorListKind | undefined {
  return OPERATOR_LIST_KINDS.find((kind) => kind === value);
}

export function registerAdmin(app: Hono<AppEnv>, dependencies: AdminDependencies): void {
  const { token, lists, showcase, images, legal, usage, embeddings, logger } = dependencies;

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
    if (error instanceof LegalDocumentError) {
      const extra = error.problems.length === 0 ? {} : { problems: error.problems };
      const status = error.code === "legal.invalid_kind" ? 404 : 400;
      return c.json(errorBody(error.code, error.message, extra), status);
    }
    if (error instanceof OperatorImageError) {
      const extra = error.problems.length === 0 ? {} : { problems: error.problems };
      return c.json(errorBody(error.code, error.message, extra), 400);
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

  // The organizations named beside the showcase: by name, each with an upload as its mark.
  app.get(`${ADMIN_PREFIX}/organizations`, async (c) =>
    c.json({ items: (await showcase.list()).organizations ?? [] }),
  );

  app.put(
    `${ADMIN_PREFIX}/organizations/:id`,
    bodyLimit({
      maxSize: MAX_ENTRY_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(errorBody("organization.invalid", "The body is not JSON."), 400);
      }
      try {
        const organization = await showcase.putOrganization(c.req.param("id"), body);
        logger.info(
          { organization: organization.id, requestId: c.get("requestId") },
          "organization written",
        );
        return c.json(organization);
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.delete(`${ADMIN_PREFIX}/organizations/:id`, async (c) => {
    const id = c.req.param("id");
    const removed = await showcase.removeOrganization(id);
    logger.info(
      { organization: id, removed, requestId: c.get("requestId") },
      "organization removed",
    );
    return removed
      ? c.json({ id, removed: true })
      : c.json(errorBody("admin.not_found", "No such organization."), 404);
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
        return c.json(
          errorBody(
            "media.in_use",
            "A showcase entry, an organization or the picture of an address still uses the upload.",
          ),
          409,
        );
      default:
        return c.json(errorBody("admin.not_found", "No such upload."), 404);
    }
  });

  // The pictures of addresses (ADR-0031): shown in place of what a repository declares.
  app.get(`${ADMIN_PREFIX}/images`, async (c) => c.json({ items: await images.all() }));

  app.put(
    `${ADMIN_PREFIX}/images/*`,
    bodyLimit({
      maxSize: MAX_ENTRY_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      const written = addressAfter(c.req.url, `${ADMIN_PREFIX}/images`);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(errorBody("image.invalid", "The body is not JSON."), 400);
      }
      try {
        const image = await images.put(written, body);
        logger.info(
          { address: image.address, requestId: c.get("requestId") },
          "operator image written",
        );
        return c.json(image);
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.delete(`${ADMIN_PREFIX}/images/*`, async (c) => {
    const written = addressAfter(c.req.url, `${ADMIN_PREFIX}/images`);
    try {
      const { address, removed } = await images.remove(written);
      logger.info({ address, removed, requestId: c.get("requestId") }, "operator image removed");
      return removed
        ? c.json({ address, removed: true })
        : c.json(errorBody("admin.not_found", "No such picture."), 404);
    } catch (error) {
      return refused(c, error);
    }
  });

  // The deployment's own pages: its terms of service and its privacy policy (ADR-0029).
  app.get(`${ADMIN_PREFIX}/legal`, async (c) => c.json({ items: await legal.all() }));

  app.put(
    `${ADMIN_PREFIX}/legal/:kind`,
    bodyLimit({
      maxSize: MAX_DOCUMENT_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(errorBody("legal.invalid", "The body is not JSON."), 400);
      }
      try {
        const kind = LegalDocuments.kindOf(c.req.param("kind"));
        const document = await legal.put(kind, body);
        logger.info({ kind, requestId: c.get("requestId") }, "legal document written");
        return c.json(document);
      } catch (error) {
        return refused(c, error);
      }
    },
  );

  app.delete(`${ADMIN_PREFIX}/legal/:kind`, async (c) => {
    try {
      const kind = LegalDocuments.kindOf(c.req.param("kind"));
      const removed = await legal.remove(kind);
      logger.info({ kind, removed, requestId: c.get("requestId") }, "legal document removed");
      return removed
        ? c.json({ kind, removed: true })
        : c.json(errorBody("admin.not_found", "No such document."), 404);
    } catch (error) {
      return refused(c, error);
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

  // The usage statistics (docs/architecture.md): the deployment's totals per day, the rankings
  // of public repositories and of their skills, files and tools, and one repository. Every
  // read is bounded in days and in rows, and what is wrong with a request is said.

  /** The days a request asks for, or the default; a response says what is wrong with them. */
  const rangeOf = (c: Context<AppEnv>): UsageRange | Response => {
    const fallback = usage.defaultRange();
    const from = c.req.query("from");
    const to = c.req.query("to");
    const range = {
      from: from === undefined ? fallback.from : parseUsageDay(from),
      to: to === undefined ? fallback.to : parseUsageDay(to),
    };
    if (range.from === undefined || range.to === undefined) {
      return c.json(
        errorBody("usage.invalid_range", "from and to are days written as YYYY-MM-DD."),
        400,
      );
    }
    const days = daysInRange({ from: range.from, to: range.to });
    if (days < 1 || days > MAX_RANGE_DAYS) {
      return c.json(
        errorBody(
          "usage.invalid_range",
          `from comes before to, and they are at most ${MAX_RANGE_DAYS} days apart.`,
        ),
        400,
      );
    }
    return { from: range.from, to: range.to };
  };
  const invalidMetric = (c: Context<AppEnv>, options: readonly string[]): Response =>
    c.json(errorBody("usage.invalid_metric", `metric is one of ${options.join(", ")}.`), 400);
  const invalidLimit = (c: Context<AppEnv>): Response =>
    c.json(errorBody("usage.invalid_limit", `limit is a number from 1 to ${MAX_LIMIT}.`), 400);

  app.get(`${ADMIN_PREFIX}/usage`, async (c) => {
    const range = rangeOf(c);
    if (range instanceof Response) {
      return range;
    }
    return c.json({ ...range, items: await usage.service(range) });
  });

  app.get(`${ADMIN_PREFIX}/usage/repositories`, async (c) => {
    const metric = usageMetric.safeParse(c.req.query("metric"));
    if (!metric.success) {
      return invalidMetric(c, usageMetric.options);
    }
    const limit = usageLimit.safeParse(c.req.query("limit"));
    if (!limit.success) {
      return invalidLimit(c);
    }
    const range = rangeOf(c);
    if (range instanceof Response) {
      return range;
    }
    const items = await usage.repositories({ metric: metric.data, range, limit: limit.data });
    return c.json({ ...range, metric: metric.data, items });
  });

  app.get(`${ADMIN_PREFIX}/usage/subjects`, async (c) => {
    const metric = subjectMetric.safeParse(c.req.query("metric"));
    if (!metric.success) {
      return invalidMetric(c, subjectMetric.options);
    }
    const limit = usageLimit.safeParse(c.req.query("limit"));
    if (!limit.success) {
      return invalidLimit(c);
    }
    const range = rangeOf(c);
    if (range instanceof Response) {
      return range;
    }
    const items = await usage.subjects({ metric: metric.data, range, limit: limit.data });
    return c.json({ ...range, metric: metric.data, items });
  });

  app.get(`${ADMIN_PREFIX}/usage/*`, async (c) => {
    const written = addressAfter(c.req.url, `${ADMIN_PREFIX}/usage`);
    const range = rangeOf(c);
    if (range instanceof Response) {
      return range;
    }
    try {
      const found = await usage.repository(written, range);
      // Unknown and not public read the same, as everywhere.
      return found === undefined
        ? c.json(
            errorBody("usage.unknown_repository", "No public repository of that name is counted."),
            404,
          )
        : c.json({ address: found.address, ...range, items: found.items });
    } catch (error) {
      return refused(c, error);
    }
  });

  // The search by meaning (ADR-0064, point 5): how it stands, where the embedding went and what
  // it took, a repository indexed on request, and vectors computed elsewhere brought in.
  app.get(`${ADMIN_PREFIX}/embeddings`, async (c) => {
    const state = await embeddings.state();
    return c.json({
      ...state,
      failures:
        state.failures === null
          ? null
          : state.failures.map((failure) => ({
              ...failure,
              createdAt: failure.createdAt.toISOString(),
              failedAt: failure.failedAt?.toISOString() ?? null,
              error: failure.error ?? null,
            })),
    });
  });

  app.get(`${ADMIN_PREFIX}/embeddings/repositories`, async (c) => {
    const limit = repositoriesLimit.safeParse(c.req.query("limit"));
    if (!limit.success) {
      return c.json(
        errorBody("usage.invalid_limit", `limit is a number from 1 to ${MAX_REPOSITORIES}.`),
        400,
      );
    }
    const items = (await embeddings.repositories(limit.data)).map((item) => ({
      ...item,
      lastEmbeddedAt: item.lastEmbeddedAt.toISOString(),
    }));
    return c.json({ items });
  });

  app.get(`${ADMIN_PREFIX}/embeddings/usage`, async (c) => {
    const range = rangeOf(c);
    if (range instanceof Response) {
      return range;
    }
    return c.json({ ...range, items: await embeddings.usage(range.from, range.to) });
  });

  app.post(`${ADMIN_PREFIX}/embeddings/index/*`, async (c) => {
    const written = addressAfter(c.req.url, `${ADMIN_PREFIX}/embeddings/index`);
    const outcome = await embeddings.designate(written);
    if (outcome === "invalid") {
      return c.json(
        errorBody(
          "embeddings.invalid_address",
          "The address names a repository of a git host, with a ref at most: /gh/owner/repo[@ref].",
        ),
        400,
      );
    }
    if (outcome === "unavailable") {
      return c.json(
        errorBody(
          "embeddings.unavailable",
          "This process has no job queue to ask the worker with.",
        ),
        503,
      );
    }
    logger.info(
      { ...outcome, requestId: c.get("requestId") },
      "repository designated for indexing",
    );
    return c.json(outcome, 202);
  });

  app.post(
    `${ADMIN_PREFIX}/embeddings/import`,
    bodyLimit({
      maxSize: MAX_IMPORT_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(errorBody("embeddings.invalid", "The body is not JSON."), 400);
      }
      const outcome = await embeddings.importVectors(body);
      switch (outcome.status) {
        case "written":
          logger.info(
            { written: outcome.written, skipped: outcome.skipped, requestId: c.get("requestId") },
            "vectors imported",
          );
          return c.json({ written: outcome.written, skipped: outcome.skipped });
        case "unavailable":
          return c.json(
            errorBody(
              "embeddings.unavailable",
              "The search by meaning is not configured here, or the database keeps no vectors.",
            ),
            503,
          );
        case "invalid":
          return c.json(
            errorBody("embeddings.invalid", "The body is not an import of vectors.", {
              problems: outcome.problems,
            }),
            400,
          );
        case "other_key":
          return c.json(
            errorBody(
              "embeddings.other_model",
              "The vectors are of another model, dimensions or sectioning rules than this deployment embeds with.",
              { key: outcome.key },
            ),
            409,
          );
        case "unknown_bodies":
          return c.json(
            errorBody(
              "embeddings.unknown_bodies",
              "Some bodies are not stored here; a vector is kept only for a body an index names.",
              { blobShas: outcome.blobShas },
            ),
            400,
          );
      }
    },
  );
}

/** Removes what a repository's address names from the index; see `purgeRepository`. */
export function purgeByAddress(database: Parameters<typeof purgeRepository>[0]) {
  return async (address: string) => {
    const parsed = OperatorLists.addressOf("blocked", address);
    return purgeRepository(database, { host: parsed.host, owner: parsed.owner, repo: parsed.repo });
  };
}
