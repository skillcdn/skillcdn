import { GitHostError } from "@skillcdn/core";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Supplies the credential for a request. Called per request; the value is never stored. */
export type TokenProvider = () => Promise<string | undefined>;

export interface HttpOptions {
  /** Operator configuration, never user input. For example `https://api.github.com`. */
  readonly baseUrl: string;
  /**
   * Origins, besides the one of the base URL, that the host may redirect a download to.
   * Requests to them never carry credentials.
   */
  readonly downloadOrigins: readonly string[];
  readonly userAgent: string;
  readonly token: TokenProvider | undefined;
  readonly fetch: FetchLike;
  readonly timeoutMs: number;
  /** Attempts for failures worth retrying (network errors and 5xx), including the first one. */
  readonly attempts: number;
  readonly retryBaseDelayMs: number;
  /** Entries in the conditional-request cache. */
  readonly maxCacheEntries: number;
}

export interface HttpRequest {
  readonly accept: string;
  /** Revalidate a stored ETag instead of refetching. For resources that change. */
  readonly conditional?: boolean;
  readonly maxBytes?: number;
  /** Statuses that mean "no such thing" for this endpoint, beyond the usual ones. */
  readonly notFoundStatuses?: readonly number[];
}

export interface HttpReply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

interface CachedReply {
  readonly etag: string;
  readonly reply: HttpReply;
}

const API_VERSION = "2022-11-28";
const MAX_REDIRECTS = 3;
/** Metadata replies are small; this bounds what a misbehaving upstream can make us buffer. */
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Reads a body up to `maxBytes`, then stops: `content-length` is a hint, not a promise. */
async function readBody(response: Response, maxBytes: number): Promise<Uint8Array | undefined> {
  if (response.body === null) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function retryAfterSeconds(headers: Headers, nowSeconds: number): number | undefined {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.ceil(retryAfter);
  }
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(reset) && reset > 0) {
    return Math.max(1, Math.ceil(reset - nowSeconds));
  }
  return undefined;
}

