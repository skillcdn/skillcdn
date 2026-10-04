import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./login.js";

const ORIGIN = "https://skills.example";

describe("where a sign-in comes back to", () => {
  it.each([
    ["/", "/"],
    ["/explore", "/explore"],
    ["/gh/acme/skills?lang=ko", "/gh/acme/skills?lang=ko"],
    ["/account/apps?x=1#fragment", "/account/apps?x=1"],
    ["/a/../account", "/account"],
    ["/oauth/consent?request=v1.abc", "/oauth/consent?request=v1.abc"],
    // Two slashes further in are part of a path of this origin.
    ["/gh/acme//skills", "/gh/acme//skills"],
  ])("is a page of this origin: %s", (value, expected) => {
    expect(safeReturnTo(value, ORIGIN)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    "explore",
    "//evil.test/path",
    "https://evil.test/",
    "https://skills.example.evil.test/",
    "/\\evil.test",
    "javascript:alert(1)",
    // Dot segments are removed when the path is read, which leaves another site's host.
    "/.//evil.test",
    "/..//evil.test/path",
    "/a/..//evil.test",
    "/%2e//evil.test",
    "/./%2E%2e//evil.test",
    `/${"a".repeat(3000)}`,
  ])("is the front page for anything else: %j", (value) => {
    expect(safeReturnTo(value, ORIGIN)).toBe("/");
  });
});
