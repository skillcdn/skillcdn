CREATE TABLE "connect_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"secret_hash" text NOT NULL,
	"address" text NOT NULL,
	"agent" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"label" text,
	"expires_in_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connect_requests" ADD CONSTRAINT "connect_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connect_requests_code_key" ON "connect_requests" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "connect_requests_secret_hash_key" ON "connect_requests" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "connect_requests_expires_idx" ON "connect_requests" USING btree ("expires_at");