import { formatAddress } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { addressFromInput, matchRoute, mountHref } from "./router.js";

describe("matchRoute", () => {
  it("knows the pages that exist once per language", () => {
    expect(matchRoute("/", "")).toEqual({ name: "landing" });
    expect(matchRoute("/", "?lang=ko")).toEqual({ name: "landing" });
    expect(matchRoute("/explore", "")).toEqual({ name: "explore" });
    expect(matchRoute("/explore/", "")).toEqual({ name: "not-found" });
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
    expect(matchRoute("/gh/acme", "")).toMatchObject({ name: "bad-address" });
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
