CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"revised" date,
	"texts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_documents_kind_check" CHECK ("legal_documents"."kind" in ('terms', 'privacy'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_kind_key" ON "legal_documents" USING btree ("kind");