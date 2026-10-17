import type { Readable, Writable } from "node:stream";
import { serve as listen } from "@hono/node-server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  type Address,
  type Clock,
  formatAddress,
  type IndexNotReady,
  type MountOverview,
  mountBody,
  parseAddress,
  type RestMount,
} from "@skillcdn/core";
import type { Reader } from "@skillcdn/reader";
import { type Context, Hono } from "hono";
import type { ServedMount } from "./mount.js";
import { errorBody, registerAddressRoutes } from "./rest.js";
import { createMountServer, type ServeLogger, type ToolDependencies } from "./tools.js";

// A server of a machine's own (ADR-0053, ADR-0057): the mounts it was given, served as a
// deployment serves an address, over stdio to one client or over HTTP to any, with no
// authorization, since everything it serves is the person's own, and no page but a listing.

export interface LocalServerOptions<M extends ServedMount> {
  /** The mounts served, each at its address. */
  readonly mounts: readonly M[];
  readonly reader: Reader<M>;
  readonly clock: Clock;
  readonly logger: ServeLogger;
  readonly server: ToolDependencies<M>["server"];
}

/** The `mounts` body of a mount served from a machine: what names it, and no picture. */
export function localMountBody<M extends ServedMount>(
  mount: M,
  answer: IndexNotReady | { readonly status: "ready"; readonly overview: MountOverview },
): RestMount {
  const { address } = mount;
  return mountBody(
    {
      address,
      repository: {
        host: address.host,
        owner: address.owner,
        name: address.repo,
        defaultBranch: "",
        description: mount.description ?? null,
        avatar: "",
        visibility: mount.visibility,
      },
      commit: mount.commit,
      verified: mount.verified,
      image: () => null,
    },
    answer,
  );
}

/** The served mount an address names, or nothing: a ref or a path it does not have is nothing. */
export function mountOf<M extends ServedMount>(
  mounts: readonly M[],
  address: Address,
): M | undefined {
  return mounts.find(
    (mount) =>
      mount.address.host === address.host &&
      mount.address.owner === address.owner &&
      mount.address.repo === address.repo &&
      address.ref === undefined &&
      address.path === mount.address.path,
  );
}

const toolDependencies = <M extends ServedMount>(
  options: LocalServerOptions<M>,
): ToolDependencies<M> => ({
  reader: options.reader,
  clock: options.clock,
  logger: options.logger,
  indexWaitMs: 0,
  server: options.server,
});

/**
 * The HTTP app of a server of a machine's own: MCP at every mount's address, the REST routes of
 * the address, and a listing of the mounts at the root for whoever looks.
 */
export function createLocalApp<M extends ServedMount>(options: LocalServerOptions<M>): Hono {
  const app = new Hono();
  const { mounts, logger } = options;
  const resolve = (pathname: string): M | Response => {
    const parsed = parseAddress(pathname);
    if (!parsed.ok) {
      return new Response(
        JSON.stringify(errorBody(`address.${parsed.error.code}`, parsed.error.message)),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }
    const mount = mountOf(mounts, parsed.value);
    return (
      mount ??
      new Response(
        JSON.stringify(errorBody("mount.repo_not_found", "The repository was not found.")),
        { status: 404, headers: { "content-type": "application/json" } },
      )
    );
  };
  const mountAt = async (c: Context, prefix: string): Promise<M | Response> =>
    resolve(new URL(c.req.url).pathname.slice(prefix.length));

  registerAddressRoutes(app, {
    reader: options.reader,
    logger,
    mountAt,
    mountBody: localMountBody,
  });

  app.get("/", (c) =>
    c.text(
      [
        `${options.server.name} ${options.server.version}: ${mounts.length === 1 ? "one pack" : `${mounts.length} packs`} served from this machine.`,
        ...mounts.map((mount) => `${formatAddress(mount.address)}  ${mount.repository}`),
        "",
        "Connect an MCP client to the address, or read it through the REST API under /api/v1/.",
        "",
      ].join("\n"),
    ),
  );

  const mcp = createMcpHandler(
    async (context) => {
      const request = context.requestInfo;
      const pathname = request === undefined ? "" : new URL(request.url).pathname;
      const mount = resolve(pathname);
      if (mount instanceof Response) {
        throw new Error("no mount was resolved for this request");
      }
      return await createMountServer(mount, toolDependencies(options), {
        origin: request === undefined ? undefined : new URL(request.url).origin,
      });
    },
    { onerror: (error) => logger.warn({ err: error }, "mcp handler error") },
  );
  for (const mount of mounts) {
    app.all(formatAddress(mount.address), async (c) => {
      const response = await mcp.fetch(c.req.raw);
      response.headers.set("cache-control", "no-store");
      return response;
    });
  }
  return app;
}

export interface StdioServer {
  /** Resolves when the connection ended: the client closed its end, or `close` was called. */
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

/**
 * Serves one mount to the client at the other end of the streams given: the process's standard
 * input and output when a client started the command. The transport closes itself when the input
 * ends, as the stdio binding asks of a server, and `closed` resolves then; nothing but the
 * protocol is written to the output.
 */
export async function serveOverStdio<M extends ServedMount>(
  mount: M,
  options: Omit<LocalServerOptions<M>, "mounts"> & {
    readonly stdin: Readable;
    readonly stdout: Writable;
  },
): Promise<StdioServer> {
  const server = await createMountServer(mount, toolDependencies({ ...options, mounts: [mount] }));
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
  });
  await server.connect(new StdioServerTransport(options.stdin, options.stdout));
  return { closed, close: () => server.close() };
}

export interface Listening {
  /** Where the server answers: `http://<host>:<port>`. */
  readonly url: string;
  close(): Promise<void>;
}

/** Listens on `host` and `port`; `0` takes any free port. */
export async function listenOn(
  app: Hono,
  options: { readonly host: string; readonly port: number },
): Promise<Listening> {
  const server = listen({ fetch: app.fetch, hostname: options.host, port: options.port });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const bound = server.address();
  const port = typeof bound === "object" && bound !== null ? bound.port : options.port;
  const host = options.host.includes(":") ? `[${options.host}]` : options.host;
  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
