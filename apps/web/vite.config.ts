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

// `vite` serves the UI against fixtures. `vite --mode api` proxies to a real server instead:
// http://127.0.0.1:8080, or SKILLCDN_API_URL from apps/web/.env.local.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "SKILLCDN_");
  const apiUrl = mode === "api" ? (env.SKILLCDN_API_URL ?? "http://127.0.0.1:8080") : undefined;

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
    build: {
      // The prerender step reads this build and writes next to it.
      emptyOutDir: true,
      sourcemap: true,
    },
  };
});
