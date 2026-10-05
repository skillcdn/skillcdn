import { GitHostDeliveryError, type GitHostEventSource } from "@skillcdn/core";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HostEvents } from "../events/host-events.js";
import type { Logger } from "../logger.js";
import type { AppEnv } from "./request-context.js";
import { errorBody } from "./rest.js";

/** Where a git host delivers its events: the host's key ends the path, as it does for signing in. */
export const WEBHOOK_ROUTE_PREFIX = "/webhooks";

/**
 * The largest delivery that is read. A host sends larger ones, for a push of thousands of
 * commits; such a delivery is refused unread, and what it would have ended ends when its time
 * is up, as it does on a deployment that receives no events at all.
 */
const MAX_DELIVERY_BYTES = 4 * 1024 * 1024;

export interface WebhookDependencies {
  /** Reads a delivery, and refuses one the git host did not sign. */
  readonly source: GitHostEventSource;
  readonly events: HostEvents;
  readonly logger: Logger;
}

/**
 * The receiver of the git host's events (docs/specs/permissions.md, ADR-0038). It exists only
 * on a deployment that shares a secret with the host's app. Anyone can reach it, so nothing of
 * a delivery is looked at before its signature is verified, and a delivery can only ever end
 * what is remembered: there is nothing to gain by sending one.
 */
export function registerWebhooks(app: Hono<AppEnv>, dependencies: WebhookDependencies): void {
  const { source, events, logger } = dependencies;
  app.post(
    `${WEBHOOK_ROUTE_PREFIX}/${source.host}`,
    bodyLimit({
      maxSize: MAX_DELIVERY_BYTES,
      onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const body = new Uint8Array(await c.req.arrayBuffer());
      let delivery: ReturnType<GitHostEventSource["read"]>;
      try {
        delivery = source.read({ header: (name) => c.req.header(name), body });
      } catch (error) {
        if (!(error instanceof GitHostDeliveryError)) {
          throw error;
        }
        logger.warn(
          { problem: error.problem, requestId: c.get("requestId") },
          "a delivery of the git host was refused",
        );
        return error.problem === "unsigned"
          ? c.json(errorBody(error.code, "The delivery is not signed by the git host."), 401)
          : c.json(errorBody(error.code, "The delivery could not be read."), 400);
      }
      let concerned = 0;
      for (const event of delivery.events) {
        concerned += await events.apply(event);
      }
      // Most deliveries are about repositories nobody opened here: those are not worth a line.
      logger[concerned > 0 ? "info" : "debug"](
        {
          delivery: delivery.id,
          event: delivery.name,
          applied: delivery.events.map((event) => event.kind),
          concerned,
          requestId: c.get("requestId"),
        },
        "git host event",
      );
      return c.body(null, 204);
    },
  );
}
