CREATE TABLE "usage_client_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"day" date NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"day" date NOT NULL,
	"client" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_daily" DROP CONSTRAINT "usage_daily_metric_check";--> statement-breakpoint
ALTER TABLE "usage_clients" ADD CONSTRAINT "usage_clients_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_clients" ADD CONSTRAINT "usage_clients_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_client_keys_day_key" ON "usage_client_keys" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_clients_key" ON "usage_clients" USING btree ("repo_id","day","client");--> statement-breakpoint
CREATE INDEX "usage_clients_day_idx" ON "usage_clients" USING btree ("day");--> statement-breakpoint
CREATE INDEX "usage_clients_account_idx" ON "usage_clients" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_metric_check" CHECK ("usage_daily"."metric" in ('connection', 'tool_call', 'skill_load', 'client'));