function isRateLimited(status: number, headers: Headers): boolean {
  if (status === 429) {
    return true;
  }
  // Both rate limits answer 403; one zeroes the remaining quota, the other sends retry-after.
  return (
    status === 403 && (headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after"))
  );
}

function failure(response: Response, notFoundStatuses: readonly number[]): GitHostError {
  const { status, headers } = response;
  if (isRateLimited(status, headers)) {
    const seconds = retryAfterSeconds(headers, Date.now() / 1000);
    return new GitHostError("rate_limited", "the git host is rate limiting requests", {
      ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
    });
  }
  // Forbidden and unauthorized collapse into not found: callers must not be able to tell a
  // repository that does not exist from one they may not see.
  if ([401, 403, 404, 410, 451, ...notFoundStatuses].includes(status)) {
    return new GitHostError("not_found", "not found on the git host");
  }
  if (status >= 500) {
    return new GitHostError("transient", `the git host answered ${status}`);
  }
  return new GitHostError("invalid", `the git host rejected the request (${status})`);
}

/**
 * The HTTP behavior every GitHub call shares: credentials, conditional requests, redirects that
 * stay where the operator allows, bounded bodies, timeouts, retries and error translation.
 */
export class GitHubHttp {
  readonly #options: HttpOptions;
  readonly #origin: string;
  readonly #cache = new Map<string, CachedReply>();

  constructor(options: HttpOptions) {
    this.#options = options;
    this.#origin = new URL(options.baseUrl).origin;
  }

  /**
   * GETs `path` below the base URL. Returns 2xx replies; everything else becomes a
   * {@link GitHostError}. With `conditional`, a stored ETag is revalidated instead of refetched.
   */
  async get(path: string, request: HttpRequest): Promise<HttpReply> {
    const { attempts, retryBaseDelayMs } = this.#options;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#getOnce(path, request);
      } catch (error) {
        const retryable = error instanceof GitHostError && error.kind === "transient";
        if (!retryable || attempt >= attempts) {
          throw error;
        }
        // Full jitter keeps replicas that failed together from retrying together.
        await sleep(Math.random() * retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  /**
   * Opens a download and hands back the response with its body unread. The host may redirect a
   * download to one of the configured download origins. No retries: the caller owns the stream.
   */
  async open(
    path: string,
    request: {
      readonly accept: string;
      readonly signal: AbortSignal;
      readonly notFoundStatuses?: readonly number[];
    },
  ): Promise<Response> {
    const response = await this.#follow(path, { accept: request.accept }, request.signal, true);
    if (response.status >= 200 && response.status < 300) {
      return response;
    }
    await response.body?.cancel();
    throw failure(response, request.notFoundStatuses ?? []);
  }

  async #getOnce(path: string, request: HttpRequest): Promise<HttpReply> {
    const cacheKey = `${request.accept} ${path}`;
    const cached = request.conditional === true ? this.#cache.get(cacheKey) : undefined;
    const headers: Record<string, string> = { accept: request.accept };
    if (cached !== undefined) {
      headers["if-none-match"] = cached.etag;
    }
    const signal = AbortSignal.timeout(this.#options.timeoutMs);
    const response = await this.#follow(path, headers, signal, false);

    if (response.status === 304 && cached !== undefined) {
      this.#remember(cacheKey, cached);
      return cached.reply;
    }
    if (response.status >= 200 && response.status < 300) {
      const body = await readBody(response, request.maxBytes ?? DEFAULT_MAX_BYTES);
      if (body === undefined) {
        throw new GitHostError("invalid", "the git host sent more data than allowed");
      }
      const reply = { status: response.status, headers: response.headers, body };
      const etag = response.headers.get("etag");
      if (request.conditional === true && etag !== null) {
        this.#remember(cacheKey, { etag, reply });
      }
      return reply;
    }

    await response.body?.cancel();
    throw failure(response, request.notFoundStatuses ?? []);
  }

  /**
   * Sends the request and follows redirects by hand. A redirect may stay on the configured
   * origin (a renamed repository) or, for downloads only, go to a configured download origin.
   * Credentials are sent to the configured origin and nowhere else.
   */
  async #follow(
    path: string,
    extraHeaders: Readonly<Record<string, string>>,
    signal: AbortSignal,
    download: boolean,
  ): Promise<Response> {
    const token = await this.#options.token?.();
    let url = new URL(`${this.#options.baseUrl.replace(/\/+$/, "")}${path}`);
    for (let redirects = 0; ; redirects += 1) {
      const headers: Record<string, string> = {
        ...extraHeaders,
        "user-agent": this.#options.userAgent,
      };
      if (url.origin === this.#origin) {
        headers["x-github-api-version"] = API_VERSION;
        if (token !== undefined && token.length > 0) {
          headers.authorization = `Bearer ${token}`;
        }
      }
      let response: Response;
      try {
        response = await this.#options.fetch(url.href, {
          method: "GET",
          headers,
          redirect: "manual",
          signal,
        });
      } catch (error) {
        // The cause stays attached for logs; the message carries nothing request-specific.
        throw new GitHostError("transient", "the git host could not be reached", { cause: error });
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }
      await response.body?.cancel();
      // The target may carry a short-lived credential in its query, so it is never logged or
      // put into an error.
      const location = response.headers.get("location");
      const next = location === null ? null : URL.parse(location, url.href);
      const allowed =
        next !== null &&
        (next.origin === this.#origin ||
          (download &&
            next.protocol === "https:" &&
            this.#options.downloadOrigins.includes(next.origin)));
      if (next === null || !allowed || redirects >= MAX_REDIRECTS) {
        throw new GitHostError("invalid", "the git host sent a redirect that cannot be followed");
      }
      url = next;
    }
  }

  #remember(key: string, value: CachedReply): void {
    // Re-inserting moves the key to the end, so the first key is the least recently used.
    this.#cache.delete(key);
    this.#cache.set(key, value);
    if (this.#cache.size > this.#options.maxCacheEntries) {
      const oldest = this.#cache.keys().next().value;
      if (oldest !== undefined) {
        this.#cache.delete(oldest);
      }
    }
  }
}
