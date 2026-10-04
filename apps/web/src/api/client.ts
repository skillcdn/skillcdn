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
  type RestFeatured,
  type RestFile,
  type RestFind,
  type RestGrants,
  type RestLegalDocument,
  type RestMe,
  type RestMount,
  type RestMyRepositories,
  type RestOwner,
  type RestShowcase,
  type RestSkill,
  restAuthorizationDecisionSchema,
  restAuthorizationSchema,
  restBrowseSchema,
  restErrorSchema,
  restFeaturedSchema,
  restFileSchema,
  restFindSchema,
  restGrantsSchema,
  restLegalDocumentSchema,
  restMeSchema,
  restMountSchema,
  restMyRepositoriesSchema,
  restOwnerSchema,
  restPath,
  restShowcaseSchema,
  restSkillSchema,
} from "@skillcdn/core";

// The only module that talks to the server. Contract: docs/specs/rest.md; every response is
// parsed with the schemas the server is tested against.

export class ApiError extends Error {
  /** HTTP status, or 0 when there was no response at all. */
  readonly status: number;
  /** The stable code from the error body, `network` or `invalid_response`. */
  readonly code: string;
  /** With `skill.ambiguous`: the directories to choose from. */
  readonly directories: readonly string[];

  constructor(status: number, code: string, message: string, directories: readonly string[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.directories = directories;
  }
}

interface Schema<T> {
  readonly safeParse: (data: unknown) => { success: true; data: T } | { success: false };
}

async function getJson<T>(
  path: string,
  params: Record<string, string | undefined>,
  schema: Schema<T>,
  signal: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(name, value);
    }
  }
  const url = query.size === 0 ? path : `${path}?${query.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { accept: "application/json" } });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new ApiError(0, "network", "The server could not be reached.");
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = restErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiError(
          response.status,
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.directories,
        )
      : new ApiError(response.status, "invalid_response", "The server answered unexpectedly.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(response.status, "invalid_response", "The server answered unexpectedly.");
  }
  return parsed.data;
}

/**
 * Sends something that changes what the person who is signed in has here. Same origin, so the
 * session cookie goes with it, and the browser names the origin, which the server checks.
 */
async function send<T>(
  method: "POST" | "DELETE",
  path: string,
  body: unknown,
  schema: Schema<T> | undefined,
  signal?: AbortSignal,
): Promise<T | undefined> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      ...(signal === undefined ? {} : { signal }),
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    throw new ApiError(0, "network", "The server could not be reached.");
  }
  const answer: unknown =
    response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = restErrorSchema.safeParse(answer);
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(response.status, "invalid_response", "The server answered unexpectedly.");
  }
  if (schema === undefined) {
    return undefined;
  }
  const parsed = schema.safeParse(answer);
  if (!parsed.success) {
    throw new ApiError(response.status, "invalid_response", "The server answered unexpectedly.");
  }
  return parsed.data;
}

export const api = {
  /** Whoever is signed in on this browser, or nobody. */
  me: (signal: AbortSignal): Promise<RestMe> => getJson(REST_ROUTES.me, {}, restMeSchema, signal),

  myRepositories: (signal: AbortSignal): Promise<RestMyRepositories> =>
    getJson(`${REST_ROUTES.me}/repositories`, {}, restMyRepositoriesSchema, signal),

  myGrants: (signal: AbortSignal): Promise<RestGrants> =>
    getJson(`${REST_ROUTES.me}/grants`, {}, restGrantsSchema, signal),

  removeGrant: async (id: string): Promise<void> => {
    await send(
      "DELETE",
      `${REST_ROUTES.me}/grants/${encodeURIComponent(id)}`,
      undefined,
      undefined,
    );
  },

  signOut: async (): Promise<void> => {
    await send("POST", AUTH_ROUTES.logout, undefined, undefined);
  },

  owner: (owner: OwnerPath, page: number, signal: AbortSignal): Promise<RestOwner> =>
    getJson(
      ownerRestPath(owner),
      { page: page === 1 ? undefined : String(page) },
      restOwnerSchema,
      signal,
    ),

  /** What a client asked a person to allow, for the consent page. */
  authorization: (request: string, signal: AbortSignal): Promise<RestAuthorization> =>
    getJson(
      REST_ROUTES.authorization,
      { [CONSENT_REQUEST_PARAM]: request },
      restAuthorizationSchema,
      signal,
    ),

  /** The person's answer; the reply says where their browser goes with it. */
  decide: async (request: string, approve: boolean): Promise<string> => {
    const answer = await send(
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

  mount: (address: Address, signal: AbortSignal): Promise<RestMount> =>
    getJson(restPath("mounts", address), {}, restMountSchema, signal),

  browse: (
    address: Address,
    path: string,
    signal: AbortSignal,
    cursor?: string,
  ): Promise<RestBrowse> =>
    getJson(restPath("browse", address), { path, cursor, limit: "40" }, restBrowseSchema, signal),

  find: (
    address: Address,
    query: string,
    path: string,
    signal: AbortSignal,
    cursor?: string,
  ): Promise<RestFind> =>
    getJson(
      restPath("find", address),
      { query, path, cursor, limit: "25" },
      restFindSchema,
      signal,
    ),

  skill: (
    address: Address,
    path: string,
    signal: AbortSignal,
    cursor?: string,
  ): Promise<RestSkill> =>
    getJson(restPath("skills", address), { path, cursor }, restSkillSchema, signal),

  file: (address: Address, path: string, offset: number, signal: AbortSignal): Promise<RestFile> =>
    getJson(
      restPath("files", address),
      { path, offset: offset === 0 ? undefined : String(offset) },
      restFileSchema,
      signal,
    ),

  featured: (signal: AbortSignal): Promise<RestFeatured> =>
    getJson(REST_ROUTES.featured, {}, restFeaturedSchema, signal),

  showcase: (signal: AbortSignal): Promise<RestShowcase> =>
    getJson(REST_ROUTES.showcase, {}, restShowcaseSchema, signal),

  legal: (kind: LegalDocumentKind, signal: AbortSignal): Promise<RestLegalDocument> =>
    getJson(legalPath(kind), {}, restLegalDocumentSchema, signal),
};
