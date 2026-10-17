import { createHash } from "node:crypto";

// A cursor is where a listing or a skill's context goes on from, bound to the index, the mount,
// the operation and the request it was made for (docs/specs/tools.md): one of another request
// is refused, so that a page never continues what another index began.

/** An input the caller can correct: a path outside the mount, a cursor of another request, a page that cannot advance. */
export class ReaderInputError extends Error {
  readonly code = "request.invalid";
}

export function continuationKey(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url");
}

const invalid = (): ReaderInputError =>
  new ReaderInputError(
    "This continuation does not match the repository snapshot, path or query. Start again without a cursor.",
  );

/** The offset a cursor stands for under `key`, or the start without one; a cursor of another key is refused. */
export function continuationOffset(cursor: string | undefined, key: string): number {
  if (cursor === undefined) return 0;
  if (cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (typeof value !== "object" || value === null) throw invalid();
  const { key: cursorKey, offset } = value as { readonly key?: unknown; readonly offset?: unknown };
  if (
    cursorKey !== key ||
    typeof offset !== "number" ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    throw invalid();
  }
  return offset;
}

export function nextContinuation(key: string, offset: number): string {
  return Buffer.from(JSON.stringify({ key, offset })).toString("base64url");
}
