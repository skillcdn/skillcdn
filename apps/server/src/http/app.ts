import { createHash } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  ACCOUNT_PAGE_PATH,
  type Address,
  accountAvatarUrl,
  BADGE_ROUTE,
  type Clock,
  CONSENT_PAGE_PATH,
  formatAddress,
  formatOwnerPath,
  type GitHostEventSource,
  type GitHostLogin,
  ICON_ROUTE,
  ICON_SIZE,
  LEGAL_DOCUMENT_KINDS,
  LEGAL_PAGE_PATHS,
  type LegalDocumentKind,
  MAX_QUERY_LENGTH,
  MAX_REPO_PATH_LENGTH,
  MEDIA_ROUTE,
  parseAddress,
  parseOwnerPath,
  REPO_TOKEN_PREFIX,
  REST_MOUNT_LIST_LIMIT,
  type RestMount,
  type RestShowcase,
  type RestSkill,
  renderBrandBadge,
  SOCIAL_ROUTE,
} from "@skillcdn/core";
import { type Database, getSchemaStatus, type UserRecord } from "@skillcdn/db";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import * as z from "zod";
import { CredentialsLostError, type UserCredentials } from "../auth/credentials.js";
import type { Login } from "../auth/login.js";
import {
  type AuthorizationServer,
  type BearerOutcome,
  INVALID_TOKEN_DESCRIPTION,
} from "../auth/oauth/authorization-server.js";
import type { OAuthClients } from "../auth/oauth/clients.js";
import type { RepoTokens } from "../auth/repo-tokens.js";
import type { Sessions } from "../auth/sessions.js";
import type { HostEvents } from "../events/host-events.js";
import type { SnapshotService } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import { createMountServer, type ToolDependencies } from "../mcp/tools.js";
import { ReaderInputError } from "../mounts/continuation.js";
import type { MountReader } from "../mounts/mount-reader.js";
import { type Mount, MountError, type MountService, type Viewer } from "../mounts/mount-service.js";
import type { OperatorImages } from "../operator/images.js";
import type { LegalDocuments } from "../operator/legal.js";
import type { OperatorLists } from "../operator/lists.js";
import type { Showcase } from "../operator/showcase.js";
import { OwnerNotFoundError, type OwnerService } from "../owners/owner-service.js";
import type { SocialCards } from "../social/cards.js";
import { type PictureFetcher, rasterImageType } from "../social/pictures.js";
import { purgeByAddress, registerAdmin } from "./admin.js";
import { registerAuth } from "./auth.js";
import type { ClientAddressResolver } from "./client-address.js";
import { type AppEnv, requestContext } from "./request-context.js";
import {
  browseBody,
  CORS_MAX_AGE_SECONDS,
  findBody,
  hostFailure,
  mountBody,
  registerRest,
  skillOutcome,
} from "./rest.js";
import {
  type AddressData,
  bytesResponse,
  type WebBundle,
  type WebRequest,
  wantsHtml,
} from "./web.js";
import { registerWebhooks } from "./webhooks.js";

/** What signing in is made of, on a deployment where people can (docs/specs/permissions.md). */
export interface AppAuth {
  /** The origin people use: where tokens are issued, and where the git host sends people back. */
  readonly origin: string;
  readonly sessions: Sessions;
  readonly login: Login;
  readonly authorization: AuthorizationServer;
  readonly clients: OAuthClients;
  /** The tokens people make for agents that have nobody to sign in. */
  readonly tokens: RepoTokens;
  readonly credentials: UserCredentials;
  readonly hostLogin: GitHostLogin;
  readonly clock: Clock;
}

