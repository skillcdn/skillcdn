import { Hono } from "hono";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import type { HubSearch } from "../search/hub.js";
import type { AppEnv } from "./request-context.js";
import { type RestDependencies, registerRest } from "./rest.js";

// The search route alone, over a search that does what the test tells it: what each of its
// answers tells a cache in front of the deployment (ADR-0075). What the search finds over a
// database is in hub.int.test.ts.

const unused = (): never => {
  throw new Error("the search route does not ask for this");
};

function appOver(search: HubSearch["search"]): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const dependencies: RestDependencies = {
    reader: {} as RestDependencies["reader"],
    logger: pino({ level: "silent" }),
    mountAt: unused,
    mountOf: unused,
    featured: unused,
    showcase: unused,
    legal: unused,
    owners: undefined,
    hub: { search, packs: async () => 0 },
    searchCacheMs: 300_000,
    now: () => 0,
  };
  registerRest(app, dependencies);
  return app;
}

describe("what a search across packs tells the caches", () => {
  it("lets them keep an answer for the time the deployment configures", async () => {
    const app = appOver(async (query) => ({ query, packs: 0, items: [] }));
    const response = await app.request("/api/v1/search?query=kettle");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=300",
    );
  });

  it("lets them keep nothing of an answer by meaning alone, given when the words ran out of time", async () => {
    const app = appOver(async (query) => ({
      query,
      packs: 0,
      items: [],
      ranking: { meaning: true, reranked: false, words: false },
    }));
    const response = await app.request("/api/v1/search?query=kettle");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ranking: { meaning: true, words: false } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("lets them keep nothing of a search that ran out of time", async () => {
    const app = appOver(async () => {
      throw Object.assign(new Error("canceling statement due to statement timeout"), {
        code: "57014",
      });
    });
    const response = await app.request("/api/v1/search?query=kettle");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "search.timeout" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("lets them keep nothing of a search that failed", async () => {
    const app = appOver(async () => {
      throw new Error("the database is away");
    });
    const response = await app.request("/api/v1/search?query=kettle");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "internal" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
