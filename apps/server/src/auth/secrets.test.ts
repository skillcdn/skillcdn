import { describe, expect, it } from "vitest";
import {
  createSecrets,
  hashToken,
  newToken,
  openJson,
  pkceChallenge,
  sameSecret,
  sealJson,
} from "./secrets.js";

const secrets = createSecrets("a secret for tests, long enough to be one");

describe("sealed values", () => {
  it("come back as they went in, and look like nothing in between", () => {
    const sealed = secrets.seal("host-credential", "ghu_example-token", "user-1");
    expect(sealed).toMatch(/^v1\.[\w-]+$/);
    expect(sealed).not.toContain("ghu_");
    expect(secrets.open("host-credential", sealed, "user-1")).toBe("ghu_example-token");
    // Sealing twice gives two different values: nothing can be matched by looking at them.
    expect(secrets.seal("host-credential", "ghu_example-token", "user-1")).not.toBe(sealed);
    expect(secrets.open("login", secrets.seal("login", ""))).toBe("");
  });

  it("open only for the purpose, the place and the secret they were sealed with", () => {
    const sealed = secrets.seal("host-credential", "value", "user-1");
    expect(secrets.open("login", sealed, "user-1")).toBeUndefined();
    expect(secrets.open("host-credential", sealed, "user-2")).toBeUndefined();
    expect(secrets.open("host-credential", sealed)).toBeUndefined();
    const other = createSecrets("another secret, which is just as long as the first");
    expect(other.open("host-credential", sealed, "user-1")).toBeUndefined();
  });

  it.each([
    "",
    "v1",
    "v1.",
    "v2.AAAA",
    "v1.AAAA",
    "v1.not base64 at all",
    "v1.a.b",
    `v1.${"A".repeat(10_000)}`,
  ])("never open what was not sealed: %j", (hostile) => {
    expect(secrets.open("host-credential", hostile)).toBeUndefined();
  });

  it("do not open once a single character is changed", () => {
    const sealed = secrets.seal("authorization", "what a client asked for");
    for (const at of [3, Math.floor(sealed.length / 2), sealed.length - 1]) {
      const changed = `${sealed.slice(0, at)}${sealed[at] === "A" ? "B" : "A"}${sealed.slice(at + 1)}`;
      expect(secrets.open("authorization", changed)).toBeUndefined();
    }
  });
});

describe("sealed JSON", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  it("is good until it expires, and not a moment longer", () => {
    const sealed = sealJson(secrets, "login", { state: "abc" }, later(60));
    expect(openJson(secrets, "login", sealed, now)).toEqual({ state: "abc" });
    expect(openJson(secrets, "login", sealed, later(59))).toEqual({ state: "abc" });
    expect(openJson(secrets, "login", sealed, later(60))).toBeUndefined();
    expect(openJson(secrets, "authorization", sealed, now)).toBeUndefined();
  });

  it("is nothing when what was sealed is not what it writes", () => {
    for (const text of [
      "not json",
      "null",
      "[]",
      '{"value":1}',
      '{"expiresAt":"soon","value":1}',
    ]) {
      expect(openJson(secrets, "login", secrets.seal("login", text), now)).toBeUndefined();
    }
  });
});

describe("tokens", () => {
  it("are new every time, say what they are, and are remembered as a hash", () => {
    const token = newToken("scdn_at_");
    expect(token).toMatch(/^scdn_at_[\w-]{43}$/);
    expect(newToken("scdn_at_")).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token.slice(8));
  });

  it("compare by value, whatever their lengths", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
    expect(sameSecret("", "")).toBe(true);
  });

  it("derive the challenge of a verifier as RFC 7636 does", () => {
    // The example of appendix B.
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});
