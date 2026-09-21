import type { BlobStore } from "@skillcdn/core";
import { eq, inArray } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { blobs } from "../schema.js";

const HASH_BATCH_SIZE = 1000;

/**
 * The blob-store port on PostgreSQL. It keeps a self-hosted install down to one stateful
 * dependency; an S3 implementation of the same port takes over when bodies outgrow rows.
 */
export function createBlobStore(database: Database): BlobStore {
  const db = drizzleOf(database);
  return {
    async read(hash) {
      const [row] = await db
        .select({ content: blobs.content })
        .from(blobs)
        .where(eq(blobs.sha, hash))
        .limit(1);
      return row?.content;
    },

    async write(hash, content) {
      await db
        .insert(blobs)
        .values({ sha: hash, content, size: Buffer.byteLength(content, "utf8") })
        .onConflictDoNothing({ target: blobs.sha });
    },

    async missing(hashes) {
      const missing = new Set(hashes);
      const unique = [...missing];
      for (let start = 0; start < unique.length; start += HASH_BATCH_SIZE) {
        const rows = await db
          .select({ sha: blobs.sha })
          .from(blobs)
          .where(inArray(blobs.sha, unique.slice(start, start + HASH_BATCH_SIZE)));
        for (const row of rows) {
          missing.delete(row.sha);
        }
      }
      return missing;
    },
  };
}
