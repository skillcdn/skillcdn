import { parseAddress, type RestMount } from "@skillcdn/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pageOfMount,
  pageOfOwner,
  pageOfRoute,
  resetAnalyticsForTests,
  track,
  trackPage,
  WITHHELD_OWNER_PATH,
  WITHHELD_REPOSITORY_PATH,
} from "./analytics.js";
import { ApiError } from "./api/client.js";
import { matchRoute } from "./router.js";

// ADR-0050: analytics are told only what is public, as the page's own description of itself.

function address(text: string) {
  const parsed = parseAddress(text);
  if (!parsed.ok) {
    throw new Error(`not an address: ${text}`);
  }
  return parsed.value;
}

const mountOf = (visibility: "public" | "private" | undefined) =>
  ({ repository: { visibility } }) as unknown as RestMount;

describe("pageOfRoute", () => {
  it("names the pages that are the same for everyone, without what was typed", () => {
    expect(pageOfRoute(matchRoute("/", "?lang=ko"))).toEqual({ path: "/", title: "landing" });
    expect(pageOfRoute(matchRoute("/explore", ""))).toEqual({ path: "/explore", title: "explore" });
    expect(pageOfRoute(matchRoute("/docs", ""))).toEqual({ path: "/docs", title: "docs" });
    expect(pageOfRoute(matchRoute("/terms", ""))).toEqual({ path: "/terms", title: "terms" });
    expect(pageOfRoute(matchRoute("/account/tokens", "?repository=%2Fgh%2Facme%2Fsecret"))).toEqual(
      { path: "/account/tokens", title: "account" },
    );
    // The consent page carries a sealed request in its query, and a bad address or a missing
    // page is whatever was typed: neither leaves the page.
    expect(pageOfRoute(matchRoute("/oauth/consent", "?request=sealed.secret"))).toEqual({
      path: "/oauth/consent",
      title: "consent",
    });
    expect(pageOfRoute(matchRoute("/gh/acme", ""))).toBeUndefined();
    expect(pageOfRoute(matchRoute("/gh/acme/skills", ""))).toBeUndefined();
    expect(pageOfRoute(matchRoute("/gh/acme/skills@main:..%2Fup", ""))).toEqual({
      path: "/bad-address",
      title: "bad-address",
    });
    expect(pageOfRoute(matchRoute("/something/secret", ""))).toEqual({
      path: "/not-found",
      title: "not-found",
    });
  });
});

describe("pageOfMount", () => {
  const skills = address("/gh/acme/skills@main/marketing");

  it("says nothing until the server has answered", () => {
    expect(pageOfMount(skills, { kind: "overview", query: undefined }, {})).toBeUndefined();
  });

  it("sends the address of a public repository, with the view and a skill that loaded", () => {
    expect(
      pageOfMount(skills, { kind: "overview", query: undefined }, { mount: mountOf("public") }),
    ).toEqual({
      path: "/gh/acme/skills@main/marketing",
      title: "repository",
      params: { view: "overview", visibility: "public" },
    });
    expect(
      pageOfMount(
        skills,
        { kind: "overview", query: undefined, path: "marketing/ads" },
        { mount: mountOf("public") },
      )?.params,
    ).toEqual({ view: "folder", visibility: "public" });
    // A search is a search: what was searched for stays on the page.
    expect(
      pageOfMount(
        skills,
        { kind: "overview", query: "my secret project" },
        { mount: mountOf("public") },
      ),
    ).toEqual({
      path: "/gh/acme/skills@main/marketing",
      title: "repository",
      params: { view: "search", visibility: "public" },
    });
    const skill = { kind: "skill", path: "marketing/ads/SKILL.md" } as const;
    expect(pageOfMount(skills, skill, { mount: mountOf("public") })?.params).toEqual({
      view: "skill",
      visibility: "public",
    });
    expect(
      pageOfMount(skills, skill, { mount: mountOf("public"), skillLoaded: true })?.params,
    ).toEqual({ view: "skill", visibility: "public", skill: "marketing/ads/SKILL.md" });
    expect(
      pageOfMount(skills, { kind: "file", path: "README.md" }, { mount: mountOf("public") })
        ?.params,
    ).toEqual({ view: "file", visibility: "public" });
  });

  it("withholds a repository that is not public, or is nothing, which read the same", () => {
    const secret = address("/gh/acme/secret");
    expect(
      pageOfMount(secret, { kind: "overview", query: undefined }, { mount: mountOf("private") }),
    ).toEqual({
      path: WITHHELD_REPOSITORY_PATH,
      title: "repository",
      params: { view: "overview", visibility: "private" },
    });
    // What the answer does not say is not public.
    expect(
      pageOfMount(secret, { kind: "overview", query: undefined }, { mount: mountOf(undefined) })
        ?.path,
    ).toBe(WITHHELD_REPOSITORY_PATH);
    expect(
      pageOfMount(
        secret,
        { kind: "skill", path: "SKILL.md" },
        { error: new ApiError(404, "mount.repo_not_found", "not found") },
      ),
    ).toEqual({
      path: WITHHELD_REPOSITORY_PATH,
      title: "repository",
      params: { view: "skill", outcome: "not_found" },
    });
    expect(
      pageOfMount(
        secret,
        { kind: "overview", query: undefined },
        { error: new ApiError(503, "mount.unavailable", "later") },
      )?.params,
    ).toEqual({ view: "overview", outcome: "error" });
  });
});

