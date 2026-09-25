import { type BlobStore, decodeText } from "@skillcdn/core";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { blobs } from "../schema.js";

const HASH_BATCH_SIZE = 1000;

/**
 * The blob-store port on PostgreSQL. It keeps a self-hosted install down to one stateful
 * dependency; an S3 implementation of the same port takes over when bodies outgrow rows.
 *
 * Rows from before bytes were stored hold text only. They are read as they are, count as missing
 * so that the next index fetches their bytes, and keep their text until then.
 */
export function createBlobStore(database: Database): BlobStore {
  const db = drizzleOf(database);
  const row = async (hash: string) => {
    const [found] = await db
      .select({ bytes: blobs.bytes, content: blobs.content })
      .from(blobs)
      .where(eq(blobs.sha, hash))
      .limit(1);
    return found;
  };
  return {
    async read(hash) {
      const found = await row(hash);
      if (found === undefined) return undefined;
      return found.bytes === null ? (found.content ?? undefined) : decodeText(found.bytes);
    },

    async readBytes(hash) {
      const found = await row(hash);
      if (found === undefined) return undefined;
      if (found.bytes !== null) return found.bytes;
      return found.content === null ? undefined : new TextEncoder().encode(found.content);
    },

    async write(hash, bytes) {
      await db
        .insert(blobs)
        .values({ sha: hash, bytes, size: bytes.byteLength })
        .onConflictDoUpdate({
          target: blobs.sha,
          set: { bytes: sql`excluded.bytes`, size: sql`excluded.size` },
          setWhere: sql`${blobs.bytes} is null`,
        });
    },

    async missing(hashes) {
      const missing = new Set(hashes);
      const unique = [...missing];
      for (let start = 0; start < unique.length; start += HASH_BATCH_SIZE) {
        const rows = await db
          .select({ sha: blobs.sha })
          .from(blobs)
          .where(
            and(
              inArray(blobs.sha, unique.slice(start, start + HASH_BATCH_SIZE)),
              isNotNull(blobs.bytes),
            ),
          );
        for (const found of rows) {
          missing.delete(found.sha);
        }
      }
      return missing;
    },
  };
}
