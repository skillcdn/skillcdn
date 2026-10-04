import { lookup as resolveName } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

// Fetching a client's metadata document (docs/specs/permissions.md). It is the one request this
// server makes to a URL somebody else chose, so it goes to the public internet and nowhere else:
// https on the default port, to addresses that are not this machine's or its network's, without
// following anything, for a small body and a short time.

export interface FetchedDocument {
  readonly body: unknown;
  /** How long the document says it may be kept, when it says. */
  readonly maxAgeMs: number | undefined;
}

/** Reads the JSON document at a URL, or rejects. Tests hand in one that never leaves the process. */
export type DocumentFetcher = (url: URL) => Promise<FetchedDocument>;

export class DocumentFetchError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "DocumentFetchError";
  }
}

const MAX_DOCUMENT_BYTES = 64 * 1024;
const TIMEOUT_MS = 5_000;

/** Everything that is not the public internet: this machine, private and link-local networks, and what is reserved. */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}
// Besides what is plainly not public: the ranges that carry an IPv4 address inside them
// (IPv4-compatible, the two translation prefixes, Teredo and the rest of the protocol
// assignments, 6to4), since the address they lead to is not the one that was checked.
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/** Whether an address is one on the public internet. An IPv4 address inside an IPv6 one counts as itself. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const plain = mapped?.[1] ?? address;
  const version = isIP(plain);
  if (version === 0) {
    return false;
  }
  return !NOT_PUBLIC.check(plain, version === 4 ? "ipv4" : "ipv6");
}

/**
 * Resolves a name for the connection itself, and refuses unless every address it has is public.
 * Checking here, where the socket gets its address, leaves no second lookup for a name to
 * answer differently.
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  resolveName(hostname, { all: true }).then(
    (addresses) => {
      const [first] = addresses;
      if (first === undefined || !addresses.every((entry) => isPublicAddress(entry.address))) {
        callback(new DocumentFetchError("the document is not on the public internet"), "", 0);
        return;
      }
      // The socket asks for every address when it may try more than one, and for one otherwise.
      if (options.all === true) {
        callback(null, addresses);
      } else {
        callback(null, first.address, first.family);
      }
    },
    (error: NodeJS.ErrnoException) => callback(error, "", 0),
  );
};

function maxAgeOf(header: string | undefined): number | undefined {
  if (header === undefined || /\bno-(?:store|cache)\b/i.test(header)) {
    return undefined;
  }
  const seconds = /\bmax-age=(\d{1,9})\b/i.exec(header)?.[1];
  return seconds === undefined ? undefined : Number(seconds) * 1000;
}

export const fetchPublicDocument: DocumentFetcher = (url) =>
  new Promise((resolve, reject) => {
    if (url.protocol !== "https:" || url.port !== "" || url.username !== "") {
      reject(new DocumentFetchError("a document is fetched over https on the default port"));
      return;
    }
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) !== 0 && !isPublicAddress(literal)) {
      reject(new DocumentFetchError("the document is not on the public internet"));
      return;
    }
    const outgoing = request(
      url,
      {
        method: "GET",
        headers: { accept: "application/json" },
        lookup: publicLookup,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        // A redirect is not followed: the document is at its URL or it is nowhere.
        if (response.statusCode !== 200) {
          response.resume();
          reject(new DocumentFetchError(`the document answered ${response.statusCode}`));
          return;
        }
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > MAX_DOCUMENT_BYTES) {
            outgoing.destroy(new DocumentFetchError("the document is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            resolve({
              body: JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
              ),
              maxAgeMs: maxAgeOf(response.headers["cache-control"]),
            });
          } catch (error) {
            reject(new DocumentFetchError("the document is not JSON", { cause: error }));
          }
        });
        response.on("error", (error) =>
          reject(new DocumentFetchError("the document could not be read", { cause: error })),
        );
      },
    );
    outgoing.on("error", (error) =>
      reject(
        error instanceof DocumentFetchError
          ? error
          : new DocumentFetchError("the document could not be fetched", { cause: error }),
      ),
    );
    outgoing.end();
  });
