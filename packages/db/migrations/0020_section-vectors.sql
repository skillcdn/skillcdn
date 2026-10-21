-- needs: vector
-- The search by meaning keeps its vectors under the `vector` extension (ADR-0064). Where the
-- server offers the extension and this role may create it, the extension and the table are made;
-- where not, neither is, the database says so in a notice, the search by meaning stays off and
-- everything else runs. The first line marks this migration as one `migrateDatabase` applies
-- again, in order with the others so marked, on a database where the extension arrived later;
-- so every statement here is written to run twice. The generator wrote the table; the guard
-- around it is by hand, as it is for any later migration that touches this table
-- (packages/db/CLAUDE.md).
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
		RAISE NOTICE 'section_vectors: the vector extension is not available on this server, so the table of the search by meaning is not created and the search stays by words';
		RETURN;
	END IF;
	BEGIN
		CREATE EXTENSION IF NOT EXISTS vector;
	EXCEPTION WHEN insufficient_privilege THEN
		RAISE NOTICE 'section_vectors: this role may not create the vector extension (%), so the table of the search by meaning is not created and the search stays by words', SQLERRM;
		RETURN;
	END;
	CREATE TABLE IF NOT EXISTS "section_vectors" (
		"blob_sha" text NOT NULL,
		"model" text NOT NULL,
		"dimensions" integer NOT NULL,
		"sectioning_version" integer NOT NULL,
		"section" integer NOT NULL,
		"heading" jsonb NOT NULL,
		"offset" integer NOT NULL,
		"length" integer NOT NULL,
		"vector" vector NOT NULL,
		"created_at" timestamp with time zone DEFAULT now() NOT NULL,
		CONSTRAINT "section_vectors_pkey" PRIMARY KEY("blob_sha","model","dimensions","sectioning_version","section"),
		CONSTRAINT "section_vectors_dimensions_check" CHECK (vector_dims("section_vectors"."vector") = "section_vectors"."dimensions")
	);
END $$;