describe("pageOfOwner", () => {
  const owner = { host: "gh", owner: "acme" } as const;

  it("sends an account once it is known to exist, and a stand-in otherwise", () => {
    expect(pageOfOwner(owner, { ready: false })).toBeUndefined();
    expect(pageOfOwner(owner, { ready: true })).toEqual({ path: "/gh/acme", title: "owner" });
    expect(
      pageOfOwner(owner, { ready: false, error: new ApiError(404, "owner.not_found", "no") }),
    ).toEqual({ path: WITHHELD_OWNER_PATH, title: "owner", params: { outcome: "not_found" } });
    expect(
      pageOfOwner(owner, { ready: false, error: new ApiError(0, "network", "no") })?.params,
    ).toEqual({ outcome: "error" });
  });
});

describe("what is sent", () => {
  const origin = "https://skills.example";

  afterEach(() => {
    vi.unstubAllGlobals();
    resetAnalyticsForTests();
  });

  function analytics(active: boolean, referrer = "") {
    const gtag = vi.fn();
    vi.stubGlobal("window", {
      skillcdnAnalytics: { ask: false, active, decide: () => undefined },
      gtag,
      location: { origin },
    });
    vi.stubGlobal("document", { referrer });
    return gtag;
  }

  it("goes nowhere without analytics, or before the visitor agreed", () => {
    expect(() => track("cta_click", { id: "hero" })).not.toThrow();
    const gtag = analytics(false);
    track("cta_click", { id: "hero" });
    trackPage({ path: "/", title: "landing" }, origin);
    expect(gtag).not.toHaveBeenCalled();
  });

  it("sends a page as its own description, once, with the page before as the referrer", () => {
    const gtag = analytics(true, "https://search.example/?q=skills");
    trackPage({ path: "/", title: "landing", params: { site_language: "ko" } }, origin);
    trackPage({ path: "/", title: "landing", params: { site_language: "ko" } }, origin);
    trackPage({ path: "/explore", title: "explore" }, origin);
    expect(gtag.mock.calls).toEqual([
      [
        "event",
        "page_view",
        {
          page_location: "https://skills.example/",
          page_title: "landing",
          page_referrer: "https://search.example/?q=skills",
          site_language: "ko",
        },
      ],
      [
        "event",
        "page_view",
        {
          page_location: "https://skills.example/explore",
          page_title: "explore",
          page_referrer: "https://skills.example/",
        },
      ],
    ]);
  });

  it("never names a page of this site as the referrer of the first view", () => {
    const gtag = analytics(true, "https://skills.example/gh/acme/secret");
    trackPage({ path: "/", title: "landing" }, origin);
    expect(gtag).toHaveBeenCalledWith("event", "page_view", {
      page_location: "https://skills.example/",
      page_title: "landing",
    });
    track("connect_start", { client: "cursor", method: "install" });
    expect(gtag).toHaveBeenLastCalledWith("event", "connect_start", {
      client: "cursor",
      method: "install",
    });
  });
});