export interface AppDependencies {
  readonly database: Database;
  /** Signing in and what stands on it. Left out, nobody signs in and every request is nobody's. */
  readonly auth: AppAuth | undefined;
  /**
   * The git host's events and what applies them (ADR-0038). Left out, the deployment receives
   * none, and what it remembers ends when its time is up.
   */
  readonly webhooks:
    | { readonly source: GitHostEventSource; readonly events: HostEvents }
    | undefined;
  /** The pages of accounts; left out where the git host's directory is not wired. */
  readonly owners: OwnerService | undefined;
  readonly mounts: MountService;
  readonly snapshots: SnapshotService;
  readonly reader: MountReader;
  readonly tools: ToolDependencies;
  /** The operator's lists: what is featured, vouched for and blocked (ADR-0026). */
  readonly lists: OperatorLists;
  /** The landing showcase and its uploads (ADR-0028). */
  readonly showcase: Showcase;
  /** The pictures the operator gives addresses (ADR-0031). */
  readonly images: OperatorImages;
  /** The deployment's own pages: its terms and its privacy policy (ADR-0029). */
  readonly legal: LegalDocuments;
  /** The admin API, when a token is configured; without one it does not exist. */
  readonly admin: { readonly token: string } | undefined;
  /** A build of the web UI to serve. Left out, the server is MCP and REST only. */
  readonly web: WebBundle | undefined;
  /** Draws the social previews of addresses (ADR-0032); nothing to draw without the web UI. */
  readonly social: SocialCards | undefined;
  /** Fetches the owner's picture from the git host, for the icon of an address's MCP server. */
  readonly pictures: PictureFetcher;
  readonly logger: Logger;
  readonly requests: {
    readonly addresses: ClientAddressResolver;
    readonly requestIdHeader: string;
    readonly accessLog: boolean;
    readonly newRequestId: () => string;
    readonly now: () => number;
  };
  /** True once shutdown has begun: readiness fails so that the platform stops sending traffic. */
  readonly isShuttingDown: () => boolean;
}

/** JSON-RPC messages are small. This is the ceiling for anything a client may send. */
const MAX_REQUEST_BYTES = 1024 * 1024;
/** The header under which the route names a request to the MCP handler; never a client's to set. */
const RESOLVED_HEADER = "x-skillcdn-resolved";
const pageQuery = z.object({
  skill: z.string().min(1).max(MAX_REPO_PATH_LENGTH).optional(),
  file: z.string().min(1).max(MAX_REPO_PATH_LENGTH).optional(),
  path: z.string().max(MAX_REPO_PATH_LENGTH).optional(),
  q: z.string().max(MAX_QUERY_LENGTH).optional(),
  query: z.string().max(MAX_QUERY_LENGTH).optional(),
});

const STATUS_BY_REASON = {
  repo_not_found: 404,
  ref_not_found: 404,
  not_allowed: 403,
  rate_limited: 503,
  unavailable: 503,
} as const;

/**
 * The sitemap lists the pages of the build, the featured addresses and the repositories the
 * operator vouches for (ADR-0026): asking for an address puts nothing into it.
 */
