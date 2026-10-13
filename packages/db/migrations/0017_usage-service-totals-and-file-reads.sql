CREATE TABLE "usage_service_clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"day" date NOT NULL,
	"client" text NOT NULL,
	"app" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_service_daily" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_service_daily_metric_check" CHECK ("usage_service_daily"."metric" in ('connection', 'tool_call', 'skill_load', 'file_read', 'client', 'client_app'))
);
--> statement-breakpoint
ALTER TABLE "usage_daily" DROP CONSTRAINT "usage_daily_metric_check";--> statement-breakpoint
CREATE UNIQUE INDEX "usage_service_clients_key" ON "usage_service_clients" USING btree ("day","client");--> statement-breakpoint
CREATE INDEX "usage_service_clients_day_idx" ON "usage_service_clients" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_service_daily_key" ON "usage_service_daily" USING btree ("day","metric","subject");--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_metric_check" CHECK ("usage_daily"."metric" in ('connection', 'tool_call', 'skill_load', 'file_read', 'client'));