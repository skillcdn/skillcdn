import { createHash } from "node:crypto";

/** The hash git gives a file with this content. It is what ties a body to a tree entry. */
export function gitBlobHash(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