const SITEMAP_CACHE_MS = 10 * 60_000;

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const { database, mounts, snapshots, reader, tools, logger, isShuttingDown, web } = dependencies;
  const { auth } = dependencies;
  /** Where the pages of this deployment are, as far as a request can tell. */
  const originOf = (url: string): string => tools.publicUrl ?? new URL(url).origin;
  const webRequestOf = (c: Context<AppEnv>): WebRequest => ({
    method: c.req.method,
    url: new URL(c.req.url),
    headers: c.req.raw.headers,
  });
  /** The deployment's own pages that have been written (ADR-0029); none when unreadable. */
  const writtenPages = async (): Promise<readonly LegalDocumentKind[]> => {
    try {
      return await dependencies.legal.written();
    } catch (error) {
      logger.warn({ err: error }, "the deployment's own pages could not be read");
      return [];
    }
  };
  /** A request that may be answered with a page, which links to the deployment's own pages. */
  const pageRequestOf = async (c: Context<AppEnv>): Promise<WebRequest> => ({
    ...webRequestOf(c),
    legal: await writtenPages(),
  });
  const app = new Hono<AppEnv>();
  app.use(requestContext({ logger, ...dependencies.requests }));

  // The MCP handler builds a server per request. The mount it serves is resolved by the route
  // below before the handler runs, for whoever the request is for, and handed over through this
  // map: the route gives the request a key of its own making in a header, which is how the
  // handler's copy of the request still names it. Whatever a client sent under that name is
  // overwritten, so a key is never one a client chose.
  const resolvedFor = new Map<string, { mount: Mount; requestId: string; origin: string }>();
  const mcp = createMcpHandler(
    async (context) => {
      const request = context.requestInfo;
      const key = request?.headers.get(RESOLVED_HEADER);
      const resolved = key === null || key === undefined ? undefined : resolvedFor.get(key);
      let mount = resolved?.mount;
      if (mount === undefined && request !== undefined) {
        // Nothing was handed over: resolved as nobody in particular, which is what is public.
        const parsed = parseAddress(new URL(request.url).pathname);
        mount = parsed.ok ? await mounts.resolve(parsed.value) : undefined;
      }
      if (mount === undefined || request === undefined) {
        throw new Error("no mount was resolved for this request");
      }
      return await createMountServer(
        mount,
        { ...tools, logger: tools.logger.child({ requestId: resolved?.requestId }) },
        { origin: resolved?.origin ?? originOf(request.url) },
      );
    },
    {
      onerror: (error) => logger.warn({ err: error }, "mcp handler error"),
    },
  );

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.get("/readyz", async (c) => {
    c.header("cache-control", "no-store");
    if (isShuttingDown()) {
      return c.json({ status: "shutting_down" }, 503);
    }
    if (!(await database.ping())) {
      return c.json({ status: "database_unreachable" }, 503);
    }
    const schema = await getSchemaStatus(database);
    return schema.current
      ? c.json({ status: "ready" })
      : c.json({ status: "schema_behind", expected: schema.expected }, 503);
  });

  const startIndexing = (mount: Mount): void => {
    snapshots.warm(mount).catch((error: unknown) => {
      logger.warn(
        { err: error, address: formatAddress(mount.address) },
        "could not start indexing",
      );
    });
  };

  /**
   * Who a page or a REST request is for: whoever its cookie says is signed in. A request that
   * carries no session is nobody's and has no viewer; one that does is only asked whose it is
   * when it matters, which for a repository known to be public is never.
   */
  const sessionViewer = (c: Context<AppEnv>): Viewer | undefined => {
    const cookie = c.req.header("cookie");
    return auth?.sessions.carriedBy(cookie) === true
      ? () => auth.sessions.resolve(cookie)
      : undefined;
  };

  /**
   * Resolves an address for the pages and the REST API. A person the git host no longer vouches
   * for is nobody, and to nobody what is not public does not exist.
   */
  const resolveFor = async (address: Address, viewer: Viewer | undefined): Promise<Mount> => {
    try {
      return await mounts.resolve(address, viewer);
    } catch (error) {
      if (error instanceof CredentialsLostError) {
        throw new MountError("repo_not_found", "The repository was not found.", { cause: error });
      }
      throw error;
    }
  };

  /** The answer to an address that did not resolve, as the REST API and MCP give it. */
  const resolutionFailure = (c: Context<AppEnv>, address: Address, error: unknown): Response => {
    if (error instanceof MountError) {
      if (error.retryAfterSeconds !== undefined) {
        c.header("retry-after", String(error.retryAfterSeconds));
      }
      // Missing and forbidden repositories share one code and one message.
      return c.json(errorBody(error.code, error.detail), STATUS_BY_REASON[error.reason]);
    }
    logger.error(
      { err: error, address: formatAddress(address), requestId: c.get("requestId") },
      "mount resolution failed",
    );
    return c.json(errorBody("internal", "The request could not be served."), 500);
  };

  /**
   * Resolves the address in the request path after `prefix`, or answers with the error. Asking
   * about an address is enough to start indexing it, so the next question finds it done or underway.
   */
  const mountAt = async (c: Context<AppEnv>, prefix: string): Promise<Mount | Response> => {
    // The raw path, percent-escapes included: the address parser decodes exactly once.
    const parsed = parseAddress(new URL(c.req.url).pathname.slice(prefix.length));
    if (!parsed.ok) {
      return c.json(errorBody(`address.${parsed.error.code}`, parsed.error.message), 400);
    }
    const address = parsed.value;
    try {
      const mount = await resolveFor(address, sessionViewer(c));
      startIndexing(mount);
      return mount;
    } catch (error) {
      return resolutionFailure(c, address, error);
    }
  };

  /**
   * Resolves the address of an MCP request for whoever its access token stands for. A token is
   * optional: without one, what is public is served as it always was. What is not public is
   * answered with a challenge that says where to ask for access (docs/specs/permissions.md), and
   * so is a name that is nothing at all, because nobody in particular may learn which it is.
   */
  const mcpMountAt = async (c: Context<AppEnv>): Promise<Mount | Response> => {
    const path = new URL(c.req.url).pathname;
    const parsed = parseAddress(path);
    if (!parsed.ok) {
      return c.json(errorBody(`address.${parsed.error.code}`, parsed.error.message), 400);
    }
    const address = parsed.value;
    let user: UserRecord | undefined;
    try {
      if (auth === undefined) {
        const mount = await mounts.resolve(address);
        startIndexing(mount);
        return mount;
      }
      const challenge = (
        code: string,
        message: string,
        error?: { readonly code: string; readonly description: string },
      ): Response => {
        c.header("www-authenticate", auth.authorization.challenge(path, error));
        c.header("cache-control", "no-store");
        return c.json(errorBody(code, message), 401);
      };
      // A credential that is no good stands for nobody. What everyone is served needs none and
      // is served all the same; anything else then says that the credential is no good.
      const header = c.req.header("authorization");
      const presented = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "")?.[1];
      let bearer: BearerOutcome;
      // A token made for a repository is good at every address of it, and of nothing else.
      let onlyRepo: string | undefined;
      if (presented?.startsWith(REPO_TOKEN_PREFIX) === true) {
        const access = await auth.tokens.verify(presented, address);
        bearer =
          access === undefined
            ? { status: "invalid", description: INVALID_TOKEN_DESCRIPTION }
            : { status: "valid", user: access.user };
        onlyRepo = access?.repoId;
      } else {
        bearer = await auth.authorization.verify(header, address);
      }
      user = bearer.status === "valid" ? bearer.user : undefined;
      try {
        const viewer = user;
        const mount = await mounts.resolve(
          address,
          viewer === undefined ? undefined : async () => viewer,
        );
        // The name the token was made under means another repository by now: the token is not
        // this repository's. What everyone is served is served all the same.
        if (
          onlyRepo !== undefined &&
          onlyRepo !== mount.repo.id &&
          mount.repo.repository.visibility !== "public"
        ) {
          return challenge("auth.invalid_token", INVALID_TOKEN_DESCRIPTION, {
            code: "invalid_token",
            description: INVALID_TOKEN_DESCRIPTION,
          });
        }
        startIndexing(mount);
        return mount;
      } catch (error) {
        if (error instanceof CredentialsLostError) {
          const description = "Sign in again: the git host no longer accepts this account.";
          return challenge("auth.invalid_token", description, {
            code: "invalid_token",
            description,
          });
        }
        if (
          error instanceof MountError &&
          error.reason === "repo_not_found" &&
          user === undefined
        ) {
          return bearer.status === "invalid"
            ? challenge("auth.invalid_token", bearer.description, {
                code: "invalid_token",
                description: bearer.description,
              })
            : challenge(
                "auth.required",
                "This address is not public, or does not exist. Sign in to connect to a private repository.",
              );
        }
        throw error;
      }
    } catch (error) {
      return resolutionFailure(c, address, error);
    }
  };

  registerRest(app, {
    reader,
    logger,
    mountAt,
    mountOf: async (address) => {
      try {
        const mount = await mounts.resolve(address);
        startIndexing(mount);
        return mount;
      } catch (error) {
        if (error instanceof MountError) {
          return undefined;
        }
        throw error;
      }
    },
    featured: () => dependencies.lists.featured(),
    showcase: () => dependencies.showcase.list(),
    legal: (kind) => dependencies.legal.get(kind),
    owners: dependencies.owners,
    now: dependencies.requests.now,
  });
  // After the REST API, whose rules for `/api/` (any origin without credentials, nothing
  // cached) then hold for what a signed-in person asks as well.
  if (auth !== undefined) {
    registerAuth(app, {
      ...auth,
      database,
      logger,
      canSee: async (address, user) => {
        try {
          await resolveFor(address, async () => user);
          return true;
        } catch (error) {
          if (error instanceof MountError) {
            // A host that could not be asked says neither yes nor no.
            return error.reason === "rate_limited" || error.reason === "unavailable"
              ? undefined
              : false;
          }
          throw error;
        }
      },
      asksForPermission: (address) => mounts.asksForPermission(address),
      open: (address, user) => resolveFor(address, async () => user),
    });
  }
  if (dependencies.webhooks !== undefined) {
    registerWebhooks(app, { ...dependencies.webhooks, logger });
  }
  if (dependencies.admin !== undefined) {
    registerAdmin(app, {
      token: dependencies.admin.token,
      lists: dependencies.lists,
      showcase: dependencies.showcase,
      images: dependencies.images,
      legal: dependencies.legal,
      purge: purgeByAddress(database),
      logger,
    });
  }

  // An upload of the showcase, named by its content: it never changes, so caches may keep it for
  // as long as they like. The name is checked before the database is asked.
  app.on(["GET", "HEAD"], `${MEDIA_ROUTE}/:sha`, async (c) => {
    const sha = c.req.param("sha");
    const media = await dependencies.showcase.media(sha);
    if (media === undefined) {
      return c.notFound();
    }
    return bytesResponse(webRequestOf(c), {
      bytes: media.bytes,
      contentType: media.contentType,
      etag: `"${sha}"`,
      cacheControl: "public, max-age=31536000, immutable",
    });
  });

  // The social preview of an address (ADR-0032): the picture a link to its page unfurls with,
  // drawn from the words the build writes for the page, with a skill's when one is asked for.
  // Asking for it resolves the address and starts indexing it, as the page does; what the index
  // cannot say yet is left off the card, which is drawn again once it can.
  const socialQuery = z.object({
    skill: z.string().min(1).max(MAX_REPO_PATH_LENGTH).optional(),
  });
  const social = dependencies.social;
  if (web !== undefined && social !== undefined) {
    app.on(["GET", "HEAD"], `${SOCIAL_ROUTE}/*`, async (c) => {
      const request = webRequestOf(c);
      const parsed = parseAddress(request.url.pathname.slice(SOCIAL_ROUTE.length));
      const query = socialQuery.safeParse(c.req.query());
      if (!parsed.ok || !query.success) {
        return c.notFound();
      }
      let mount: Mount;
      try {
        mount = await mounts.resolve(parsed.value);
        startIndexing(mount);
      } catch (error) {
        if (error instanceof MountError) {
          return c.notFound();
        }
        throw error;
      }
      try {
        const body = mountBody(mount, await reader.overview(mount, REST_MOUNT_LIST_LIMIT));
        let skill: RestSkill | undefined;
        if (query.data.skill !== undefined) {
          const outcome = skillOutcome(
            await reader.skill(mount, query.data.skill, 0, undefined, true),
          );
          if (!("body" in outcome)) {
            return c.notFound();
          }
          skill = outcome.body;
        }
        const drawn = web.social(
          request,
          skill === undefined ? { mount: body } : { mount: body, skill },
        );
        if (drawn === undefined) {
          return c.notFound();
        }
        // Everything the card is made from names it: a change to any of it is another card.
        const key = [
          drawn.language,
          body.address,
          mount.commit,
          query.data.skill ?? "",
          body.index.status,
        ].join("\n");
        const response = bytesResponse(request, {
          bytes: await social.picture(key, drawn.card),
          contentType: "image/png",
          etag: `"${createHash("sha1").update(key).digest("hex")}"`,
          cacheControl: "public, max-age=3600",
        });
        if (!drawn.forced) {
          response.headers.set("vary", "accept-language");
        }
        return response;
      } catch (error) {
        if (error instanceof ReaderInputError) {
          return c.notFound();
        }
        const known = hostFailure(error);
        if (known === undefined) {
          throw error;
        }
        return c.json(errorBody(known.code, known.message), known.status as 503);
      }
    });
  }

  // The badge of an address (specs/rest.md): the symbol, the name of the service and how many
  // skills the address serves, as an SVG for the README of the repository. Asking for it
  // resolves the address and starts indexing it, as the page does; until the index is ready the
  // badge says so and is kept only briefly, so that the next look gets the count.
  app.on(["GET", "HEAD"], `${BADGE_ROUTE}/*`, async (c) => {
    const request = webRequestOf(c);
    const parsed = parseAddress(request.url.pathname.slice(BADGE_ROUTE.length));
    if (!parsed.ok) {
      return c.notFound();
    }
    let mount: Mount;
    try {
      mount = await mounts.resolve(parsed.value);
      startIndexing(mount);
    } catch (error) {
      if (error instanceof MountError) {
        return c.notFound();
      }
      throw error;
    }
    try {
      const body = mountBody(mount, await reader.overview(mount, REST_MOUNT_LIST_LIMIT));
      const value = badgeValue(body.index);
      const key = [body.address, mount.commit, value].join("\n");
      return bytesResponse(request, {
        bytes: new TextEncoder().encode(renderBrandBadge(value)),
        contentType: "image/svg+xml; charset=utf-8",
        etag: `"${createHash("sha1").update(key).digest("hex")}"`,
        cacheControl: body.index.status === "ready" ? "public, max-age=3600" : "public, max-age=60",
      });
    } catch (error) {
      if (error instanceof ReaderInputError) {
        return c.notFound();
      }
      const known = hostFailure(error);
      if (known === undefined) {
        throw error;
      }
      return c.json(errorBody(known.code, known.message), known.status as 503);
    }
  });

  // The icon of the MCP server of an address (specs/tools.md): the owner's picture as the git
  // host serves it, at one size, from this origin, because a client fetches a server's icon from
  // the server's own origin and from nowhere else. Fetched without credentials and kept for a
  // while, as the picture of a social preview is, and served only when its bytes are a raster
  // image: what the host answers is not trusted by its headers.
  app.on(["GET", "HEAD"], `${ICON_ROUTE}/*`, async (c) => {
    const request = webRequestOf(c);
    const parsed = parseAddress(request.url.pathname.slice(ICON_ROUTE.length));
    if (!parsed.ok) {
      return c.notFound();
    }
    let mount: Mount;
    try {
      mount = await mounts.resolve(parsed.value);
    } catch (error) {
      if (error instanceof MountError) {
        return c.notFound();
      }
      throw error;
    }
    const owner = mount.repo.repository.owner.hostAccountId;
    const bytes = await dependencies.pictures.get(
      accountAvatarUrl(mount.address.host, owner, ICON_SIZE),
    );
    const type = bytes === undefined ? undefined : rasterImageType(bytes);
    if (bytes === undefined || type === undefined) {
      return c.notFound();
    }
    // The same account's picture at the same size is the same icon, whatever address asked, and
    // a day is soon enough to notice that an account changed its picture.
    const key = `${mount.address.host}:${owner}:${ICON_SIZE}`;
    return bytesResponse(request, {
      bytes,
      contentType: type,
      etag: `"${createHash("sha1").update(key).digest("hex")}"`,
      cacheControl: "public, max-age=86400",
    });
  });

  /**
   * The page of an address for a browser, rendered with what the address serves: the same
   * answers the page would otherwise ask the REST API for, so that a crawler reads what a
   * person sees. Serving the page resolves the address and starts indexing it, like the API.
   */
  const addressPage = async (c: Context<AppEnv>, bundle: WebBundle): Promise<Response> => {
    const request = await pageRequestOf(c);
    // One segment short of an address is the page of an account (ADR-0037): one document for
    // everyone, rendered with what the git host shows everyone, so that a crawler reads what a
    // person sees. Looking at it indexes nothing.
    const { owners } = dependencies;
    const owner = owners === undefined ? undefined : parseOwnerPath(request.url.pathname);
    if (owners !== undefined && owner !== undefined) {
      try {
        return bundle.address(request, { owner: { ready: await owners.page(owner, 1) } });
      } catch (error) {
        if (error instanceof OwnerNotFoundError) {
          return bundle.address(
            request,
            {
              owner: {
                error: {
                  status: 404,
                  code: "owner.not_found",
                  message: "The account was not found.",
                },
              },
            },
            404,
          );
        }
        const known = hostFailure(error);
        if (known === undefined) {
          throw error;
        }
        const { status, code, message } = known;
        return bundle.address(request, { owner: { error: { status, code, message } } }, status);
      }
    }
    const parsed = parseAddress(request.url.pathname);
    if (!parsed.ok) {
      // The page explains what is wrong with the address; the status says it is nothing.
      return bundle.address(request, {}, 404);
    }
    const query = pageQuery.safeParse(c.req.query());
    if (!query.success) {
      return bundle.address(
        request,
        {
          mount: {
            error: {
              status: 400,
              code: "request.invalid",
              message: "Missing or malformed page parameters.",
            },
          },
        },
        400,
      );
    }
    let mount: Mount;
    try {
      mount = await resolveFor(parsed.value, sessionViewer(c));
      startIndexing(mount);
    } catch (error) {
      if (error instanceof MountError) {
        const status = STATUS_BY_REASON[error.reason];
        return bundle.address(
          request,
          { mount: { error: { status, code: error.code, message: error.detail } } },
          status,
        );
      }
      throw error;
    }
    // What is not public was resolved for one person, and the page is theirs alone.
    const forOne = { forOne: mount.repo.repository.visibility !== "public" };
    try {
      const data: {
        mount: AddressData["mount"];
        skill?: AddressData["skill"];
        browse?: AddressData["browse"];
        find?: AddressData["find"];
      } = {
        mount: { ready: mountBody(mount, await reader.overview(mount, REST_MOUNT_LIST_LIMIT)) },
      };
      const wanted = query.data.skill;
      if (wanted !== undefined) {
        const outcome = skillOutcome(await reader.skill(mount, wanted, 0, undefined, true));
        data.skill =
          "body" in outcome
            ? { ready: outcome.body }
            : {
                error: {
                  status: outcome.failure.status,
                  code: outcome.failure.code,
                  message: outcome.failure.message,
                  ...(outcome.failure.directories === undefined
                    ? {}
                    : { directories: outcome.failure.directories }),
                },
              };
      }
      if (wanted === undefined && query.data.file === undefined) {
        const path = query.data.path;
        const search = query.data.q ?? query.data.query;
        if (search !== undefined && search.trim().length > 0)
          data.find = { ready: findBody(await reader.find(mount, { query: search, path }, 0)) };
        else data.browse = { ready: browseBody(await reader.browse(mount, { path }, 0)) };
      }
      return bundle.address(request, data, 200, forOne);
    } catch (error) {
      if (error instanceof ReaderInputError) {
        return bundle.address(
          request,
          {
            mount: { error: { status: 400, code: error.code, message: error.message } },
          },
          400,
          forOne,
        );
      }
      const known = hostFailure(error);
      if (known === undefined) {
        throw error;
      }
      const { status, code, message } = known;
      return bundle.address(
        request,
        { mount: { error: { status, code, message } } },
        status,
        forOne,
      );
    }
  };

  // Read-only, and nobody's unless the request says whose with an access token: a page on any
  // origin may reach the endpoint, as it may reach the REST API. No cookies are involved, so
  // credentials are never allowed; a token travels in a header the page sets itself, and the
  // challenge that asks for one is readable to it.
  app.use(
    "/gh/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: [
        "accept",
        "authorization",
        "content-type",
        "mcp-method",
        "mcp-name",
        "mcp-protocol-version",
        "mcp-session-id",
      ],
      exposeHeaders: [
        "mcp-protocol-version",
        "mcp-session-id",
        "retry-after",
        "www-authenticate",
        "x-request-id",
      ],
      maxAge: CORS_MAX_AGE_SECONDS,
    }),
  );

  app.all(
    "/gh/*",
    bodyLimit({
      maxSize: MAX_REQUEST_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      // An address answers a browser with the explorer and everything else with MCP.
      if (web !== undefined && wantsHtml(webRequestOf(c))) {
        return addressPage(c, web);
      }
      const mount = await mcpMountAt(c);
      if (mount instanceof Response) {
        return mount;
      }
      let body: string | undefined;
      if (c.req.method === "POST") {
        // A JSON-RPC batch would let one request carry thousands of calls, and no protocol
        // revision the server speaks needs one: an array body is refused before the handler.
        body = await c.req.text();
        if (/^\s*\[/.test(body)) {
          return c.json(
            {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32600, message: "JSON-RPC batches are not supported." },
            },
            400,
          );
        }
        // Every MCP message is a POST, whichever protocol revision the client speaks; a client
        // that sent one used this repository today.
        tools.stats.client(mount, c.get("clientAddress"));
      }
      // The handler gets the request under a key of this route's making, and without the access
      // token: who the request is for was settled above, and nothing further on needs the token.
      const key = dependencies.requests.newRequestId();
      const headers = new Headers(c.req.raw.headers);
      headers.set(RESOLVED_HEADER, key);
      headers.delete("authorization");
      const request = new Request(c.req.raw.url, {
        method: c.req.method,
        headers,
        signal: c.req.raw.signal,
        ...(body === undefined ? {} : { body }),
      });
      resolvedFor.set(key, {
        mount,
        requestId: c.get("requestId"),
        origin: originOf(c.req.url),
      });
      try {
        const response = await mcp.fetch(request);
        // A moving ref, or one person's: nothing between us and the client keeps it.
        response.headers.set("cache-control", "no-store");
        return response;
      } finally {
        resolvedFor.delete(key);
      }
    },
  );

  if (web !== undefined) {
    const bundle = web;
    interface Listed {
      readonly addresses: readonly string[];
      /** The pages of the accounts those addresses belong to, each once (ADR-0037). */
      readonly owners: readonly string[];
    }
    let listed: { readonly until: number; readonly entries: Promise<Listed> } | undefined;

    /**
     * What the sitemap lists besides the build's own pages: the featured addresses and the
     * vouched-for repositories, and the pages of the accounts they belong to.
     */
    const listedEntries = async (): Promise<Listed> => {
      try {
        const addresses = await dependencies.lists.listed();
        return {
          addresses: addresses.map(formatAddress),
          owners:
            dependencies.owners === undefined
              ? []
              : [...new Set(addresses.map(({ host, owner }) => formatOwnerPath({ host, owner })))],
        };
      } catch (error) {
        logger.warn({ err: error }, "the operator's lists could not be read for the sitemap");
        return { addresses: [], owners: [] };
      }
    };

    app.get("/sitemap.xml", async (c) => {
      const now = dependencies.requests.now();
      if (listed === undefined || listed.until <= now) {
        listed = { until: now + SITEMAP_CACHE_MS, entries: listedEntries() };
      }
      const request = await pageRequestOf(c);
      const { addresses, owners } = await listed.entries;
      const pages = [...(request.legal ?? []).map((kind) => LEGAL_PAGE_PATHS[kind]), ...owners];
      return bundle.sitemap(request, addresses, pages);
    });

    // The deployment's own pages (ADR-0029): rendered with the document, or with the absence of
    // one, which is a page too, with the status that says so.
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      app.on(["GET", "HEAD"], LEGAL_PAGE_PATHS[kind], async (c) => {
        const request = await pageRequestOf(c);
        const document = await dependencies.legal.get(kind);
        return document === undefined
          ? bundle.legal(
              request,
              kind,
              {
                error: {
                  status: 404,
                  code: "legal.not_found",
                  message: "This page has not been written.",
                },
              },
              404,
            )
          : bundle.legal(request, kind, { ready: document });
      });
    }

    /**
     * The operator's showcase, when there is one (ADR-0028). Without one, and when it cannot be
     * read, the prerendered front page shows the build's own.
     */
    const showcaseAnswer = async (): Promise<{ readonly ready: RestShowcase } | undefined> => {
      try {
        const list = await dependencies.showcase.list();
        return list.items.length === 0 ? undefined : { ready: list };
      } catch (error) {
        logger.warn({ err: error }, "the showcase could not be read for the front page");
        return undefined;
      }
    };
    const withShowcase = async (
      c: Context<AppEnv>,
      render: (
        request: WebRequest,
        showcase: { readonly ready: RestShowcase },
      ) => Response | undefined,
    ): Promise<Response> => {
      const request = await pageRequestOf(c);
      const showcase = await showcaseAnswer();
      const rendered = showcase === undefined ? undefined : render(request, showcase);
      return rendered ?? bundle.respond(request) ?? c.notFound();
    };
    app.on(["GET", "HEAD"], "/", (c) =>
      withShowcase(c, (request, showcase) => bundle.landing(request, showcase)),
    );
    if (auth !== undefined) {
      // The pages of whoever is signed in, and the page that asks them about a client: one
      // document for everyone, which the browser fills in with what the REST API tells it.
      for (const path of [ACCOUNT_PAGE_PATH, `${ACCOUNT_PAGE_PATH}/*`, CONSENT_PAGE_PATH]) {
        app.on(["GET", "HEAD"], path, async (c) => bundle.view(await pageRequestOf(c)));
      }
    }
    app.on(["GET", "HEAD"], "/llms.txt", (c) =>
      withShowcase(c, (request, showcase) => bundle.llmsTxt(request, showcase.ready)),
    );

    app.on(
      ["GET", "HEAD"],
      "*",
      async (c) => bundle.respond(await pageRequestOf(c)) ?? c.notFound(),
    );
  }

  app.notFound(async (c) =>
    web !== undefined && wantsHtml(webRequestOf(c))
      ? web.notFound(await pageRequestOf(c))
      : c.json(errorBody("not_found", "There is nothing at this path."), 404),
  );
  app.onError((error, c) => {
    logger.error({ err: error, requestId: c.get("requestId") }, "unhandled request error");
    return c.json(errorBody("internal", "The request could not be served."), 500);
  });

  return app;
}
/** What the badge of an address says: the count once the index is ready, else where it stands. */
function badgeValue(index: RestMount["index"]): string {
  if (index.status === "ready") {
    return index.skillCount === 1 ? "1 skill" : `${index.skillCount} skills`;
  }
  return index.status === "indexing" ? "indexing" : "unavailable";
}
