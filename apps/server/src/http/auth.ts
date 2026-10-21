import {
  type Address,
  AUTH_ROUTES,
  accountAvatarUrl,
  type Clock,
  CONNECT_AGENT_MAX_LENGTH,
  CONSENT_REQUEST_PARAM,
  formatAddress,
  GitHostError,
  type GitHostLogin,
  hasForbiddenCodePoint,
  isGitHostAddress,
  parseAddress,
  parseConnectCode,
  REPO_TOKEN_DEFAULT_DAYS,
  REPO_TOKEN_MAX_DAYS,
  REPO_TOKEN_MAX_LABEL_LENGTH,
  REST_ROUTES,
  RETURN_TO_PARAM,
  type RepoCoordinates,
  type RestAuthorization,
  type RestConnectClaimed,
  type RestConnectDecided,
  type RestConnectStarted,
  type RestConnectView,
  type RestGrants,
  type RestIndexNow,
  type RestMe,
  type RestMyIndex,
  type RestMyRepositories,
  type RestNewRepoToken,
  type RestRepoTokens,
  type RestUser,
  ROOT_PATH,
  signInPath,
} from "@skillcdn/core";
import {
  type Database,
  deleteOAuthGrant,
  listOAuthGrants,
  type RepoTokenRecord,
  type UserRecord,
} from "@skillcdn/db";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import * as z from "zod";
import { type Connections, ConnectLimitError } from "../auth/connections.js";
import { CredentialsLostError, type UserCredentials } from "../auth/credentials.js";
import { type Login, type LoginStep, safeReturnTo } from "../auth/login.js";
import {
  type AuthorizationServer,
  OAUTH_ROUTES,
  OAuthProtocolError,
} from "../auth/oauth/authorization-server.js";
import { ClientLimitError, ClientMetadataError, type OAuthClients } from "../auth/oauth/clients.js";
import { MAX_REPO_TOKENS_PER_USER, type RepoTokens } from "../auth/repo-tokens.js";
import type { Sessions } from "../auth/sessions.js";
import type { EmbeddingReads } from "../jobs/reads.js";
import type { Logger } from "../logger.js";
import { type Mount, MountError } from "../mounts/mount-service.js";
import type { AppEnv } from "./request-context.js";
import { CORS_MAX_AGE_SECONDS, errorBody, hostFailure } from "./rest.js";

/**
 * Everything people sign in with (docs/specs/permissions.md): the sign-in itself, what a
 * signed-in person has here, and the authorization server that lets them allow a client. It
 * exists only on a deployment that is configured for it; elsewhere these paths are nothing.
 */
export interface AuthDependencies {
  /** The origin people use. Requests that change something have to come from its pages. */
  readonly origin: string;
  readonly database: Database;
  readonly sessions: Sessions;
  readonly login: Login;
  readonly authorization: AuthorizationServer;
  readonly clients: OAuthClients;
  readonly tokens: RepoTokens;
  readonly connections: Connections;
  readonly credentials: UserCredentials;
  readonly hostLogin: GitHostLogin;
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * Whether the person can see what the address names right now; `undefined` when the git host
   * could not be asked.
   */
  readonly canSee: (address: Address, user: UserRecord) => Promise<boolean | undefined>;
  /**
   * Whether an address is one that only some people are served, and so one that says where to
   * ask for access. Rejects when the git host could not be asked.
   */
  readonly asksForPermission: (address: Address) => Promise<boolean>;
  /**
   * What an address is to the person, resolved as their own request for it would be. Rejects
   * with a `MountError` for what they cannot open, a name that is nothing included.
   */
  readonly open: (address: Address, user: UserRecord) => Promise<Mount>;
  /** Whether the person administers the repository at the host, asked of the host as them. */
  readonly administers: (user: UserRecord, coordinates: RepoCoordinates) => Promise<boolean>;
  /** What an administrator asks of a repository's index: that it be indexed now (ADR-0064). */
  readonly index: Pick<EmbeddingReads, "designate">;
}

/** The size of the pictures the pages ask the host for: 80 CSS pixels on a 2x screen. */
const AVATAR_SIZE = 160;
/** A token request is a few fields; a registration a few more. */
const MAX_FORM_BYTES = 64 * 1024;
/** A sealed request is a few hundred characters; this is far more than any is. */
const MAX_SEALED_LENGTH = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const newTokenSchema = z.object({
  address: z.string().min(1).max(2048),
  label: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(REPO_TOKEN_MAX_LABEL_LENGTH))
    .refine((value) => !hasForbiddenCodePoint(value)),
  // A lifetime in days, or null for a token without an end (ADR-0060).
  expiresInDays: z.number().int().min(1).max(REPO_TOKEN_MAX_DAYS).nullable(),
});

