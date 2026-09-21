CREATE TABLE "usage_daily" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_daily_metric_check" CHECK ("usage_daily"."metric" in ('connection', 'tool_call', 'skill_load'))
);
--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_daily_key" ON "usage_daily" USING btree ("repo_id","day","metric","subject");--> statement-breakpoint
CREATE INDEX "usage_daily_day_metric_idx" ON "usage_daily" USING btree ("day","metric");--> statement-breakpoint
CREATE INDEX "usage_daily_account_idx" ON "usage_daily" USING btree ("account_id");