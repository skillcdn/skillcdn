import { describe, expect, it } from "vitest";
import {
  acceptRequestId,
  type Cidr,
  createClientAddressResolver,
  normalizeAddress,
  parseCidr,
} from "./client-address.js";

function cidrs(...texts: string[]): Cidr[] {
  return texts.map((text) => {
    const parsed = parseCidr(text);
    if (parsed === undefined) {
      throw new Error(`not a CIDR: ${text}`);
    }
    return parsed;
  });
}

describe("parseCidr", () => {
  it("reads networks and bare addresses of both families", () => {
    expect(parseCidr("10.0.0.0/8")).toEqual({ address: "10.0.0.0", prefix: 8, family: "ipv4" });
    expect(parseCidr(" 192.0.2.7 ")).toEqual({ address: "192.0.2.7", prefix: 32, family: "ipv4" });
    expect(parseCidr("::1")).toEqual({ address: "::1", prefix: 128, family: "ipv6" });
    expect(parseCidr("2001:db8::/32")).toEqual({
      address: "2001:db8::",
      prefix: 32,
      family: "ipv6",
    });
  });

  it("rejects what is not a network", () => {
    for (const text of [
      "",
      "proxy.internal",
      "10.0.0.0/33",
      "::1/129",
      "10.0.0.0/8/8",
      "10.0.0.0/-1",
      "10.0.0.0/x",
      "999.1.1.1",
    ]) {
      expect(parseCidr(text), text).toBeUndefined();
    }
  });
});

describe("normalizeAddress", () => {
  it("unwraps IPv4 addresses mapped into IPv6", () => {
    expect(normalizeAddress("::ffff:10.1.2.3")).toBe("10.1.2.3");
    expect(normalizeAddress("::FFFF:10.1.2.3")).toBe("10.1.2.3");
    expect(normalizeAddress("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeAddress("::ffff:999.1.2.3")).toBe("::ffff:999.1.2.3");
  });
});

describe("createClientAddressResolver", () => {
  const forwarded = (value: string) => new Headers({ "x-forwarded-for": value });

  it("ignores forwarding headers when no proxy is trusted", () => {
    const resolver = createClientAddressResolver({ trustedProxies: [], header: "x-forwarded-for" });
    expect(resolver.resolve("203.0.113.9", forwarded("198.51.100.1"))).toBe("203.0.113.9");
    expect(resolver.isTrusted("127.0.0.1")).toBe(false);
  });

  it("ignores forwarding headers from a peer that is not a trusted proxy", () => {
    const resolver = createClientAddressResolver({
      trustedProxies: cidrs("10.0.0.0/8"),
      header: "x-forwarded-for",
    });
    expect(resolver.resolve("203.0.113.9", forwarded("198.51.100.1"))).toBe("203.0.113.9");
  });

  it("takes the nearest address that is not one of the proxies", () => {
    const resolver = createClientAddressResolver({
      trustedProxies: cidrs("10.0.0.0/8", "::1"),
      header: "x-forwarded-for",
    });
    // The left-most entry is whatever the client claimed; it is never believed.
    expect(resolver.resolve("10.0.0.5", forwarded("1.1.1.1, 198.51.100.1, 10.0.0.9"))).toBe(
      "198.51.100.1",
    );
    expect(resolver.resolve("::ffff:10.0.0.5", forwarded("198.51.100.1"))).toBe("198.51.100.1");
    expect(resolver.resolve("::1", forwarded("[2001:db8::7]:4711"))).toBe("2001:db8::7");
    expect(resolver.resolve("10.0.0.5", forwarded("198.51.100.1:51234"))).toBe("198.51.100.1");
  });

  it("falls back to what it knows when the chain is missing, empty or malformed", () => {
    const resolver = createClientAddressResolver({
      trustedProxies: cidrs("10.0.0.0/8"),
      header: "x-forwarded-for",
    });
    expect(resolver.resolve("10.0.0.5", new Headers())).toBe("10.0.0.5");
    expect(resolver.resolve("10.0.0.5", forwarded(""))).toBe("10.0.0.5");
    expect(resolver.resolve("10.0.0.5", forwarded("198.51.100.1, not-an-address"))).toBe(
      "10.0.0.5",
    );
    expect(resolver.resolve("10.0.0.5", forwarded("not-an-address, 10.0.0.9"))).toBe("10.0.0.9");
    expect(resolver.resolve(undefined, forwarded("198.51.100.1"))).toBeUndefined();
  });

  it("looks only at the end of a very long chain", () => {
    const resolver = createClientAddressResolver({
      trustedProxies: cidrs("10.0.0.0/8"),
      header: "x-forwarded-for",
    });
    const chain = [...Array.from({ length: 500 }, () => "10.0.0.9"), "198.51.100.1"].join(", ");
    expect(resolver.resolve("10.0.0.5", forwarded(chain))).toBe("198.51.100.1");
    const allProxies = Array.from({ length: 500 }, () => "10.0.0.9").join(", ");
    expect(resolver.resolve("10.0.0.5", forwarded(allProxies))).toBe("10.0.0.9");
  });

  it("reads a single-address header as one address", () => {
    const resolver = createClientAddressResolver({
      trustedProxies: cidrs("127.0.0.1"),
      header: "x-real-ip",
    });
    const headers = new Headers({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "1.1.1.1" });
    expect(resolver.resolve("127.0.0.1", headers)).toBe("198.51.100.7");
    expect(resolver.resolve("203.0.113.9", headers)).toBe("203.0.113.9");
    expect(resolver.resolve("127.0.0.1", new Headers({ "x-real-ip": "1.1.1.1, 2.2.2.2" }))).toBe(
      "127.0.0.1",
    );
  });
});

describe("acceptRequestId", () => {
  it("accepts ids that are short and plain", () => {
    expect(acceptRequestId("8f3c2a1b9d7e6f50-ICN")).toBe("8f3c2a1b9d7e6f50-ICN");
    expect(acceptRequestId("Root=1-67891233-abcdef012345678912345678")).toBe(
      "Root=1-67891233-abcdef012345678912345678",
    );
  });

  it("rejects everything else", () => {
    expect(acceptRequestId(null)).toBeUndefined();
    expect(acceptRequestId("")).toBeUndefined();
    expect(acceptRequestId("a".repeat(129))).toBeUndefined();
    expect(acceptRequestId('id" injected="1')).toBeUndefined();
    expect(acceptRequestId("two words")).toBeUndefined();
  });
});
