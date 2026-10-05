import { describe, expect, it } from "vitest";
import { loginPath, signInPagePath } from "./account.js";

describe("the paths of signing in", () => {
  it("carries the page to come back to through the sign-in page and the login route", () => {
    // Whole, however much of an address and of a query it has in it.
    const returnTo = "/gh/acme/skills@release/1.2:docs?skill=a b&lang=ko";
    for (const path of [signInPagePath(returnTo), loginPath(returnTo)]) {
      const [, query = ""] = path.split("?");
      expect(query.startsWith("return_to=")).toBe(true);
      expect(query).not.toMatch(/[&?# ]/);
      expect(decodeURIComponent(query.slice("return_to=".length))).toBe(returnTo);
    }
    expect(signInPagePath("/explore")).toBe("/login?return_to=%2Fexplore");
    expect(loginPath("/explore")).toBe("/auth/gh/login?return_to=%2Fexplore");
    // Without a page to come back to, the sign-in page is asked for alone.
    expect(signInPagePath()).toBe("/login");
  });

  it("asks for the git host's account picker only when told to", () => {
    expect(loginPath("/account", { chooseAccount: true })).toBe(
      "/auth/gh/login?return_to=%2Faccount&choose_account=1",
    );
    expect(loginPath("/account", { chooseAccount: false })).toBe(loginPath("/account"));
  });
});
