CREATE TABLE "missing_repos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"host" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "missing_repos_name_key" ON "missing_repos" USING btree ("host","owner","name");--> statement-breakpoint
CREATE INDEX "missing_repos_checked_idx" ON "missing_repos" USING btree ("checked_at");