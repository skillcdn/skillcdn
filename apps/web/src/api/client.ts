import {
  type Address,
  REST_ROUTES,
  type RestFeatured,
  type RestFile,
  type RestFind,
  type RestMount,
  type RestSkill,
  restErrorSchema,
  restFeaturedSchema,
  restFileSchema,
  restFindSchema,
  restMountSchema,
  restPath,
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

export const api = {
  mount: (address: Address, signal: AbortSignal): Promise<RestMount> =>
    getJson(restPath("mounts", address), {}, restMountSchema, signal),

  find: (address: Address, query: string, signal: AbortSignal): Promise<RestFind> =>
    getJson(restPath("find", address), { query, limit: "25" }, restFindSchema, signal),

  skill: (address: Address, name: string, signal: AbortSignal): Promise<RestSkill> =>
    getJson(restPath("skills", address), { name }, restSkillSchema, signal),

  file: (address: Address, path: string, offset: number, signal: AbortSignal): Promise<RestFile> =>
    getJson(
      restPath("files", address),
      { path, offset: offset === 0 ? undefined : String(offset) },
      restFileSchema,
      signal,
    ),

  featured: (signal: AbortSignal): Promise<RestFeatured> =>
    getJson(REST_ROUTES.featured, {}, restFeaturedSchema, signal),
};
