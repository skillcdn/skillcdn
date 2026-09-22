ALTER TABLE "index_entries" DROP CONSTRAINT "index_entries_kind_check";--> statement-breakpoint
ALTER TABLE "index_entries" ADD COLUMN "visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "index_entries" ADD CONSTRAINT "index_entries_kind_check" CHECK ("index_entries"."kind" in ('skill', 'manifest', 'markdown', 'json', 'other'));