/** What a token is to the person who made it: everything but the secret. */
function restRepoToken(record: RepoTokenRecord): RestRepoTokens["items"][number] {
  return {
    id: record.id,
    address: record.address,
    label: record.label,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt?.toISOString() ?? null,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
  };
}

const decisionSchema = z.object({
  request: z.string().min(1).max(MAX_SEALED_LENGTH),
  approve: z.boolean(),
});

const plainText = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(max))
    .refine((value) => !hasForbiddenCodePoint(value));

const connectRequestSchema = z.object({
  address: z.string().min(1).max(2048),
  agent: plainText(CONNECT_AGENT_MAX_LENGTH),
});

const connectDecisionSchema = z.object({
  approve: z.boolean(),
  label: plainText(REPO_TOKEN_MAX_LABEL_LENGTH).optional(),
  expiresInDays: z.number().int().min(1).max(REPO_TOKEN_MAX_DAYS).nullable().optional(),
});

/** A secret is a prefix and a few dozen characters; this is far more than any is. */
const connectClaimSchema = z.object({ secret: z.string().min(1).max(256) });

export function restUser(user: UserRecord): RestUser {
  return {
    host: user.host,
    login: user.login,
    name: user.name ?? null,
    avatar: accountAvatarUrl(user.host, user.hostAccountId, AVATAR_SIZE),
  };
}

