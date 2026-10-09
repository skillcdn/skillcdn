import { createHash } from "node:crypto";

/** The hash git gives a file with this content. It is what ties a body to a tree entry. */
export function gitBlobHash(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

/** The digest the MCP skills extension declares for served bytes, in hex (ADR-0025). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
