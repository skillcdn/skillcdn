import {
  type Address,
  type Clock,
  CONSENT_ERROR_PARAM,
  CONSENT_PAGE_PATH,
  CONSENT_REQUEST_PARAM,
  formatAddress,
  MAX_ADDRESS_LENGTH,
  parseAddress,
} from "@skillcdn/core";
import {
  createOAuthGrant,
  type Database,
  findOAuthAccess,
  type OAuthClientRecord,
  type OAuthTokenPair,
  revokeOAuthToken,
  rotateOAuthRefresh,
  saveOAuthCode,
  takeOAuthCode,
  touchOAuthGrant,
  type UserRecord,
} from "@skillcdn/db";
import * as z from "zod";
import type { Logger } from "../../logger.js";
import {
  hashToken,
  newToken,
  openJson,
  pkceChallenge,
  type Secrets,
  sameSecret,
  sealJson,
} from "../secrets.js";
import { MAX_CLIENT_ID_LENGTH, type OAuthClients } from "./clients.js";
import { isLocalRedirect, isRegisteredRedirect, redirectHostOf } from "./redirects.js";

// The authorization server of this deployment (docs/specs/permissions.md, ADR-0036): it lets a
// person who signed in allow a client to read one address as them, and issues the tokens the
// MCP endpoint of that address accepts. OAuth 2.1: authorization codes with PKCE, nothing else.

/**
 * The path of the issuer under the deployment's origin. The issuer is not the origin itself, so
 * that its metadata is not at the root of the origin: some clients look for a way to sign in
 * before they connect, starting from the address, and a document at the root would tell them
 * that every address wants a sign-in, the public ones included.
 */
export const OAUTH_ISSUER_PATH = "/oauth";

export const OAUTH_ROUTES = {
  /**
   * Where the server's metadata is: where RFC 8414 puts it for an issuer with a path, and under
   * the issuer itself, where clients that append to it look.
   */
  metadata: [
    `/.well-known/oauth-authorization-server${OAUTH_ISSUER_PATH}`,
    `${OAUTH_ISSUER_PATH}/.well-known/oauth-authorization-server`,
  ],
  /** The metadata of an address is at this path followed by the address (RFC 9728). */
  resourceMetadata: "/.well-known/oauth-protected-resource",
  authorize: "/oauth/authorize",
  token: "/oauth/token",
  register: "/oauth/register",
  revoke: "/oauth/revoke",
} as const;

/** The one thing a token allows: reading what the address serves. */
export const OAUTH_SCOPE = "read";

/** How long a person has on the consent page, and a client to exchange the code it was sent. */
const REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 60_000;
/**
 * How long after its first use a refresh token is still exchanged: for a client that did not
 * get the answer and asks again, and for clients that share one store and renew at once.
 */
const REFRESH_REUSE_GRACE_MS = 60_000;
/**
 * How many grants a person keeps, and how many token pairs a grant: beyond them the grants used
 * longest ago and the oldest pairs go. Whoever signed in can make rows; nobody can make them
 * without end.
 */
const MAX_GRANTS_PER_USER = 100;
const MAX_PAIRS_PER_GRANT = 8;
/** How often a grant in use is noted as used. */
const GRANT_TOUCH_INTERVAL_MS = 5 * 60_000;
const MAX_STATE_LENGTH = 1024;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/** A failure a client is told about in the words of the protocol (RFC 6749, section 5.2). */
export class OAuthProtocolError extends Error {
  readonly error: string;
  readonly status: number;

  constructor(error: string, description: string, status = 400) {
    super(description);
    this.name = "OAuthProtocolError";
    this.error = error;
    this.status = status;
  }
}

/** What a client asked for, sealed while the person decides. Small: it travels in a URL. */
const requestSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  state: z.string().optional(),
  codeChallenge: z.string(),
  /** The canonical address the client named as its resource. */
  address: z.string(),
});
type AuthorizationRequest = z.infer<typeof requestSchema>;

