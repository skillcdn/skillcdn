import { GitHostError } from "@skillcdn/core";
import type * as z from "zod";

/**
 * Reads a reply of the host as the shape the adapter expects of it. Only the fields we read
 * are validated; the host adds fields freely. A reply that is something else is `invalid`.
 */
export function decodeJson<Schema extends z.ZodType>(
  body: Uint8Array,
  schema: Schema,
): z.infer<Schema> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    throw new GitHostError("invalid", "the git host sent a reply that is not JSON", {
      cause: error,
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new GitHostError("invalid", "the git host sent a reply in an unexpected shape");
  }
  return parsed.data;
}
