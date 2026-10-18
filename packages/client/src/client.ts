import {
  type Address,
  AUTH_ROUTES,
  CONSENT_REQUEST_PARAM,
  type LegalDocumentKind,
  legalPath,
  type OwnerPath,
  ownerRestPath,
  REST_ROUTES,
  type RestAuthorization,
  type RestBrowse,
  type RestConnectClaimed,
  type RestConnectDecided,
  type RestConnectDecision,
  type RestConnectRequest,
  type RestConnectStarted,
  type RestConnectView,
  type RestFeatured,
  type RestFile,
  type RestFind,
  type RestGrants,
  type RestLegalDocument,
  type RestMe,
  type RestMount,
  type RestMyRepositories,
  type RestNewRepoToken,
  type RestOwner,
  type RestRepoTokenRequest,
  type RestRepoTokens,
  type RestShowcase,
  type RestSkill,
  restAuthorizationDecisionSchema,
  restAuthorizationSchema,
  restBrowseSchema,
  restConnectClaimedSchema,
  restConnectDecidedSchema,
  restConnectStartedSchema,
  restConnectViewSchema,
  restErrorSchema,
  restFeaturedSchema,
  restFileSchema,
  restFindSchema,
  restGrantsSchema,
  restLegalDocumentSchema,
  restMeSchema,
  restMountSchema,
  restMyRepositoriesSchema,
  restNewRepoTokenSchema,
  restOwnerSchema,
  restPath,
  restRepoTokensSchema,
  restShowcaseSchema,
  restSkillSchema,
} from "@skillcdn/core";

// The REST API of a deployment (docs/specs/rest.md) as typed functions: every answer parsed with
// the schemas of @skillcdn/core, which the server is tested against, and every failure an
// ApiError with the code the API gave it. A token travels as the bearer of a request and
// nowhere else: a redirect is never followed, so it goes to the origin it was made for.

/** `fetch`, as the platform has it or as a test hands one in. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** The origin of the deployment, such as `https://skillcdn.ai`; empty for the page's own origin. */
  readonly baseUrl: string;
  /** The platform's `fetch` when left out. */
  readonly fetch?: FetchLike | undefined;
  /**
   * A token of the deployment (an access token or a repository token), sent as the bearer of
   * every request that reads an address. Without one, a request is anyone's, and a page's own
   * session goes with it as the browser sends it.
   */
  readonly token?: string | undefined;
  /** What the client calls itself, where the platform lets a program set its `user-agent`. */
  readonly userAgent?: string | undefined;
  /** How long one request may take, headers and body together. */
  readonly timeoutMs?: number | undefined;
  /** The largest body read; a longer one is an answer in an unexpected shape. */
  readonly maxBodyBytes?: number | undefined;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
/** A mount overview lists at most a couple of hundred skills and documents; a page of a file is up to 100,000 characters. */
export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

/** The API said no, or could not be reached, or answered in a shape this client does not read. */
export class ApiError extends Error {
  /** HTTP status, or 0 when there was no response at all. */
  readonly status: number;
  /** The stable code from the error body, `network` or `invalid_response`. */
  readonly code: string;
  /** With `skill.ambiguous`: the directories to choose from. */
  readonly directories: readonly string[];
  /** With `file.too_large`, `file.not_text` and `file.not_served`: where the file is at its host. */
  readonly sourceUrl: string | undefined;
  /** With a `503` of the git host: when to try again. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: {
      readonly directories?: readonly string[] | undefined;
      readonly sourceUrl?: string | undefined;
      readonly retryAfterSeconds?: number | undefined;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.directories = extra.directories ?? [];
    this.sourceUrl = extra.sourceUrl;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }
}

interface Schema<T> {
  readonly safeParse: (data: unknown) => { success: true; data: T } | { success: false };
}

/** Which of several query parameters are given, in the order given, as a query string. */
function queryOf(params: Readonly<Record<string, string | number | undefined>>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(name, String(value));
    }
  }
  const text = query.toString();
  return text.length === 0 ? "" : `?${text}`;
}