/** What the consent page shows of a request. */
export interface AuthorizationRequestView {
  readonly client: {
    readonly name: string;
    readonly uri: string | undefined;
    readonly redirectHost: string;
    readonly loopback: boolean;
  };
  readonly address: Address;
  readonly scope: readonly string[];
}

/** What a refused token is told, for every reason alike, so that a refusal does not say why. */
export const INVALID_TOKEN_DESCRIPTION =
  "The access token is not valid for this address, or has expired.";

export type BearerOutcome =
  /** No credential was presented. */
  | { readonly status: "anonymous" }
  | { readonly status: "valid"; readonly user: UserRecord }
  /** A credential was presented and is no good here; `description` is safe to show. */
  | { readonly status: "invalid"; readonly description: string };

export interface AuthorizationServerOptions {
  readonly database: Database;
  readonly clients: OAuthClients;
  readonly secrets: Secrets;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The origin people and clients use: where the issuer is, and the origin of every address. */
  readonly origin: string;
  readonly accessTokenTtlMs: number;
  readonly refreshTokenTtlMs: number;
}

export class AuthorizationServer {
  readonly #options: AuthorizationServerOptions;

  constructor(options: AuthorizationServerOptions) {
    this.#options = options;
  }

  /** Who issues the tokens, as clients name it and as an answer to a client says (RFC 9207). */
  get issuer(): string {
    return `${this.#options.origin}${OAUTH_ISSUER_PATH}`;
  }

  /** What a client needs to know to use this server (RFC 8414). */
  metadata(): Record<string, unknown> {
    const { origin } = this.#options;
    const authMethods = ["none", "client_secret_post", "client_secret_basic"];
    return {
      issuer: this.issuer,
      authorization_endpoint: `${origin}${OAUTH_ROUTES.authorize}`,
      token_endpoint: `${origin}${OAUTH_ROUTES.token}`,
      registration_endpoint: `${origin}${OAUTH_ROUTES.register}`,
      revocation_endpoint: `${origin}${OAUTH_ROUTES.revoke}`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: authMethods,
      revocation_endpoint_auth_methods_supported: authMethods,
      scopes_supported: [OAUTH_SCOPE],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    };
  }

  /**
   * The metadata of the address at `path` as a protected resource (RFC 9728), or `undefined`
   * when the path is not an address. The document says where to ask for access, not whether
   * there is something to access: it is the same for a private repository and for a name that
   * is nothing. Whether an address has one at all is the caller's to decide; an address that
   * everyone is served has none. The resource is spelled as the client spelled it, since that
   * is what a client compares it with.
   */
  resourceMetadata(path: string): Record<string, unknown> | undefined {
    if (path.length > MAX_ADDRESS_LENGTH || !parseAddress(path).ok) {
      return undefined;
    }
    const { origin } = this.#options;
    return {
      resource: `${origin}${path}`,
      authorization_servers: [this.issuer],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ["header"],
    };
  }

  /** The challenge an address answers a request without a usable credential with (RFC 6750). */
  challenge(path: string, error?: { readonly code: string; readonly description: string }): string {
    const { origin } = this.#options;
    const parameters = [
      `resource_metadata="${origin}${OAUTH_ROUTES.resourceMetadata}${path}"`,
      `scope="${OAUTH_SCOPE}"`,
      ...(error === undefined
        ? []
        : [
            `error="${error.code}"`,
            `error_description="${error.description.replaceAll(/[^\x20-\x21\x23-\x5b\x5d-\x7e]/g, "")}"`,
          ]),
    ];
    return `Bearer ${parameters.join(", ")}`;
  }

