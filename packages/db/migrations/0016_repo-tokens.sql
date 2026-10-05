CREATE TABLE "repo_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"address" text NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_tokens" ADD CONSTRAINT "repo_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_tokens" ADD CONSTRAINT "repo_tokens_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repo_tokens_token_hash_key" ON "repo_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "repo_tokens_user_idx" ON "repo_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "repo_tokens_expires_idx" ON "repo_tokens" USING btree ("expires_at");