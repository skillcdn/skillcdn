-- needs: vector
-- The hash of the text a section's vector was made from (ADR-0093), and the index a text is
-- found by, on the table that exists only where the `vector` extension does: the guard is by
-- hand, and every statement is written to run twice (packages/db/CLAUDE.md). The rows there
-- keep no hash, and none is computed for them here. The index is built inside the migration:
-- a build ahead of it cannot be, since the column comes with it and the table may not be
-- there, and what waits meanwhile is the worker's next write of a body, no read.
DO $$
BEGIN
	IF to_regclass('section_vectors') IS NULL THEN
		RETURN;
	END IF;
	ALTER TABLE "section_vectors" ADD COLUMN IF NOT EXISTS "text_hash" text;
	CREATE INDEX IF NOT EXISTS "section_vectors_text_idx" ON "section_vectors" USING btree ("model","dimensions","text_hash") WHERE "section_vectors"."text_hash" is not null;
END $$;
