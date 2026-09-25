CREATE TABLE "operator_repositories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_repositories_kind_check" CHECK ("operator_repositories"."kind" in ('verified', 'featured', 'blocked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operator_repositories_kind_address_key" ON "operator_repositories" USING btree ("kind","address");