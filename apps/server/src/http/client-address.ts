import { BlockList, isIP } from "node:net";

/** A network in CIDR notation, already validated. */
export interface Cidr {
  readonly address: string;
  readonly prefix: number;
  readonly family: "ipv4" | "ipv6";
}

/** How many entries of a forwarding chain are looked at, counted from the nearest proxy. */
const MAX_FORWARDED_HOPS = 20;

/** Parses `10.0.0.0/8`, `::1/128` or a bare address (which means just that address). */
export function parseCidr(text: string): Cidr | undefined {
  const [address, prefixText, ...rest] = text.trim().split("/");
  if (address === undefined || rest.length > 0) {
    return undefined;
  }
  const version = isIP(address);
  if (version === 0) {
    return undefined;
  }
  const widest = version === 4 ? 32 : 128;
  if (prefixText === undefined) {
    return { address, prefix: widest, family: version === 4 ? "ipv4" : "ipv6" };
  }
  if (!/^\d{1,3}$/.test(prefixText)) {
    return undefined;
  }
  const prefix = Number(prefixText);
  return prefix > widest ? undefined : { address, prefix, family: version === 4 ? "ipv4" : "ipv6" };
}

/** `::ffff:10.0.0.1`, which a dual-stack listener reports for an IPv4 peer, becomes `10.0.0.1`. */
export function normalizeAddress(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return mapped?.[1] !== undefined && isIP(mapped[1]) === 4 ? mapped[1] : address;
}

/** One entry of a forwarding header: an address, optionally in brackets or with a port. */
function parseForwardedEntry(entry: string): string | undefined {
  const text = entry.trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(text);
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(text);
  const candidate = bracketed?.[1] ?? withPort?.[1] ?? text;
  return isIP(candidate) === 0 ? undefined : normalizeAddress(candidate);
}

export interface ClientAddressResolver {
  /** True when the peer is a proxy whose headers are believed. */
  readonly isTrusted: (peerAddress: string | undefined) => boolean;
  /**
   * The address of the client. Forwarding headers count only when the peer is a trusted proxy:
   * anyone can send them, so from anyone else they are noise at best.
   */
  readonly resolve: (peerAddress: string | undefined, headers: Headers) => string | undefined;
}

export function createClientAddressResolver(options: {
  readonly trustedProxies: readonly Cidr[];
  /** Lowercase. `x-forwarded-for` is read as a chain; any other header as one address. */
  readonly header: string;
}): ClientAddressResolver {
  const trusted = new BlockList();
  for (const cidr of options.trustedProxies) {
    trusted.addSubnet(cidr.address, cidr.prefix, cidr.family);
  }
  const inTrusted = (address: string): boolean =>
    trusted.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");

  const isTrusted = (peerAddress: string | undefined): boolean =>
    peerAddress !== undefined &&
    isIP(normalizeAddress(peerAddress)) !== 0 &&
    inTrusted(normalizeAddress(peerAddress));

  const resolve = (peerAddress: string | undefined, headers: Headers): string | undefined => {
    if (peerAddress === undefined) {
      return undefined;
    }
    const peer = normalizeAddress(peerAddress);
    if (!isTrusted(peer)) {
      return peer;
    }
    const value = headers.get(options.header);
    if (value === null) {
      return peer;
    }
    if (options.header !== "x-forwarded-for") {
      return parseForwardedEntry(value) ?? peer;
    }
    // Each proxy appends the address it saw. Walking from the right, the first address that is
    // not one of our proxies is the client; everything to its left is whatever the client sent.
    let client = peer;
    for (const entry of value.split(",").slice(-MAX_FORWARDED_HOPS).reverse()) {
      const address = parseForwardedEntry(entry);
      if (address === undefined) {
        break;
      }
      client = address;
      if (!inTrusted(address)) {
        break;
      }
    }
    return client;
  };

  return { isTrusted, resolve };
}

const REQUEST_ID = /^[A-Za-z0-9._:=/+-]{1,128}$/;

/** A request id handed over by a trusted proxy, if it looks like one. */
export function acceptRequestId(value: string | null): string | undefined {
  return value !== null && REQUEST_ID.test(value) ? value : undefined;
}
