import { describe, expect, it } from "vitest";
import { loginPath, signInPath } from "./account.js";

describe("the paths of signing in", () => {
  it("carries the page to come back to through the login route", () => {
    // Whole, however much of an address and of a query it has in it.
    const returnTo = "/gh/acme/skills@release/1.2:docs?skill=a b&lang=ko";
    const [, query = ""] = loginPath(returnTo).split("?");
    expect(query.startsWith("return_to=")).toBe(true);
    expect(query).not.toMatch(/[&?# ]/);
    expect(decodeURIComponent(query.slice("return_to=".length))).toBe(returnTo);
    expect(loginPath("/explore")).toBe("/auth/gh/login?return_to=%2Fexplore");
  });

  it("asks a page to open the sign-in dialog, and keeps the page as it was", () => {
    expect(signInPath("/")).toBe("/?sign_in=open");
    expect(signInPath("/explore", "denied")).toBe("/explore?sign_in=denied");
    // A page with a query of its own keeps it, in front.
    expect(signInPath("/gh/acme/skills?skill=a%20b&lang=ko", "expired")).toBe(
      "/gh/acme/skills?skill=a%20b&lang=ko&sign_in=expired",
    );
  });
});