export interface SkillCdnClient {
  /** What the address serves: the pack, its index when ready, its skills and documents. */
  mount(address: Address, signal?: AbortSignal): Promise<RestMount>;
  /** `browse_repo`: what a folder holds, a page of it. */
  browse(
    address: Address,
    query: {
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    },
    signal?: AbortSignal,
  ): Promise<RestBrowse>;
  /** `search_repo`: what words find, or every skill and document without words; a page. */
  find(
    address: Address,
    query: {
      readonly query?: string | undefined;
      readonly path?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    },
    signal?: AbortSignal,
  ): Promise<RestFind>;
  /** `load_skill`: a page of a skill's context, by the exact path of its `SKILL.md`. */
  skill(
    address: Address,
    query: { readonly path: string; readonly cursor?: string | undefined },
    signal?: AbortSignal,
  ): Promise<RestSkill>;
  /** `read_repo_file`: a page of a file. */
  file(
    address: Address,
    query: {
      readonly path: string;
      readonly offset?: number | undefined;
      readonly limit?: number | undefined;
    },
    signal?: AbortSignal,
  ): Promise<RestFile>;
  featured(signal?: AbortSignal): Promise<RestFeatured>;
  showcase(signal?: AbortSignal): Promise<RestShowcase>;
  legal(kind: LegalDocumentKind, signal?: AbortSignal): Promise<RestLegalDocument>;
  /** The page of an account, a page of its repositories. */
  owner(owner: OwnerPath, page: number, signal?: AbortSignal): Promise<RestOwner>;
  // What belongs to whoever is signed in: by the session of the deployment's own pages, which
  // a browser sends; a token reads its repository and nothing of these.
  me(signal?: AbortSignal): Promise<RestMe>;
  myRepositories(signal?: AbortSignal): Promise<RestMyRepositories>;
  myGrants(signal?: AbortSignal): Promise<RestGrants>;
  removeGrant(id: string): Promise<void>;
  myTokens(signal?: AbortSignal): Promise<RestRepoTokens>;
  /** Makes a token and answers with its secret, which the server shows this once. */
  makeToken(request: RestRepoTokenRequest): Promise<RestNewRepoToken>;
  removeToken(id: string): Promise<void>;
  signOut(): Promise<void>;
  /** What a client asked a person to allow, for the consent page. */
  authorization(request: string, signal?: AbortSignal): Promise<RestAuthorization>;
  /** The person's answer; the reply says where their browser goes with it. */
  decide(request: string, approve: boolean): Promise<string>;
  // A command connecting with a code a person approves (ADR-0059): the command begins and
  // claims, as nobody; the person looks and decides, by their session on the deployment's pages.
  /** Begins a connection: the code to show the person, the page to open, and the secret to claim with. */
  connect(request: RestConnectRequest, signal?: AbortSignal): Promise<RestConnectStarted>;
  /** What the command was approved, this once, or that the person has not answered yet. */
  claimConnection(secret: string, signal?: AbortSignal): Promise<RestConnectClaimed>;
  /** What asks to connect under a code, for the person who would approve it. */
  connection(code: string, signal?: AbortSignal): Promise<RestConnectView>;
  /** The person's answer to a command that asks to connect. */
  decideConnection(code: string, decision: RestConnectDecision): Promise<RestConnectDecided>;
}

