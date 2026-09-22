import process from "node:process";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { handleFixtureRequest } from "./dev/fixture-api.js";

/** Long enough to see loading states, short enough not to be in the way. */
const FIXTURE_LATENCY_MS = 350;

/** Answers the REST API from fixtures, so the UI runs without a server behind it. */
function fixtureApi(): Plugin {
  return {
    name: "skillcdn-fixture-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const answer = handleFixtureRequest(new URL(request.url ?? "/", "http://fixtures.invalid"));
        if (answer === undefined) {
          next();
          return;
        }
        setTimeout(() => {
          response.statusCode = answer.status;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.end(JSON.stringify(answer.body));
        }, FIXTURE_LATENCY_MS);
      });
    },
  };
}

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
      port: 5173,
      ...(apiUrl === undefined
        ? {}
        : {
            proxy: {
              "/api": { target: apiUrl, changeOrigin: true },
              // An address answers browsers with the UI and everything else with MCP, so the
              // development server does the same: pages stay here, MCP goes to the server.
              "/gh": {
                target: apiUrl,
                changeOrigin: true,
                bypass: (request) =>
                  request.method === "GET" && (request.headers.accept ?? "").includes("text/html")
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