  /** The address a resource names, when it names one of this deployment's. */
  #addressOf(resource: string | undefined): Address | undefined {
    if (resource === undefined || resource.length > MAX_ADDRESS_LENGTH + 256) {
      return undefined;
    }
    const url = URL.parse(resource);
    if (
      url === null ||
      url.origin !== this.#options.origin ||
      url.search !== "" ||
      url.hash !== "" ||
      resource.includes("#")
    ) {
      return undefined;
    }
    // The raw path, percent-escapes included: the address parser decodes exactly once.
    const parsed = parseAddress(url.pathname);
    return parsed.ok ? parsed.value : undefined;
  }

  /**
   * Looks at an authorization request and answers where the browser goes next: to the consent
   * page with the request sealed, or to the consent page with what is wrong. It never answers
   * with the client's redirect URI: anyone can register a client, so a request that is merely
   * wrong would be a link on this origin that leads wherever its author likes. A browser goes
   * to a client only with a person's answer.
   */
  async authorize(query: Readonly<Record<string, string | undefined>>): Promise<string> {
    const { clients, secrets, clock } = this.#options;
    const refused = (code: string): string => `${CONSENT_PAGE_PATH}?${CONSENT_ERROR_PARAM}=${code}`;

    const clientId = query.client_id;
    if (clientId === undefined || clientId.length > MAX_CLIENT_ID_LENGTH) {
      return refused("invalid_client");
    }
    const client = await clients.find(clientId);
    if (client === undefined) {
      return refused("invalid_client");
    }
    // Nobody is sent to a URI the client did not register, not even with an error: that is the
    // one thing a client that lies about itself cannot be allowed to choose.
    const redirectUri =
      query.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (redirectUri === undefined || !isRegisteredRedirect(client.redirectUris, redirectUri)) {
      return refused("invalid_redirect_uri");
    }
    const state =
      query.state !== undefined && query.state.length <= MAX_STATE_LENGTH ? query.state : undefined;
    if (query.state !== undefined && state === undefined) {
      return refused("invalid_request");
    }
    if (query.response_type !== "code") {
      return refused("unsupported_response_type");
    }
    if (
      query.code_challenge === undefined ||
      !CHALLENGE_PATTERN.test(query.code_challenge) ||
      query.code_challenge_method !== "S256"
    ) {
      return refused("invalid_request");
    }
    const address = this.#addressOf(query.resource);
    if (address === undefined) {
      return refused("invalid_target");
    }
    const request: AuthorizationRequest = {
      clientId: client.clientId,
      redirectUri,
      ...(state === undefined ? {} : { state }),
      codeChallenge: query.code_challenge,
      address: formatAddress(address),
    };
    const sealed = sealJson(
      secrets,
      "authorization",
      request,
      new Date(clock.now().getTime() + REQUEST_TTL_MS),
    );
    return `${CONSENT_PAGE_PATH}?${CONSENT_REQUEST_PARAM}=${encodeURIComponent(sealed)}`;
  }

  async #open(
    sealed: string,
  ): Promise<{ request: AuthorizationRequest; client: OAuthClientRecord; address: Address }> {
    const { clients, secrets, clock } = this.#options;
    const parsed = requestSchema.safeParse(openJson(secrets, "authorization", sealed, clock.now()));
    if (!parsed.success) {
      throw new OAuthProtocolError(
        "invalid_request",
        "The request has expired. Start again from the app.",
      );
    }
    const client = await clients.find(parsed.data.clientId);
    const address = parseAddress(parsed.data.address);
    // Registered when the request was sealed, and still: a document may have changed since.
    if (
      client === undefined ||
      !address.ok ||
      !isRegisteredRedirect(client.redirectUris, parsed.data.redirectUri)
    ) {
      throw new OAuthProtocolError("invalid_client", "The client is no longer known.");
    }
    return { request: parsed.data, client, address: address.value };
  }

  /** What a sealed request asks for, for the consent page to show. */
  async describe(sealed: string): Promise<AuthorizationRequestView> {
    const { request, client, address } = await this.#open(sealed);
    return {
      client: {
        name: client.name,
        uri: client.uri,
        redirectHost: redirectHostOf(request.redirectUri),
        loopback: isLocalRedirect(request.redirectUri),
      },
      address,
      scope: [OAUTH_SCOPE],
    };
  }

  /**
   * Records the person's answer and returns where their browser goes with it: back to the
   * client, with a code it can exchange once, or with the refusal.
   */
  async decide(sealed: string, user: UserRecord, approve: boolean): Promise<string> {
    const { database, clock, origin } = this.#options;
    const { request, client } = await this.#open(sealed);
    if (!approve) {
      return this.#redirect(request.redirectUri, {
        error: "access_denied",
        error_description: "The request was declined.",
        state: request.state,
      });
    }
    const code = newToken("scdn_c_");
    await saveOAuthCode(database, {
      codeHash: hashToken(code),
      oauthClientId: client.id,
      userId: user.id,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scope: OAUTH_SCOPE,
      resource: `${origin}${request.address}`,
      address: request.address,
      expiresAt: new Date(clock.now().getTime() + CODE_TTL_MS),
    });
    return this.#redirect(request.redirectUri, { code, state: request.state });
  }

  /** A redirect URI with the answer, and with who answers (RFC 9207). */
  #redirect(redirectUri: string, parameters: Readonly<Record<string, string | undefined>>): string {
    const url = new URL(redirectUri);
    for (const [name, value] of Object.entries(parameters)) {
      if (value !== undefined) {
        url.searchParams.set(name, value);
      }
    }
    url.searchParams.set("iss", this.issuer);
    return url.href;
  }

  /** The client a token or revocation request comes from, once it proved to be it. */
  async #authenticate(
    form: Readonly<Record<string, string | undefined>>,
    authorization: string | undefined,
  ): Promise<OAuthClientRecord> {
    let clientId = form.client_id;
    let secret = form.client_secret;
    const unknown = () =>
      new OAuthProtocolError("invalid_client", "The client could not be authenticated.", 401);
    const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authorization ?? "")?.[1];
    if (basic !== undefined) {
      const [name, ...rest] = Buffer.from(basic, "base64").toString("utf8").split(":");
      try {
        clientId = decodeURIComponent(name ?? "");
        secret = decodeURIComponent(rest.join(":"));
      } catch {
        throw unknown();
      }
    }
    if (clientId === undefined || clientId.length === 0) {
      throw unknown();
    }
    const client = await this.#options.clients.find(clientId);
    if (client === undefined) {
      throw unknown();
    }
    if (client.authMethod !== "none") {
      if (
        client.secretHash === undefined ||
        secret === undefined ||
        !sameSecret(hashToken(secret), client.secretHash)
      ) {
        throw unknown();
      }
    }
    return client;
  }

  #newPair(): {
    readonly tokens: OAuthTokenPair;
    readonly access: string;
    readonly refresh: string;
  } {
    const { clock, accessTokenTtlMs, refreshTokenTtlMs } = this.#options;
    const now = clock.now().getTime();
    const access = newToken("scdn_at_");
    const refresh = newToken("scdn_rt_");
    return {
      access,
      refresh,
      tokens: {
        accessHash: hashToken(access),
        accessExpiresAt: new Date(now + accessTokenTtlMs),
        refreshHash: hashToken(refresh),
        refreshExpiresAt: new Date(now + refreshTokenTtlMs),
      },
    };
  }

  #tokenResponse(access: string, refresh: string): Record<string, unknown> {
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.floor(this.#options.accessTokenTtlMs / 1000),
      refresh_token: refresh,
      scope: OAUTH_SCOPE,
    };
  }

  /**
   * The token endpoint: exchanges a code for tokens, or a refresh token for the next pair.
   * Rejects with an {@link OAuthProtocolError} that says what the client did wrong.
   */
  async token(
    form: Readonly<Record<string, string | undefined>>,
    authorization: string | undefined,
  ): Promise<Record<string, unknown>> {
    const { database, clock, logger } = this.#options;
    const grantType = form.grant_type;
    if (grantType !== "authorization_code" && grantType !== "refresh_token") {
      throw new OAuthProtocolError(
        "unsupported_grant_type",
        "grant_type must be authorization_code or refresh_token.",
      );
    }
    const client = await this.#authenticate(form, authorization);

    if (grantType === "refresh_token") {
      if (form.refresh_token === undefined) {
        throw new OAuthProtocolError("invalid_request", "refresh_token is required.");
      }
      const next = this.#newPair();
      const outcome = await rotateOAuthRefresh(database, {
        refreshHash: hashToken(form.refresh_token),
        oauthClientId: client.id,
        next: next.tokens,
        now: clock.now(),
        reuseGraceMs: REFRESH_REUSE_GRACE_MS,
        keepPairs: MAX_PAIRS_PER_GRANT,
      });
      if (outcome.status === "reused") {
        logger.warn({ client: client.id }, "a refresh token was used again; its grant is revoked");
      }
      if (outcome.status !== "rotated") {
        throw new OAuthProtocolError("invalid_grant", "The refresh token is not valid.");
      }
      return this.#tokenResponse(next.access, next.refresh);
    }

    const { code, code_verifier: verifier } = form;
    if (code === undefined || verifier === undefined || !VERIFIER_PATTERN.test(verifier)) {
      throw new OAuthProtocolError("invalid_request", "code and code_verifier are required.");
    }
    // Taken out of the table before anything is checked: a code is spent by being presented.
    const granted = await takeOAuthCode(database, hashToken(code), clock.now());
    const invalid = () => new OAuthProtocolError("invalid_grant", "The code is not valid.");
    if (granted === undefined || granted.oauthClientId !== client.id) {
      throw invalid();
    }
    if (!sameSecret(pkceChallenge(verifier), granted.codeChallenge)) {
      throw invalid();
    }
    if (form.redirect_uri !== undefined && form.redirect_uri !== granted.redirectUri) {
      throw invalid();
    }
    if (form.resource !== undefined) {
      const address = this.#addressOf(form.resource);
      if (address === undefined || formatAddress(address) !== granted.address) {
        throw new OAuthProtocolError(
          "invalid_target",
          "resource is not the address the code was issued for.",
        );
      }
    }
    const pair = this.#newPair();
    await createOAuthGrant(
      database,
      {
        userId: granted.userId,
        oauthClientId: client.id,
        address: granted.address,
        resource: granted.resource,
        scope: granted.scope,
      },
      pair.tokens,
      { grantsPerUser: MAX_GRANTS_PER_USER },
    );
    return this.#tokenResponse(pair.access, pair.refresh);
  }

  /** Revokes the grant a token belongs to (RFC 7009). Says nothing about whether there was one. */
  async revoke(
    form: Readonly<Record<string, string | undefined>>,
    authorization: string | undefined,
  ): Promise<void> {
    const client = await this.#authenticate(form, authorization);
    if (form.token === undefined) {
      throw new OAuthProtocolError("invalid_request", "token is required.");
    }
    await revokeOAuthToken(this.#options.database, {
      tokenHash: hashToken(form.token),
      oauthClientId: client.id,
    });
  }

  /**
   * Who an Authorization header stands for at an address. A token is good at the one address
   * it was issued for and nowhere else, however valid it is; a request without a header is
   * nobody's, which is fine wherever no credential is needed.
   */
  async verify(authorization: string | undefined, address: Address): Promise<BearerOutcome> {
    if (authorization === undefined || authorization.trim().length === 0) {
      return { status: "anonymous" };
    }
    const { database, clock, logger } = this.#options;
    const invalid: BearerOutcome = { status: "invalid", description: INVALID_TOKEN_DESCRIPTION };
    const token = /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
    if (token === undefined) {
      return invalid;
    }
    const now = clock.now();
    const access = await findOAuthAccess(database, hashToken(token), now);
    if (access === undefined || access.address !== formatAddress(address)) {
      return invalid;
    }
    if (
      access.lastUsedAt === undefined ||
      now.getTime() - access.lastUsedAt.getTime() >= GRANT_TOUCH_INTERVAL_MS
    ) {
      touchOAuthGrant(database, access.grantId, now).catch((error: unknown) => {
        logger.warn({ err: error }, "a grant could not be noted as used");
      });
    }
    return { status: "valid", user: access.user };
  }
}