export function createClient(options: ClientOptions): SkillCdnClient {
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const base = options.baseUrl.replace(/\/+$/, "");

  const headersOf = (body: boolean): Record<string, string> => ({
    accept: "application/json",
    ...(body ? { "content-type": "application/json" } : {}),
    ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
    ...(options.userAgent === undefined ? {} : { "user-agent": options.userAgent }),
  });

  /** One request, and its body as the API's JSON; what went wrong is an ApiError. */
  const exchange = async (
    method: "GET" | "POST" | "DELETE",
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<{ readonly response: Response; readonly json: unknown }> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await send(`${base}${path}`, {
        method,
        headers: headersOf(body !== undefined),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // A token goes to the origin it was made for and nowhere it is sent on to.
        redirect: "error",
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      if (signal?.aborted === true) {
        throw error;
      }
      throw new ApiError(
        0,
        "network",
        timeout.aborted ? "The server did not answer in time." : "The server could not be reached.",
      );
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBodyBytes) {
      await response.body?.cancel();
      throw new ApiError(
        response.status,
        "invalid_response",
        "The server answered more than is read.",
      );
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (signal?.aborted === true) {
        throw error;
      }
      throw new ApiError(0, "network", "The server stopped answering.");
    }
    if (text.length > maxBodyBytes) {
      throw new ApiError(
        response.status,
        "invalid_response",
        "The server answered more than is read.",
      );
    }
    let json: unknown;
    try {
      json = text.length === 0 ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      const parsed = restErrorSchema.safeParse(json);
      const retryAfter = Number(response.headers.get("retry-after") ?? "");
      throw parsed.success
        ? new ApiError(response.status, parsed.data.error.code, parsed.data.error.message, {
            directories: parsed.data.error.directories,
            sourceUrl: parsed.data.error.sourceUrl,
            retryAfterSeconds:
              Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
          })
        : new ApiError(response.status, "invalid_response", "The server answered unexpectedly.");
    }
    return { response, json };
  };

  const read = async <T>(
    path: string,
    schema: Schema<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> => {
    const { response, json } = await exchange("GET", path, undefined, signal);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(response.status, "invalid_response", "The server answered unexpectedly.");
    }
    return parsed.data;
  };

  const write = async <T>(
    method: "POST" | "DELETE",
    path: string,
    body: unknown,
    schema: Schema<T> | undefined,
  ): Promise<T | undefined> => {
    const { response, json } = await exchange(method, path, body, undefined);
    if (schema === undefined) {
      return undefined;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(response.status, "invalid_response", "The server answered unexpectedly.");
    }
    return parsed.data;
  };

  return {
    mount: (address, signal) => read(restPath("mounts", address), restMountSchema, signal),
    browse: (address, query, signal) =>
      read(
        `${restPath("browse", address)}${queryOf({ path: query.path, cursor: query.cursor, limit: query.limit })}`,
        restBrowseSchema,
        signal,
      ),
    find: (address, query, signal) =>
      read(
        `${restPath("find", address)}${queryOf({ query: query.query, path: query.path, cursor: query.cursor, limit: query.limit })}`,
        restFindSchema,
        signal,
      ),
    skill: (address, query, signal) =>
      read(
        `${restPath("skills", address)}${queryOf({ path: query.path, cursor: query.cursor })}`,
        restSkillSchema,
        signal,
      ),
    file: (address, query, signal) =>
      read(
        `${restPath("files", address)}${queryOf({ path: query.path, offset: query.offset, limit: query.limit })}`,
        restFileSchema,
        signal,
      ),
    featured: (signal) => read(REST_ROUTES.featured, restFeaturedSchema, signal),
    showcase: (signal) => read(REST_ROUTES.showcase, restShowcaseSchema, signal),
    legal: (kind, signal) => read(legalPath(kind), restLegalDocumentSchema, signal),
    owner: (owner, page, signal) =>
      read(
        `${ownerRestPath(owner)}${queryOf({ page: page === 1 ? undefined : page })}`,
        restOwnerSchema,
        signal,
      ),
    me: (signal) => read(REST_ROUTES.me, restMeSchema, signal),
    myRepositories: (signal) =>
      read(`${REST_ROUTES.me}/repositories`, restMyRepositoriesSchema, signal),
    myGrants: (signal) => read(`${REST_ROUTES.me}/grants`, restGrantsSchema, signal),
    removeGrant: async (id) => {
      await write(
        "DELETE",
        `${REST_ROUTES.me}/grants/${encodeURIComponent(id)}`,
        undefined,
        undefined,
      );
    },
    myTokens: (signal) => read(`${REST_ROUTES.me}/tokens`, restRepoTokensSchema, signal),
    makeToken: async (request) => {
      const made = await write("POST", `${REST_ROUTES.me}/tokens`, request, restNewRepoTokenSchema);
      if (made === undefined) {
        throw new ApiError(0, "invalid_response", "The server answered unexpectedly.");
      }
      return made;
    },
    removeToken: async (id) => {
      await write(
        "DELETE",
        `${REST_ROUTES.me}/tokens/${encodeURIComponent(id)}`,
        undefined,
        undefined,
      );
    },
    signOut: async () => {
      await write("POST", AUTH_ROUTES.logout, undefined, undefined);
    },
    authorization: (request, signal) =>
      read(
        `${REST_ROUTES.authorization}${queryOf({ [CONSENT_REQUEST_PARAM]: request })}`,
        restAuthorizationSchema,
        signal,
      ),
    decide: async (request, approve) => {
      const answer = await write(
        "POST",
        REST_ROUTES.decision,
        { request, approve },
        restAuthorizationDecisionSchema,
      );
      if (answer === undefined) {
        throw new ApiError(200, "invalid_response", "The server answered unexpectedly.");
      }
      return answer.redirect;
    },
    connect: async (request, signal) => {
      const { response, json } = await exchange("POST", REST_ROUTES.connect, request, signal);
      const parsed = restConnectStartedSchema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError(
          response.status,
          "invalid_response",
          "The server answered unexpectedly.",
        );
      }
      return parsed.data;
    },
    claimConnection: async (secret, signal) => {
      const { response, json } = await exchange(
        "POST",
        `${REST_ROUTES.connect}/claim`,
        { secret },
        signal,
      );
      const parsed = restConnectClaimedSchema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError(
          response.status,
          "invalid_response",
          "The server answered unexpectedly.",
        );
      }
      return parsed.data;
    },
    connection: (code, signal) =>
      read(`${REST_ROUTES.connect}/${encodeURIComponent(code)}`, restConnectViewSchema, signal),
    decideConnection: async (code, decision) => {
      const answer = await write(
        "POST",
        `${REST_ROUTES.connect}/${encodeURIComponent(code)}/decision`,
        decision,
        restConnectDecidedSchema,
      );
      if (answer === undefined) {
        throw new ApiError(200, "invalid_response", "The server answered unexpectedly.");
      }
      return answer;
    },
  };
}
