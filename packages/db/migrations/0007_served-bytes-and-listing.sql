ALTER TABLE "blobs" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "blobs" ADD COLUMN "bytes" "bytea";--> statement-breakpoint
ALTER TABLE "index_entries" ADD COLUMN "digest" text;--> statement-breakpoint
ALTER TABLE "index_entries" ADD COLUMN "served_size" integer;--> statement-breakpoint
ALTER TABLE "index_entries" ADD COLUMN "listed" boolean DEFAULT false NOT NULL;