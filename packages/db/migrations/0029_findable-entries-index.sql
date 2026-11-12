-- built: concurrently
CREATE INDEX IF NOT EXISTS "index_entries_findable_idx" ON "index_entries" USING btree ("snapshot_id") WHERE "index_entries"."visible" and "index_entries"."search" is not null;
