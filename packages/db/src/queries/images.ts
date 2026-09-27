import { asc, eq, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { operatorImages, operatorMedia } from "../schema.js";

// The pictures the operator gives addresses (ADR-0031). Operator data, not tenant data.

export interface OperatorImageRecord {
  /** Canonical, as the address grammar prints it. */
  readonly address: string;
  /** The upload the picture is, with the type it was uploaded as; `undefined` for a URL. */
  readonly media: { readonly sha: string; readonly contentType: string } | undefined;
  /** The `https` URL the picture is loaded from; `undefined` for an upload. */
  readonly url: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Every picture, oldest first. */
export async function listOperatorImages(database: Database): Promise<OperatorImageRecord[]> {
  const rows = await drizzleOf(database)
    .select({
      address: operatorImages.address,
      mediaSha: operatorImages.mediaSha,
      contentType: operatorMedia.contentType,
      url: operatorImages.url,
      createdAt: operatorImages.createdAt,
      updatedAt: operatorImages.updatedAt,
    })
    .from(operatorImages)
    .leftJoin(operatorMedia, eq(operatorImages.mediaSha, operatorMedia.sha))
    .orderBy(asc(operatorImages.createdAt), asc(operatorImages.address));
  return rows.map((row) => ({
    address: row.address,
    media:
      row.mediaSha === null || row.contentType === null
        ? undefined
        : { sha: row.mediaSha, contentType: row.contentType },
    url: row.url ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export type OperatorImageInput =
  | { readonly address: string; readonly mediaSha: string; readonly url?: undefined }
  | { readonly address: string; readonly url: string; readonly mediaSha?: undefined };

export type PutOperatorImageResult =
  | { readonly outcome: "created" | "updated" }
  /** Nothing was written: the upload does not exist. */
  | { readonly outcome: "media_missing" };

/** Writes the picture of an address, replacing what was there. */
export async function putOperatorImage(
  database: Database,
  input: OperatorImageInput,
): Promise<PutOperatorImageResult> {
  const db = drizzleOf(database);
  return db.transaction(async (tx) => {
    if (input.mediaSha !== undefined) {
      const [known] = await tx
        .select({ sha: operatorMedia.sha })
        .from(operatorMedia)
        .where(eq(operatorMedia.sha, input.mediaSha))
        .limit(1);
      if (known === undefined) {
        return { outcome: "media_missing" };
      }
    }
    const values = {
      mediaSha: input.mediaSha ?? null,
      url: input.url ?? null,
    };
    const [existing] = await tx
      .select({ id: operatorImages.id })
      .from(operatorImages)
      .where(eq(operatorImages.address, input.address))
      .limit(1);
    if (existing === undefined) {
      await tx.insert(operatorImages).values({ address: input.address, ...values });
      return { outcome: "created" };
    }
    await tx
      .update(operatorImages)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(operatorImages.id, existing.id));
    return { outcome: "updated" };
  });
}

/** True when the address had a picture. An upload it was stays. */
export async function removeOperatorImage(database: Database, address: string): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(operatorImages)
    .where(eq(operatorImages.address, address))
    .returning({ id: operatorImages.id });
  return rows.length > 0;
}
