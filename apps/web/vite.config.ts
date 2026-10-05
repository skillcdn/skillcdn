import process from "node:process";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { handleFixtureRequest } from "./dev/fixture-api.js";

/** Long enough to see loading states, short enough not to be in the way. */
const FIXTURE_LATENCY_MS = 350;
/** More than any request to the fixtures carries. */
const FIXTURE_BODY_BYTES = 64 * 1024;

/**
 * Answers the REST API from fixtures, and signs the fixture person in and out, so the UI runs
 * without a server behind it.
 */
function fixtureApi(): Plugin {
  return {
    name: "skillcdn-fixture-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        // What a request carries, for the few that carry something: small, and JSON.
        let body: unknown;
        if (request.method === "POST") {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += (chunk as Buffer).length;
            if (size <= FIXTURE_BODY_BYTES) {
              chunks.push(chunk as Buffer);
            }
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            body = undefined;
          }
        }
        const answer = handleFixtureRequest(
          new URL(request.url ?? "/", "http://fixtures.invalid"),
          Date.now(),
          request.method ?? "GET",
          body,
        );
        if (answer === undefined) {
          next();
          return;
        }
        setTimeout(() => {
          response.statusCode = answer.status;
          response.setHeader("cache-control", "no-store");
          if (answer.location !== undefined) {
            response.setHeader("location", answer.location);
          }
          if (answer.body === undefined) {
            response.end();
            return;
          }
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(JSON.stringify(answer.body));
        }, FIXTURE_LATENCY_MS);
      });
    },
  };
}

/** A request for a page, which the development server answers itself whatever the path. */
const wantsPage = (request: { method?: string; headers: { accept?: string } }): boolean =>
  request.method === "GET" && (request.headers.accept ?? "").includes("text/html");

/** Where each mode sends the REST API and MCP, unless SKILLCDN_API_URL says otherwise. */
const API_BY_MODE: Readonly<Record<string, string>> = {
  // `vite --mode api`: a server on this machine.
  api: "http://127.0.0.1:11188",
  // `vite --mode live`: the hosted service, to work on the UI against what visitors see.
  live: "https://skillcdn.ai",
};

// `vite` serves the UI against fixtures. The other modes proxy to a real server instead:
// API_BY_MODE, or SKILLCDN_API_URL from apps/web/.env.local.
export default defineConfig(({ mode, isSsrBuild }) => {
  const env = loadEnv(mode, process.cwd(), "SKILLCDN_");
  const defaultApi = API_BY_MODE[mode];
  const apiUrl = defaultApi === undefined ? undefined : (env.SKILLCDN_API_URL ?? defaultApi);

  return {
    plugins: [react(), ...(apiUrl === undefined ? [fixtureApi()] : [])],
    server: {
      // Next to the integrated server's 11188, so that every local port of the project is one
      // block; another Vite instance takes the next free one.
      port: 11189,
      ...(apiUrl === undefined
        ? {}
        : {
            proxy: {
              "/api": { target: apiUrl, changeOrigin: true },
              // The operator's uploads, which the showcase names by hash.
              "/media": { target: apiUrl, changeOrigin: true },
              // An address answers browsers with the UI and everything else with MCP, so the
              // development server does the same: pages stay here, MCP goes to the server.
              "/gh": {
                target: apiUrl,
                changeOrigin: true,
                bypass: (request) => (wantsPage(request) ? "/index.html" : undefined),
              },
              // Signing in and out are the server's, and so is its authorization server, apart
              // from the one page of it that belongs to the UI: the page that asks for consent.
              "/auth": { target: apiUrl, changeOrigin: true },
              "/.well-known": { target: apiUrl, changeOrigin: true },
              "/oauth": {
                target: apiUrl,
                changeOrigin: true,
                bypass: (request) =>
                  wantsPage(request) && (request.url ?? "").startsWith("/oauth/consent")
                    ? "/index.html"
                    : undefined,
              },
            },
          }),
    },
    // The files of public/ belong to the client build; the render bundle is only code.
    publicDir: isSsrBuild === true ? false : "public",
    build: {
      // The client build starts the output directory; the render bundle is written into it next
      // and must not empty it. The prerender step then reads both.
      emptyOutDir: isSsrBuild !== true,
      sourcemap: isSsrBuild !== true,
    },
    ssr: {
      // The render bundle is loaded by the server, which has none of this workspace's
      // dependencies: everything it needs is bundled in, apart from Node's own modules.
      noExternal: true,
    },
  };
});
