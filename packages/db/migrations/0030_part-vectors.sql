-- needs: vector
-- The vectors of the parts of a body, each the mean of its sections' vectors (ADR-0092), are
-- kept beside the vectors of the sections and only where those are, at half precision, which the
-- extension has from its 0.7.0 on: where it is older, the table is not made, the database says
-- so in a notice, and a search across the packs compares every section as before. The vector is
-- kept in the row (`STORAGE MAIN`), since every search across the packs reads every part. The
-- first line marks this migration as one `migrateDatabase` applies again on a database where
-- the extension arrived later, so every statement is written to run twice. Nothing is filled in
-- here: the worker's sweep makes the vectors of what is stored, in batches
-- (packages/db/CLAUDE.md). The generator wrote the table; the guard around it is by hand.
DO $$
BEGIN
	IF to_regclass('section_vectors') IS NULL THEN
		RAISE NOTICE 'part_vectors: the table of the search by meaning is not there, so the vectors of the parts have no table either';
		RETURN;
	END IF;
	IF to_regtype('halfvec') IS NULL THEN
		RAISE NOTICE 'part_vectors: the vector extension of this server is older than 0.7.0 and has no half-precision type, so the vectors of the parts have no table and a search across the packs compares every section';
		RETURN;
	END IF;
	CREATE TABLE IF NOT EXISTS "part_vectors" (
		"blob_sha" text NOT NULL,
		"model" text NOT NULL,
		"dimensions" integer NOT NULL,
		"sectioning_version" integer NOT NULL,
		"part" integer NOT NULL,
		"sections" integer NOT NULL,
		"vector" halfvec NOT NULL,
		"created_at" timestamp with time zone DEFAULT now() NOT NULL,
		CONSTRAINT "part_vectors_pkey" PRIMARY KEY("blob_sha","model","dimensions","sectioning_version","part"),
		CONSTRAINT "part_vectors_dimensions_check" CHECK (vector_dims("part_vectors"."vector") = "part_vectors"."dimensions")
	);
	ALTER TABLE "part_vectors" ALTER COLUMN "vector" SET STORAGE MAIN;
END $$;
