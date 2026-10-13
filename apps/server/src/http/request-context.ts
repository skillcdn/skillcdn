import { createMiddleware } from "hono/factory";
import type { Logger } from "../logger.js";
import { acceptRequestId, type ClientAddressResolver } from "./client-address.js";
import { normalizeCountry } from "./consent-regions.js";

export interface AppEnv {
  Variables: {
    /** Taken from a trusted proxy, or made here. Returned as `x-request-id` and logged. */
    requestId: string;
    clientAddress: string | undefined;
    /** The visitor's region as a trusted proxy named it (`DE`, `US-CA`); unknown otherwise. */
    clientCountry: string | undefined;
  };
}

export interface RequestContextOptions {
  readonly logger: Logger;
  readonly addresses: ClientAddressResolver;
  /** Lowercase name of the header in which a trusted proxy passes its request id. */
  readonly requestIdHeader: string;
  /** Lowercase name of the header in which a trusted proxy names the visitor's country, if any. */
  readonly clientCountryHeader?: string | undefined;
  readonly accessLog: boolean;
  readonly newRequestId: () => string;
  /** Milliseconds from a clock that never goes backwards. */
  readonly now: () => number;
}

/** Probes answer every few seconds for as long as the process lives; they would drown the log. */
const UNLOGGED_PATHS = new Set(["/healthz", "/readyz"]);
const MAX_LOGGED_USER_AGENT = 200;

/** The address of the peer on the socket. Absent when the app is called without a socket (tests). */
function peerAddressOf(env: unknown): string | undefined {
  if (typeof env !== "object" || env === null || !("incoming" in env)) {
    return undefined;
  }
  const { incoming } = env;
  if (typeof incoming !== "object" || incoming === null || !("socket" in incoming)) {
    return undefined;
  }
  const { socket } = incoming;
  if (typeof socket !== "object" || socket === null || !("remoteAddress" in socket)) {
    return undefined;
  }
  return typeof socket.remoteAddress === "string" ? socket.remoteAddress : undefined;
}

/**
 * Gives every request an id and a client address, and writes one access-log line per request.
 * The line is written when the response starts; a streamed body may still be on its way.
 */
export function requestContext(options: RequestContextOptions) {
  const { logger, addresses, requestIdHeader, clientCountryHeader, accessLog } = options;
  const { newRequestId, now } = options;
  return createMiddleware<AppEnv>(async (c, next) => {
    const started = now();
    const peer = peerAddressOf(c.env);
    const trusted = addresses.isTrusted(peer);
    const requestId =
      (trusted ? acceptRequestId(c.req.header(requestIdHeader) ?? null) : undefined) ??
      newRequestId();
    const clientAddress = addresses.resolve(peer, c.req.raw.headers);
    // Where the visitor is, as the proxy says: anyone can send the header, so from anyone else
    // it says nothing.
    const clientCountry =
      trusted && clientCountryHeader !== undefined
        ? normalizeCountry(c.req.header(clientCountryHeader))
        : undefined;
    c.set("requestId", requestId);
    c.set("clientAddress", clientAddress);
    c.set("clientCountry", clientCountry);

    await next();

    c.header("x-request-id", requestId);
    const path = c.req.path;
    if (accessLog && !UNLOGGED_PATHS.has(path)) {
      logger.info(
        {
          requestId,
          method: c.req.method,
          // Without the query string: it is the one part of a URL that tends to grow secrets.
          path,
          status: c.res.status,
          durationMs: Math.round(now() - started),
          clientAddress,
          userAgent: c.req.header("user-agent")?.slice(0, MAX_LOGGED_USER_AGENT),
        },
        "request",
      );
    }
  });
}
