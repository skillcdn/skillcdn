import { describe, expect, it } from "vitest";
import {
  CONNECT_CODE_ALPHABET,
  connectPagePath,
  loginPath,
  parseConnectCode,
  signInPath,
} from "./account.js";

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

describe("the code a command connects with", () => {
  it("is read back as the code however a person typed it", () => {
    for (const typed of ["ABCD-EFGH", "abcd-efgh", "abcdefgh", " ABCD EFGH ", "abcd-EFGH"]) {
      expect(parseConnectCode(typed), typed).toBe("ABCD-EFGH");
    }
    expect(connectPagePath("ABCD-EFGH")).toBe("/connect/ABCD-EFGH");
  });

  it("is nothing else: the wrong length, or a letter the alphabet leaves out", () => {
    for (const typed of [
      "",
      "ABCD-EFG",
      "ABCD-EFGHJ",
      "ABCD-EF0H",
      "ABCD-EFOH",
      "ABCD-EF1H",
      "ABCD_EFGH",
      "ABCD-EFG!",
    ]) {
      expect(parseConnectCode(typed), typed).toBeUndefined();
    }
    // The alphabet has no look-alikes, and a code is spelled from it alone.
    expect(CONNECT_CODE_ALPHABET).not.toMatch(/[01OI]/);
    expect(CONNECT_CODE_ALPHABET.length).toBe(32);
  });
});
