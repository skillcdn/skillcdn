ALTER TABLE "index_entries" ADD COLUMN "license_kind" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "license" jsonb;--> statement-breakpoint
ALTER TABLE "index_entries" ADD CONSTRAINT "index_entries_license_kind_check" CHECK ("index_entries"."license_kind" is null or "index_entries"."license_kind" in ('permissive', 'restrictive', 'none'));