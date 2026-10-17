import {
  type Address,
  accountAvatarUrl,
  formatAddress,
  type IndexNotReady,
  isLegalDocumentKind,
  type LegalDocumentKind,
  type MountOverview,
  parseOwnerPath,
  parseRepoPath,
  REST_FEATURED_SKILL_NAMES,
  REST_ROUTES,
  type RestFeatured,
  type RestLegalDocument,
  type RestMount,
  type RestRepository,
  type RestShowcase,
  rawFileUrl,
  mountBody as restMountBody,
  restRepoTranslations,
} from "@skillcdn/core";
import { type Reader, ReaderInputError } from "@skillcdn/reader";
import { errorBody, hostFailure, registerAddressRoutes } from "@skillcdn/serve";
import type { Context, Hono } from "hono";
import * as z from "zod";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";
import { OwnerNotFoundError, type OwnerService } from "../owners/owner-service.js";
import type { AppEnv } from "./request-context.js";

export interface RestDependencies {
  readonly reader: Reader<Mount>;
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

/** The git host pages an account's listing; it stops long before this. */
const ownerQuery = z.object({ page: z.coerce.number().int().min(1).max(100).optional() });
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
  answer: IndexNotReady | { readonly status: "ready"; readonly overview: MountOverview },
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

export { CORS_MAX_AGE_SECONDS, errorBody, hostFailure } from "@skillcdn/serve";

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

  // The routes that read an address are the serve package's, over this deployment's reader,
  // for whoever mountAt says the request is for.
  registerAddressRoutes(app, {
    reader,
    logger,
    mountAt,
    mountBody,
    requestFields: (c) => ({ requestId: c.get("requestId") }),
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
