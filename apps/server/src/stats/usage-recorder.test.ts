import { describe, expect, it } from "vitest";
import { clientHash, normalizeClientApp } from "./usage-recorder.js";

// ADR-0027: what a client is written as follows from the secret, the day and the address.

describe("clientHash", () => {
  const secret = "a".repeat(64);

  it("is the same for the same client on the same day, wherever it is computed", () => {
    expect(clientHash(secret, "2026-09-26", "203.0.113.7")).toBe(
      clientHash(secret, "2026-09-26", "203.0.113.7"),
    );
    expect(clientHash(secret, "2026-09-26", "203.0.113.7")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes with the day, the address and the secret", () => {
    const today = clientHash(secret, "2026-09-26", "203.0.113.7");
    expect(clientHash(secret, "2026-09-27", "203.0.113.7")).not.toBe(today);
    expect(clientHash(secret, "2026-09-26", "203.0.113.8")).not.toBe(today);
    expect(clientHash("b".repeat(64), "2026-09-26", "203.0.113.7")).not.toBe(today);
  });

  it("gives away neither the address nor the secret", () => {
    const hash = clientHash(secret, "2026-09-26", "203.0.113.7");
    expect(hash).not.toContain("203");
    expect(hash).not.toContain("aaaa");
  });
});

// The name a client app gives itself is its own word: it is written down as one short line.

describe("normalizeClientApp", () => {
  it("keeps a name as one lower-case line", () => {
    expect(normalizeClientApp("Claude Code")).toBe("claude code");
    expect(normalizeClientApp("  cursor\t1.2\n ")).toBe("cursor 1.2");
    expect(normalizeClientApp("Visual Studio Code")).toBe("visual studio code");
  });

  it("takes out what cannot be seen and bounds what is left", () => {
    const invisible = `x${String.fromCodePoint(0x200b)}y${String.fromCodePoint(0)}z`;
    expect(normalizeClientApp(invisible)).toBe("x y z");
    expect(normalizeClientApp("a".repeat(100))).toHaveLength(64);
    expect(normalizeClientApp(`${"a".repeat(63)} bcd`)).toBe("a".repeat(63));
  });

  it("is empty for anything that is not a name", () => {
    expect(normalizeClientApp(undefined)).toBe("");
    expect(normalizeClientApp(42)).toBe("");
    expect(normalizeClientApp("   ")).toBe("");
    expect(normalizeClientApp(String.fromCodePoint(0x200b))).toBe("");
  });
});
