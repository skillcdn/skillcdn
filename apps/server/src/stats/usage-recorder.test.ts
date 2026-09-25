import { describe, expect, it } from "vitest";
import { clientHash } from "./usage-recorder.js";

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
