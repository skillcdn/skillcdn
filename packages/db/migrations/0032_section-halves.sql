-- needs: vector
-- The vectors of the sections at half precision and inside their rows (ADR-0103): what a search
-- across the packs compares the sections of the parts it picked by. Made only where the table of
-- the part vectors is made, from the same rows and in the same transaction, so the table is
-- made under the same conditions: the table of the search by meaning is there, and the
-- extension has its half-precision type. The vector is kept in the row (`STORAGE MAIN`), so the
-- sections of a part are read as a few pages and not as one vector each from beside its row. The
-- first line marks this migration as one `migrateDatabase` applies again on a database where
-- the extension arrived later, so every statement is written to run twice. Nothing is filled in
-- here: the worker's sweep makes them from what is stored, in batches, and until it has, a part
-- whose sections have none is compared at full precision (packages/db/CLAUDE.md). The generator
-- wrote the table; the guard around it is by hand.
DO $$
BEGIN
	IF to_regclass('section_vectors') IS NULL THEN
		RAISE NOTICE 'section_halves: the table of the search by meaning is not there, so the sections at half precision have no table either';
		RETURN;
	END IF;
	IF to_regtype('halfvec') IS NULL THEN
		RAISE NOTICE 'section_halves: the vector extension of this server is older than 0.7.0 and has no half-precision type, so the sections at half precision have no table and a search across the packs compares every section';
		RETURN;
	END IF;
	CREATE TABLE IF NOT EXISTS "section_halves" (
		"blob_sha" text NOT NULL,
		"model" text NOT NULL,
		"dimensions" integer NOT NULL,
		"sectioning_version" integer NOT NULL,
		"section" integer NOT NULL,
		"vector" halfvec NOT NULL,
		"created_at" timestamp with time zone DEFAULT now() NOT NULL,
		CONSTRAINT "section_halves_pkey" PRIMARY KEY("blob_sha","model","dimensions","sectioning_version","section"),
		CONSTRAINT "section_halves_dimensions_check" CHECK (vector_dims("section_halves"."vector") = "section_halves"."dimensions")
	);
	ALTER TABLE "section_halves" ALTER COLUMN "vector" SET STORAGE MAIN;
END $$;
