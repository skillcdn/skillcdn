CREATE TABLE "pack_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"pack" text,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pack_tokens_token_hash_key" ON "pack_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pack_tokens_expires_idx" ON "pack_tokens" USING btree ("expires_at");