export function registerAuth(app: Hono<AppEnv>, dependencies: AuthDependencies): void {
  const { origin, database, sessions, login, authorization, clients, credentials, hostLogin } =
    dependencies;
  const { tokens } = dependencies;
  const { clock, logger } = dependencies;

  const sessionUser = (c: Context<AppEnv>): Promise<UserRecord | undefined> =>
    sessions.resolve(c.req.header("cookie"));

  const signInRequired = (c: Context<AppEnv>): Response =>
    c.json(errorBody("auth.required", "Sign in to continue."), 401);

  /**
   * A request that changes something for the person signed in has to come from this
   * deployment's own pages. The session cookie is not sent with another site's requests in the
   * first place; this is the second fence, and browsers name the origin of every such request.
   */
  const fromOwnPages = (c: Context<AppEnv>): boolean => c.req.header("origin") === origin;
  const foreignOrigin = (c: Context<AppEnv>): Response =>
    c.json(errorBody("auth.forbidden_origin", "This request must come from the site itself."), 403);

  const follow = (c: Context<AppEnv>, step: LoginStep): Response => {
    for (const cookie of step.cookies) {
      c.header("set-cookie", cookie, { append: true });
    }
    c.header("cache-control", "no-store");
    return c.redirect(step.redirect, 302);
  };

  /** What is left to say once the git host no longer vouches for the person: sign in again. */
  const signedOut = (c: Context<AppEnv>): Response => {
    c.header("set-cookie", sessions.clear());
    return signInRequired(c);
  };

  /**
   * A sign-in begins on the deployment's own pages (ADR-0043), where a person sees which host
   * they continue with and what they agree to by it. A browser says where a navigation comes
   * from, and one that comes from anywhere else, a link on another site or an address typed, is
   * not a person pressing that button. A request that says nothing is from a browser too old to
   * say, which could not sign in at all if silence were refused.
   */
  const begunOnOwnPages = (c: Context<AppEnv>): boolean => {
    const site = c.req.header("sec-fetch-site");
    return site === undefined || site === "same-origin";
  };

  // Signing in and out. Navigations, so they answer with redirects; nothing here is cached.
  app.get(AUTH_ROUTES.login, (c) => {
    const returnTo = c.req.query(RETURN_TO_PARAM);
    if (!begunOnOwnPages(c)) {
      // To the page it was for, which offers it over itself: following a link signs nobody in.
      c.header("cache-control", "no-store");
      return c.redirect(signInPath(safeReturnTo(returnTo, origin)), 302);
    }
    return follow(c, login.begin(returnTo));
  });

  app.get(AUTH_ROUTES.callback, async (c) => {
    const { code, state, error } = c.req.query();
    return follow(
      c,
      await login.complete(
        {
          ...(code === undefined ? {} : { code }),
          ...(state === undefined ? {} : { state }),
          ...(error === undefined ? {} : { error }),
        },
        c.req.header("cookie"),
      ),
    );
  });

  app.post(AUTH_ROUTES.logout, async (c) => {
    if (!fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    c.header("set-cookie", await sessions.end(c.req.header("cookie")));
    c.header("cache-control", "no-store");
    return c.body(null, 204);
  });

  // Whoever is signed in, for the pages. Nobody is an answer too.
  app.get(REST_ROUTES.me, async (c) => {
    const user = await sessionUser(c);
    const body: RestMe = { user: user === undefined ? null : restUser(user) };
    return c.json(body);
  });

  app.get(`${REST_ROUTES.me}/repositories`, async (c) => {
    const user = await sessionUser(c);
    if (user === undefined) {
      return signInRequired(c);
    }
    try {
      const token = await credentials.accessToken(user.id);
      const [listed, installUrl] = await Promise.all([
        hostLogin.listInstallations(token),
        hostLogin.installUrl(),
      ]);
      const body: RestMyRepositories = {
        installUrl: installUrl ?? null,
        installations: listed.installations.map((installation) => ({
          account: {
            login: installation.account.login,
            kind: installation.account.kind,
            avatar: accountAvatarUrl(user.host, installation.account.hostAccountId, AVATAR_SIZE),
          },
          manageUrl: installation.manageUrl ?? null,
          selection: installation.selection,
          repositories: installation.repositories.flatMap((repository) => {
            const parsed = parseAddress(`/${user.host}/${repository.owner}/${repository.name}`);
            return parsed.ok
              ? [
                  {
                    address: formatAddress(parsed.value),
                    owner: repository.owner,
                    name: repository.name,
                    description: repository.description ?? null,
                    visibility: repository.visibility,
                  },
                ]
              : [];
          }),
          truncated: installation.truncated,
        })),
        truncated: listed.truncated,
      };
      return c.json(body);
    } catch (error) {
      if (error instanceof CredentialsLostError) {
        return signedOut(c);
      }
      if (error instanceof GitHostError && error.kind === "unauthorized") {
        await credentials.refused(user.id).catch(() => {});
        return signedOut(c);
      }
      const known = hostFailure(error);
      if (known === undefined) {
        throw error;
      }
      if (known.retryAfterSeconds !== undefined) {
        c.header("retry-after", String(known.retryAfterSeconds));
      }
      return c.json(errorBody(known.code, known.message), known.status as 503);
    }
  });

  app.get(`${REST_ROUTES.me}/grants`, async (c) => {
    const user = await sessionUser(c);
    if (user === undefined) {
      return signInRequired(c);
    }
    const body: RestGrants = {
      items: (await listOAuthGrants(database, user.id, clock.now())).map((grant) => ({
        id: grant.id,
        client: { name: grant.client.name, uri: grant.client.uri ?? null },
        address: grant.address,
        createdAt: grant.createdAt.toISOString(),
        lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
      })),
    };
    return c.json(body);
  });

  app.delete(`${REST_ROUTES.me}/grants/:id`, async (c) => {
    if (!fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const user = await sessionUser(c);
    if (user === undefined) {
      return signInRequired(c);
    }
    const id = c.req.param("id");
    const removed =
      UUID.test(id) && (await deleteOAuthGrant(database, { userId: user.id, grantId: id }));
    logger.info({ user: user.id, removed, requestId: c.get("requestId") }, "grant removal");
    return removed
      ? c.json({ id, removed: true })
      : c.json(errorBody("grant.not_found", "No such grant."), 404);
  });

  // The tokens a person makes for agents that have nobody to sign in (ADR-0040).
  app.get(`${REST_ROUTES.me}/tokens`, async (c) => {
    const user = await sessionUser(c);
    if (user === undefined) {
      return signInRequired(c);
    }
    const body: RestRepoTokens = {
      items: (await tokens.list(user)).map(restRepoToken),
      limit: MAX_REPO_TOKENS_PER_USER,
    };
    return c.json(body);
  });

  app.post(
    `${REST_ROUTES.me}/tokens`,
    bodyLimit({
      maxSize: MAX_FORM_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      if (!fromOwnPages(c)) {
        return foreignOrigin(c);
      }
      const user = await sessionUser(c);
      if (user === undefined) {
        return signInRequired(c);
      }
      const parsed = newTokenSchema.safeParse(await c.req.json().catch(() => undefined));
      const address = parsed.success ? parseAddress(parsed.data.address) : undefined;
      if (!parsed.success || address === undefined || !address.ok) {
        return c.json(
          errorBody(
            "token.invalid",
            `A token needs a repository, a name of at most ${REPO_TOKEN_MAX_LABEL_LENGTH} characters, and a lifetime of 1 to ${REPO_TOKEN_MAX_DAYS} days, or null for none.`,
          ),
          400,
        );
      }
      if (address.value.ref !== undefined || address.value.path !== ROOT_PATH) {
        return c.json(
          errorBody(
            "token.not_a_repository",
            "A token is made for a repository, and reads every ref and path of it: name the repository alone.",
          ),
          400,
        );
      }
      let mount: Mount;
      try {
        // As their own request for it would be answered: a repository they cannot open and a
        // name that is nothing are the same not-found, here as everywhere.
        mount = await dependencies.open(address.value, user);
      } catch (error) {
        if (!(error instanceof MountError)) {
          throw error;
        }
        if (error.retryAfterSeconds !== undefined) {
          c.header("retry-after", String(error.retryAfterSeconds));
        }
        const status =
          error.reason === "rate_limited" || error.reason === "unavailable"
            ? 503
            : error.reason === "not_allowed"
              ? 403
              : 404;
        return c.json(errorBody(error.code, error.detail), status);
      }
      if (mount.repo.repository.visibility === "public") {
        return c.json(
          errorBody(
            "token.public_repository",
            "A public repository is read without a token, by anyone.",
          ),
          400,
        );
      }
      const made = await tokens.create(user, mount.repo, address.value, parsed.data);
      if (made === undefined) {
        return c.json(
          errorBody(
            "token.limit",
            `An account holds at most ${MAX_REPO_TOKENS_PER_USER} tokens. Remove one that is no longer used.`,
          ),
          409,
        );
      }
      logger.info(
        { user: user.id, token: made.record.id, requestId: c.get("requestId") },
        "repository token made",
      );
      const body: RestNewRepoToken = { token: made.token, item: restRepoToken(made.record) };
      return c.json(body, 201);
    },
  );

  app.delete(`${REST_ROUTES.me}/tokens/:id`, async (c) => {
    if (!fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const user = await sessionUser(c);
    if (user === undefined) {
      return signInRequired(c);
    }
    const id = c.req.param("id");
    const removed = UUID.test(id) && (await tokens.remove(user, id));
    logger.info({ user: user.id, removed, requestId: c.get("requestId") }, "token removal");
    return removed
      ? c.json({ id, removed: true })
      : c.json(errorBody("token.not_found", "No such token."), 404);
  });

  // A command connecting with a code a person approves (ADR-0059). Beginning and claiming are
  // the command's, as nobody; looking and deciding are the person's, signed in on these pages.
  const { connections } = dependencies;
  const smallJson = bodyLimit({
    maxSize: MAX_FORM_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });
  const noSuchConnection = (c: Context<AppEnv>): Response =>
    c.json(
      errorBody("connect.not_found", "No command is waiting under this code, or its time is up."),
      404,
    );
  /** What a repository the person cannot open answers: the same for every reason it cannot. */
  const mountRefusal = (c: Context<AppEnv>, error: MountError): Response => {
    if (error.retryAfterSeconds !== undefined) {
      c.header("retry-after", String(error.retryAfterSeconds));
    }
    const status =
      error.reason === "rate_limited" || error.reason === "unavailable"
        ? 503
        : error.reason === "not_allowed"
          ? 403
          : 404;
    return c.json(errorBody(error.code, error.detail), status);
  };
  const storedAddress = (text: string): Address => {
    const parsed = parseAddress(text);
    if (!parsed.ok) {
      throw new Error("a stored address parses");
    }
    return parsed.value;
  };

  // What an administrator of a repository asks of its index (ADR-0064): that it be indexed now,
  // and its documents embedded first of all, for a repository that is not public as well. The
  // host says who administers a repository, asked as the person; the page shows the way to them
  // alone, and the answer tells it so.
  const INDEX_ROUTE = `${REST_ROUTES.me}/index`;
  const indexAddressOf = (c: Context<AppEnv>): Address | Response => {
    // The raw path, percent-escapes included: the address parser decodes exactly once.
    const parsed = parseAddress(new URL(c.req.url).pathname.slice(INDEX_ROUTE.length));
    if (!parsed.ok) {
      return c.json(errorBody(`address.${parsed.error.code}`, parsed.error.message), 400);
    }
    if (parsed.value.path !== ROOT_PATH) {
      return c.json(
        errorBody(
          "index.not_a_repository",
          "A repository is indexed whole: name it, with a ref at most, and no path.",
        ),
        400,
      );
    }
    return parsed.value;
  };
  /** The repository as the person may open it, or why not, in the words every request uses. */
  const openFor = async (
    c: Context<AppEnv>,
    address: Address,
    user: UserRecord,
  ): Promise<Mount | Response> => {
    try {
      return await dependencies.open(address, user);
    } catch (error) {
      if (!(error instanceof MountError)) {
        throw error;
      }
      if (error.retryAfterSeconds !== undefined) {
        c.header("retry-after", String(error.retryAfterSeconds));
      }
      const status =
        error.reason === "rate_limited" || error.reason === "unavailable"
          ? 503
          : error.reason === "not_allowed"
            ? 403
            : 404;
      return c.json(errorBody(error.code, error.detail), status);
    }
  };
  /** Whether the person administers the mount's repository, or the answer when the host could not say. */
  const administersOr = async (
    c: Context<AppEnv>,
    user: UserRecord,
    mount: Mount,
  ): Promise<boolean | Response> => {
    try {
      return await dependencies.administers(user, mount.coordinates);
    } catch (error) {
      if (error instanceof CredentialsLostError) {
        return signedOut(c);
      }
      if (error instanceof GitHostError && error.kind === "unauthorized") {
        return signedOut(c);
      }
      const known = hostFailure(error);
      if (known === undefined) {
        throw error;
      }
      if (known.retryAfterSeconds !== undefined) {
        c.header("retry-after", String(known.retryAfterSeconds));
      }
      return c.json(errorBody(known.code, known.message), known.status as 503);
    }
  };

  app.get(`${INDEX_ROUTE}/*`, async (c) => {
    const user = await sessionUser(c);
    if (user === undefined) {
      return signInRequired(c);
    }
    const address = indexAddressOf(c);
    if (address instanceof Response) {
      return address;
    }
    const mount = await openFor(c, address, user);
    if (mount instanceof Response) {
      return mount;
    }
    const administers = await administersOr(c, user, mount);
    if (administers instanceof Response) {
      return administers;
    }
    const body: RestMyIndex = { administers };
    return c.json(body);
  });

  app.post(`${INDEX_ROUTE}/*`, async (c) => {
    if (!fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const user = await sessionUser(c);
    if (user === undefined) {
      return signInRequired(c);
    }
    const address = indexAddressOf(c);
    if (address instanceof Response) {
      return address;
    }
    const mount = await openFor(c, address, user);
    if (mount instanceof Response) {
      return mount;
    }
    const administers = await administersOr(c, user, mount);
    if (administers instanceof Response) {
      return administers;
    }
    if (!administers) {
      return c.json(
        errorBody(
          "index.not_administrator",
          "Only someone who administers the repository at the git host may ask for it to be indexed now.",
        ),
        403,
      );
    }
    const outcome = await dependencies.index.designate(formatAddress(address), {
      accountId: mount.repo.accountId,
      repoId: mount.repo.id,
    });
    if (outcome === "unavailable") {
      return c.json(
        errorBody("index.unavailable", "This deployment runs no worker to index a repository now."),
        503,
      );
    }
    if (outcome === "invalid") {
      return c.json(
        errorBody(
          "index.not_a_repository",
          "A repository is indexed whole: name it, with a ref at most.",
        ),
        400,
      );
    }
    logger.info(
      {
        user: user.id,
        address: outcome.address,
        queued: outcome.queued,
        requestId: c.get("requestId"),
      },
      "repository designated for indexing by its administrator",
    );
    const body: RestIndexNow = { queued: outcome.queued };
    return c.json(body, 202);
  });

  app.post(REST_ROUTES.connect, smallJson, async (c) => {
    c.header("cache-control", "no-store");
    const parsed = connectRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    const address = parsed.success ? parseAddress(parsed.data.address) : undefined;
    if (
      !parsed.success ||
      address === undefined ||
      !address.ok ||
      !isGitHostAddress(address.value)
    ) {
      return c.json(
        errorBody(
          "connect.invalid",
          `A connection names a repository, as /gh/<owner>/<repo>, and what the command calls itself, in at most ${CONNECT_AGENT_MAX_LENGTH} characters.`,
        ),
        400,
      );
    }
    if (address.value.ref !== undefined || address.value.path !== ROOT_PATH) {
      return c.json(
        errorBody(
          "token.not_a_repository",
          "A command connects to a repository, and reads every ref and path of it: name the repository alone.",
        ),
        400,
      );
    }
    try {
      // Nothing is asked about the repository here: a request is anyone's, and whether the
      // name is a private repository or nothing is for the person who approves to learn.
      const started = await connections.begin(address.value, parsed.data.agent);
      const body: RestConnectStarted = {
        code: started.code,
        url: started.url,
        secret: started.secret,
        expiresAt: started.expiresAt.toISOString(),
        intervalSeconds: started.intervalSeconds,
      };
      return c.json(body, 201);
    } catch (error) {
      if (error instanceof ConnectLimitError) {
        c.header("retry-after", String(error.retryAfterSeconds));
        return c.json(errorBody(error.code, error.message), 503);
      }
      throw error;
    }
  });

  app.get(`${REST_ROUTES.connect}/:code`, async (c) => {
    c.header("cache-control", "no-store");
    const user = await sessionUser(c);
    if (user === undefined) {
      return signInRequired(c);
    }
    const code = parseConnectCode(c.req.param("code"));
    const request = code === undefined ? undefined : await connections.look(code);
    if (request === undefined) {
      return noSuchConnection(c);
    }
    const body: RestConnectView = {
      code: request.code,
      agent: request.agent,
      address: request.address,
      expiresAt: request.expiresAt.toISOString(),
      approved: request.approval !== undefined,
      user: restUser(user),
      visible: (await dependencies.canSee(storedAddress(request.address), user)) ?? null,
      installUrl: (await hostLogin.installUrl().catch(() => undefined)) ?? null,
    };
    return c.json(body);
  });

  app.post(`${REST_ROUTES.connect}/:code/decision`, smallJson, async (c) => {
    c.header("cache-control", "no-store");
    if (!fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const user = await sessionUser(c);
    if (user === undefined) {
      return signInRequired(c);
    }
    const parsed = connectDecisionSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json(
        errorBody(
          "connect.invalid",
          `The answer is yes or no, with a name of at most ${REPO_TOKEN_MAX_LABEL_LENGTH} characters and a lifetime of 1 to ${REPO_TOKEN_MAX_DAYS} days, or null for none, for a yes.`,
        ),
        400,
      );
    }
    const code = parseConnectCode(c.req.param("code"));
    const request = code === undefined ? undefined : await connections.look(code);
    if (request === undefined || request.approval !== undefined) {
      return noSuchConnection(c);
    }
    if (!parsed.data.approve) {
      await connections.end(request.id);
      logger.info({ user: user.id, requestId: c.get("requestId") }, "connection declined");
      const body: RestConnectDecided = { status: "denied" };
      return c.json(body);
    }
    // Nothing is approved for a repository the person cannot open, and a connection that
    // cannot work fails here, where the person is. The refusal is one for a repository that is
    // somebody else's and for a name that is nothing, and without an answer from the git host
    // nothing is approved either.
    let mount: Mount;
    try {
      mount = await dependencies.open(storedAddress(request.address), user);
    } catch (error) {
      if (!(error instanceof MountError)) {
        throw error;
      }
      return mountRefusal(c, error);
    }
    if (mount.repo.repository.visibility === "public") {
      await connections.end(request.id);
      return c.json(
        errorBody(
          "token.public_repository",
          "A public repository is read without a token, by anyone: the command needs no connection to it.",
        ),
        400,
      );
    }
    const approved = await connections.approve(request.code, user, {
      label: parsed.data.label ?? request.agent.slice(0, REPO_TOKEN_MAX_LABEL_LENGTH).trim(),
      // Left out, the pages' default lifetime; null, a token without an end (ADR-0060).
      expiresInDays:
        parsed.data.expiresInDays === undefined
          ? REPO_TOKEN_DEFAULT_DAYS
          : parsed.data.expiresInDays,
    });
    if (!approved) {
      return noSuchConnection(c);
    }
    logger.info({ user: user.id, requestId: c.get("requestId") }, "connection approved");
    const body: RestConnectDecided = { status: "approved" };
    return c.json(body);
  });

  app.post(`${REST_ROUTES.connect}/claim`, smallJson, async (c) => {
    c.header("cache-control", "no-store");
    const parsed = connectClaimSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json(
        errorBody("connect.invalid", "A claim carries the secret the command was given."),
        400,
      );
    }
    const claim = await connections.claim(parsed.data.secret);
    if (claim.status === "none") {
      return noSuchConnection(c);
    }
    if (claim.status === "pending") {
      const body: RestConnectClaimed = {
        status: "pending",
        expiresAt: claim.expiresAt.toISOString(),
      };
      return c.json(body);
    }
    // As the person who approved would be answered now: they may have lost the repository
    // since, and the git host may not answer, which leaves the approval for the next claim.
    const { request, user } = claim;
    const address = storedAddress(request.address);
    let mount: Mount;
    try {
      mount = await dependencies.open(address, user);
    } catch (error) {
      if (!(error instanceof MountError)) {
        throw error;
      }
      if (error.reason !== "rate_limited" && error.reason !== "unavailable") {
        await connections.end(request.id);
      }
      return mountRefusal(c, error);
    }
    if (mount.repo.repository.visibility === "public") {
      await connections.end(request.id);
      return c.json(
        errorBody(
          "token.public_repository",
          "A public repository is read without a token, by anyone: the command needs no connection to it.",
        ),
        400,
      );
    }
    // Taken here, so that the token is made once however many claims arrive at once.
    const taken = await connections.take(parsed.data.secret);
    if (taken === undefined) {
      return noSuchConnection(c);
    }
    const made = await connections.issue(taken, user, mount.repo, address);
    if (made === undefined) {
      return c.json(
        errorBody(
          "token.limit",
          `An account holds at most ${MAX_REPO_TOKENS_PER_USER} tokens. Remove one that is no longer used.`,
        ),
        409,
      );
    }
    const body: RestConnectClaimed = {
      status: "connected",
      token: made.token,
      item: restRepoToken(made.record),
    };
    return c.json(body);
  });

  // The consent page's two questions: what is being asked, and what the person answers.
  const protocolFailure = (c: Context<AppEnv>, error: unknown): Response => {
    if (error instanceof OAuthProtocolError) {
      return c.json(errorBody(`oauth.${error.error}`, error.message), 400);
    }
    throw error;
  };

  app.get(REST_ROUTES.authorization, async (c) => {
    const sealed = c.req.query(CONSENT_REQUEST_PARAM);
    if (sealed === undefined || sealed.length > MAX_SEALED_LENGTH) {
      return c.json(errorBody("oauth.invalid_request", "There is no request to show."), 400);
    }
    try {
      const view = await authorization.describe(sealed);
      const user = await sessionUser(c);
      const body: RestAuthorization = {
        client: {
          name: view.client.name,
          uri: view.client.uri ?? null,
          redirectHost: view.client.redirectHost,
          loopback: view.client.loopback,
        },
        address: formatAddress(view.address),
        scope: [...view.scope],
        user: user === undefined ? null : restUser(user),
        visible:
          user === undefined ? null : ((await dependencies.canSee(view.address, user)) ?? null),
        installUrl:
          user === undefined
            ? null
            : ((await hostLogin.installUrl().catch(() => undefined)) ?? null),
      };
      return c.json(body);
    } catch (error) {
      return protocolFailure(c, error);
    }
  });

  app.post(
    REST_ROUTES.decision,
    bodyLimit({
      maxSize: MAX_FORM_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      if (!fromOwnPages(c)) {
        return foreignOrigin(c);
      }
      const user = await sessionUser(c);
      if (user === undefined) {
        return signInRequired(c);
      }
      const parsed = decisionSchema.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) {
        return c.json(errorBody("oauth.invalid_request", "The answer is not readable."), 400);
      }
      try {
        if (parsed.data.approve) {
          // Nothing is allowed for an address its person cannot open, and a connection that
          // cannot work fails here, where the person is, instead of answering "not found" to
          // every call afterwards. The refusal is one for a repository that is somebody else's
          // and for a name that is nothing, and without an answer from the git host nothing is
          // allowed either.
          const { address } = await authorization.describe(parsed.data.request);
          const visible = await dependencies.canSee(address, user);
          if (visible !== true) {
            c.header("cache-control", "no-store");
            return visible === undefined
              ? c.json(
                  errorBody(
                    "mount.unavailable",
                    "The git host could not be asked. Try again in a moment.",
                  ),
                  503,
                )
              : c.json(
                  errorBody(
                    "oauth.not_visible",
                    "This account cannot open the address, or there is nothing at it.",
                  ),
                  403,
                );
          }
        }
        const redirect = await authorization.decide(parsed.data.request, user, parsed.data.approve);
        logger.info(
          { user: user.id, approved: parsed.data.approve, requestId: c.get("requestId") },
          "authorization decided",
        );
        return c.json({ redirect });
      } catch (error) {
        return protocolFailure(c, error);
      }
    },
  );

  // The authorization server, as clients see it. Metadata and the endpoints clients call carry
  // no cookie and say nothing about any person, so a page on any origin may reach them, as a
  // client that runs in a browser has to.
  const open = cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["authorization", "content-type", "mcp-protocol-version"],
    maxAge: CORS_MAX_AGE_SECONDS,
  });
  for (const path of [
    ...OAUTH_ROUTES.metadata,
    `${OAUTH_ROUTES.resourceMetadata}/*`,
    OAUTH_ROUTES.token,
    OAUTH_ROUTES.register,
    OAUTH_ROUTES.revoke,
  ]) {
    app.use(path, open);
  }

  for (const path of OAUTH_ROUTES.metadata) {
    app.get(path, (c) => {
      c.header("cache-control", "public, max-age=3600");
      return c.json(authorization.metadata());
    });
  }

  // An address says where to ask for access only when it asks for it. Some clients look for
  // this document before they connect, and take finding it to mean that the server wants a
  // sign-in: an address that everyone is served has none, and is to them what it is on a
  // deployment where nobody signs in. Whether there is one can change, so nobody keeps the answer.
  app.get(`${OAUTH_ROUTES.resourceMetadata}/*`, async (c) => {
    c.header("cache-control", "no-store");
    const nothing = (): Response =>
      c.json(errorBody("not_found", "There is nothing at this path."), 404);
    // The raw path, as the client wrote it: what it compares the document's resource with.
    const path = new URL(c.req.url).pathname.slice(OAUTH_ROUTES.resourceMetadata.length);
    const document = authorization.resourceMetadata(path);
    const parsed = document === undefined ? undefined : parseAddress(path);
    if (document === undefined || parsed === undefined || !parsed.ok) {
      return nothing();
    }
    try {
      return (await dependencies.asksForPermission(parsed.value)) ? c.json(document) : nothing();
    } catch (error) {
      if (error instanceof MountError) {
        if (error.retryAfterSeconds !== undefined) {
          c.header("retry-after", String(error.retryAfterSeconds));
        }
        return c.json(errorBody(error.code, error.detail), 503);
      }
      throw error;
    }
  });

  app.get(OAUTH_ROUTES.authorize, async (c) => {
    c.header("cache-control", "no-store");
    return c.redirect(await authorization.authorize(c.req.query()), 302);
  });

  /** The fields of a form body, as the token endpoints are sent them. */
  const formOf = async (c: Context<AppEnv>): Promise<Record<string, string>> =>
    Object.fromEntries(new URLSearchParams(await c.req.text()));

  const oauthFailure = (c: Context<AppEnv>, error: unknown): Response => {
    c.header("cache-control", "no-store");
    if (error instanceof OAuthProtocolError) {
      if (error.status === 401) {
        c.header("www-authenticate", 'Basic realm="oauth"');
      }
      return c.json({ error: error.error, error_description: error.message }, error.status as 400);
    }
    logger.error({ err: error, requestId: c.get("requestId") }, "oauth request failed");
    return c.json({ error: "server_error", error_description: "The request failed." }, 500);
  };

  const smallBody = bodyLimit({
    maxSize: MAX_FORM_BYTES,
    onError: (c) =>
      c.json(
        { error: "invalid_request", error_description: "The request body is too large." },
        413,
      ),
  });

  app.post(OAUTH_ROUTES.token, smallBody, async (c) => {
    try {
      const tokens = await authorization.token(await formOf(c), c.req.header("authorization"));
      c.header("cache-control", "no-store");
      c.header("pragma", "no-cache");
      return c.json(tokens);
    } catch (error) {
      return oauthFailure(c, error);
    }
  });

  app.post(OAUTH_ROUTES.revoke, smallBody, async (c) => {
    try {
      await authorization.revoke(await formOf(c), c.req.header("authorization"));
      c.header("cache-control", "no-store");
      return c.body(null, 200);
    } catch (error) {
      return oauthFailure(c, error);
    }
  });

  app.post(OAUTH_ROUTES.register, smallBody, async (c) => {
    c.header("cache-control", "no-store");
    try {
      const { client, secret } = await clients.register(await c.req.json().catch(() => undefined));
      logger.info({ client: client.id, requestId: c.get("requestId") }, "oauth client registered");
      return c.json(
        {
          client_id: client.clientId,
          client_id_issued_at: Math.floor(clock.now().getTime() / 1000),
          client_name: client.name,
          ...(client.uri === undefined ? {} : { client_uri: client.uri }),
          redirect_uris: client.redirectUris,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: client.authMethod,
          // A secret is shown once, here, and does not expire.
          ...(secret === undefined ? {} : { client_secret: secret, client_secret_expires_at: 0 }),
        },
        201,
      );
    } catch (error) {
      if (error instanceof ClientMetadataError) {
        return c.json({ error: error.code, error_description: error.message }, 400);
      }
      if (error instanceof ClientLimitError) {
        c.header("retry-after", String(error.retryAfterSeconds));
        return c.json({ error: "temporarily_unavailable", error_description: error.message }, 503);
      }
      return oauthFailure(c, error);
    }
  });
}
