import { formatAddress, parseAddress } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SECTIONS,
  accountHref,
  addressFromInput,
  matchRoute,
  mountHref,
  ownerFromInput,
  ownerHref,
  TOKEN_REPOSITORY_PARAM,
  tokensHref,
} from "./router.js";

describe("matchRoute", () => {
  it("knows the pages that exist once per language", () => {
    expect(matchRoute("/", "")).toEqual({ name: "landing" });
    expect(matchRoute("/", "?lang=ko")).toEqual({ name: "landing" });
    expect(matchRoute("/explore", "")).toEqual({ name: "explore" });
    expect(matchRoute("/explore/", "")).toEqual({ name: "not-found" });
    // The deployment's own pages (ADR-0029).
    expect(matchRoute("/terms", "")).toEqual({ name: "legal", kind: "terms" });
    expect(matchRoute("/privacy", "?lang=ko")).toEqual({ name: "legal", kind: "privacy" });
    expect(matchRoute("/terms/", "")).toEqual({ name: "not-found" });
    expect(matchRoute("/nothing", "")).toEqual({ name: "not-found" });
  });

  it("reads an address and the view of it from the URL", () => {
    const overview = matchRoute("/gh/Acme/Skills@v2/ads", "?lang=ko");
    expect(overview).toMatchObject({
      name: "mount",
      address: { owner: "acme", repo: "skills", path: "ads" },
      view: { kind: "overview", query: undefined },
    });
    expect(matchRoute("/gh/acme/skills", "?q=%20review%20")).toMatchObject({
      view: { kind: "overview", query: "review" },
    });
    expect(matchRoute("/gh/acme/skills", "?skill=skills/release-notes/SKILL.md")).toMatchObject({
      view: { kind: "skill", path: "skills/release-notes/SKILL.md" },
    });
    expect(matchRoute("/gh/acme/skills", "?file=docs/a%20b.md")).toMatchObject({
      view: { kind: "file", path: "docs/a b.md" },
    });
  });

  it("says which rule a bad address breaks", () => {
    expect(matchRoute("/gh/acme/skills.git", "")).toMatchObject({
      name: "bad-address",
      error: { code: "invalid_repo" },
    });
    // One segment that is not the name of an account is an address with a part missing.
    expect(matchRoute("/gh/-acme", "")).toMatchObject({ name: "bad-address" });
    expect(matchRoute("/gh/", "")).toMatchObject({ name: "bad-address" });
  });

  it("reads one segment under the host as the page of an account", () => {
    expect(matchRoute("/gh/Acme", "?lang=ko")).toEqual({
      name: "owner",
      owner: { host: "gh", owner: "acme" },
    });
    expect(ownerHref({ host: "gh", owner: "acme" })).toBe("/gh/acme");
    // A trailing slash, or anything after the name, is an address, good or bad.
    expect(matchRoute("/gh/acme/", "")).toMatchObject({ name: "bad-address" });
    expect(matchRoute("/gh/acme/skills", "")).toMatchObject({ name: "mount" });
  });

  it("knows the sections of the account pages, each at one path", () => {
    expect(matchRoute("/account", "")).toEqual({ name: "account", section: "overview" });
    for (const section of ACCOUNT_SECTIONS) {
      expect(matchRoute(accountHref(section), "")).toEqual({ name: "account", section });
    }
    expect(accountHref()).toBe("/account");
    expect(accountHref("repositories")).toBe("/account/repositories");
    // The first section has no second path, and there are no others.
    expect(matchRoute("/account/overview", "")).toEqual({ name: "not-found" });
    expect(matchRoute("/account/", "")).toEqual({ name: "not-found" });
    expect(matchRoute("/account/billing", "")).toEqual({ name: "not-found" });
    expect(matchRoute("/accounts", "")).toEqual({ name: "not-found" });
  });

  it("sends whoever wants a token for a repository to the tokens section, with it chosen", () => {
    const at = (text: string) => {
      const parsed = parseAddress(text);
      if (!parsed.ok) {
        throw new Error(`not an address: ${text}`);
      }
      return tokensHref(parsed.value);
    };
    expect(at("/gh/acme/skills")).toBe("/account/tokens?repository=%2Fgh%2Facme%2Fskills");
    // A token is a repository's: the ref and the path of the page it was asked from are left.
    expect(at("/gh/Acme/Skills@release/1.2:docs")).toBe(at("/gh/acme/skills"));
    const [path, search] = at("/gh/acme/skills").split("?");
    expect(matchRoute(path ?? "", `?${search}`)).toEqual({ name: "account", section: "tokens" });
    expect(new URLSearchParams(search).get(TOKEN_REPOSITORY_PARAM)).toBe("/gh/acme/skills");
  });

  it("has one page that asks about a connecting app", () => {
    expect(matchRoute("/oauth/consent", "?request=abc")).toEqual({ name: "consent" });
    expect(matchRoute("/oauth/authorize", "")).toEqual({ name: "not-found" });
  });

  it("shows the states page in development only", () => {
    expect(matchRoute("/dev/states", "", true)).toEqual({ name: "states" });
    expect(matchRoute("/dev/states", "")).toEqual({ name: "not-found" });
  });
});

