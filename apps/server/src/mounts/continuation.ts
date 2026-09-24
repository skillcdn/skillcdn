import { createHash } from "node:crypto";
import * as z from "zod";

export class ReaderInputError extends Error {
  readonly code = "request.invalid";
}
const payload = z.object({ key: z.string(), offset: z.number().int().nonnegative().safe() });
export function continuationKey(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url");
}
export function continuationOffset(cursor: string | undefined, key: string): number {
  if (cursor === undefined) return 0;
  try {
    if (cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = payload.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (value.key !== key) throw new Error();
    return value.offset;
  } catch {
    throw new ReaderInputError(
      "This continuation does not match the repository snapshot, path or query. Start again without a cursor.",
    );
  }
}
export function nextContinuation(key: string, offset: number): string {
  return Buffer.from(JSON.stringify({ key, offset })).toString("base64url");
}