describe("mountHref", () => {
  it("round-trips through matchRoute", () => {
    const parsed = addressFromInput("acme/skills@release/1.2:docs");
    if (!parsed.ok) {
      throw new Error("expected an address");
    }
    for (const view of [
      { kind: "overview", query: undefined },
      { kind: "overview", query: "blameless review" },
      { kind: "overview", query: "review", path: "marketing/skills" },
      { kind: "skill", path: "skills/release notes/SKILL.md" },
      { kind: "file", path: "docs/a&b=c?.md" },
    ] as const) {
      const [pathname = "", search = ""] = mountHref(parsed.value, view).split("?");
      expect(matchRoute(pathname, `?${search}`)).toEqual({
        name: "mount",
        address: parsed.value,
        view,
      });
    }
  });
});

describe("addressFromInput", () => {
  const canonical = (input: string) => {
    const parsed = addressFromInput(input);
    return parsed.ok ? formatAddress(parsed.value) : parsed.error.code;
  };

  it("accepts the ways people write a repository", () => {
    expect(canonical("acme/skills")).toBe("/gh/acme/skills");
    expect(canonical("  Acme/Skills@v2/ads ")).toBe("/gh/acme/skills@v2/ads");
    expect(canonical("/gh/acme/skills")).toBe("/gh/acme/skills");
    expect(canonical("gh/acme/skills")).toBe("/gh/acme/skills");
    expect(canonical("https://skillcdn.example/gh/acme/skills@main")).toBe("/gh/acme/skills@main");
  });

  it("accepts the URL of a repository page on GitHub", () => {
    expect(canonical("https://github.com/acme/skills")).toBe("/gh/acme/skills");
    expect(canonical("https://github.com/acme/skills.git")).toBe("/gh/acme/skills");
    expect(canonical("https://github.com/acme/skills/")).toBe("/gh/acme/skills");
    expect(canonical("https://github.com/acme/skills/tree/v2")).toBe("/gh/acme/skills@v2");
    expect(canonical("https://github.com/acme/skills/tree/main/skills/ads?tab=readme#x")).toBe(
      "/gh/acme/skills@main/skills/ads",
    );
  });

  it("reports what is wrong with the rest", () => {
    expect(canonical("")).toBe("missing_repo");
    expect(canonical("acme")).toBe("missing_repo");
    expect(canonical("acme/skills/../../etc")).toBe("dot_segment");
    expect(canonical("-acme/skills")).toBe("invalid_owner");
  });
});

describe("ownerFromInput", () => {
  it("reads the name of an account, however it was written, and nothing longer", () => {
    for (const input of [
      "acme",
      " Acme ",
      "gh/acme",
      "/gh/acme/",
      "https://github.com/Acme",
      "https://github.com/acme/",
      "https://skillcdn.example/gh/acme",
    ]) {
      expect(ownerFromInput(input), input).toEqual({ host: "gh", owner: "acme" });
    }
    for (const input of ["", "acme/skills", "https://github.com/acme/skills", "-acme", "a b"]) {
      expect(ownerFromInput(input), input).toBeUndefined();
    }
  });
});
